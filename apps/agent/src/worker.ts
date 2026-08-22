import type { DashboardBuildArtifact } from "@mda/contracts";
import { buildDashboard, DashboardBuildError } from "@mda/dashboard-template";
import { RedisClient } from "bun";
import {
  ControlPlaneError,
  createControlPlaneClient,
} from "./clients/control-plane.ts";
import { type AgentConfig, loadAgentConfig } from "./config.ts";
import { AgentEventForwarder } from "./events.ts";
import {
  createPiModelRuntime,
  resolveSessionPaths,
  runPiSession,
} from "./pi/session.ts";
import {
  acknowledgeAgentJob,
  ensureAgentGroup,
  readAgentJob,
} from "./queue.ts";
import { captureWorkspace } from "./workspace.ts";

type PiModelRuntime = Awaited<ReturnType<typeof createPiModelRuntime>>;

export async function runWorker(
  config: AgentConfig,
  piRuntime: PiModelRuntime,
  workerNumber: number,
): Promise<void> {
  const consumerId =
    config.workers === 1
      ? config.consumerId
      : `${config.consumerId}-${workerNumber}`;
  const redis = new RedisClient(config.redisUrl);
  await redis.connect();
  await ensureAgentGroup(redis);
  const client = createControlPlaneClient(
    config.controlPlaneUrl,
    config.internalAgentToken,
  );

  while (true) {
    const entry = await readAgentJob(redis, consumerId);
    if (!entry) continue;
    let acknowledge = false;
    try {
      const claimed = await client.claim(entry.jobId, consumerId);
      const lease = {
        owner: claimed.lease.owner,
        fencingToken: claimed.lease.fencingToken,
      };
      await client.start(entry.jobId, lease);

      const runAbort = new AbortController();
      const heartbeatAbort = new AbortController();
      let cancellationRequested = false;
      let leaseLost = false;
      const heartbeat = (async () => {
        while (
          await waitForHeartbeat(
            Math.max(1_000, Math.floor(config.leaseMs / 3)),
            heartbeatAbort.signal,
          )
        ) {
          try {
            const job = await client.heartbeat(entry.jobId, lease);
            if (job.cancellationRequestedAt) {
              cancellationRequested = true;
              runAbort.abort();
              break;
            }
          } catch {
            leaseLost = true;
            runAbort.abort();
            break;
          }
        }
      })();

      const events = new AgentEventForwarder(client, entry.jobId, lease);
      try {
        let buildArtifact: DashboardBuildArtifact | undefined;
        if (claimed.job.purpose !== "edit") {
          if (
            !claimed.workspace ||
            (claimed.job.purpose === "preview" && !claimed.preview) ||
            (claimed.job.purpose === "publish" && !claimed.publication)
          ) {
            throw new Error(`${claimed.job.purpose} Job has no pinned source`);
          }
          events.push("agent.started", {});
          events.push("build.started", { templateVersion: "1" });
          try {
            const result = await buildDashboard(
              claimed.workspace.snapshot,
              runAbort.signal,
            );
            buildArtifact = result.artifact;
            events.push("validation.completed", {
              status: "passed",
              sourceDigest: result.artifact.sourceDigest,
              manifestDigest: result.artifact.manifestDigest,
            });
            events.push("build.completed", {
              status: "succeeded",
              digest: result.artifact.digest,
              fileCount: result.artifact.fileCount,
              totalBytes: result.artifact.totalBytes,
              durationMs: result.durationMs,
            });
          } catch (error) {
            events.push("validation.completed", {
              status: "failed",
              message: safeError(error),
            });
            throw error;
          }
        } else {
          const result = await runPiSession(config, piRuntime, {
            dashboardId: claimed.job.dashboardId,
            sessionId: claimed.job.sessionId,
            prompt: claimed.prompt,
            dataSources: claimed.dataSources,
            dataAccess: {
              list: () => client.dataSources(entry.jobId, lease),
              describe: (sourceId) =>
                client.describeSource(entry.jobId, lease, sourceId),
              queries: (sourceId) =>
                client.queries(entry.jobId, lease, sourceId),
              register: (request, idempotencyKey) =>
                client.registerQuery(
                  entry.jobId,
                  lease,
                  request,
                  idempotencyKey,
                ),
              execute: (queryId, request) =>
                client.executeQuery(entry.jobId, lease, queryId, request),
            },
            ...(claimed.workspace
              ? { workspaceSnapshot: claimed.workspace.snapshot }
              : {}),
            signal: runAbort.signal,
            onEvent: (type, data) => events.push(type, data),
          });
          buildArtifact = result.previewArtifact;
        }
        if (leaseLost) throw new Error("Agent lease lost");

        const current = await client.heartbeat(entry.jobId, lease);
        cancellationRequested ||= Boolean(current.cancellationRequestedAt);
        if (!cancellationRequested && claimed.job.purpose === "edit") {
          const workspace = resolveSessionPaths(
            config.workspaceRoot,
            claimed.job.dashboardId,
            claimed.job.sessionId,
          ).workspace;
          const snapshot = await captureWorkspace(workspace);
          if (snapshot.fileCount > 0) {
            await client.checkpoint(entry.jobId, {
              ...lease,
              ...(claimed.workspace
                ? { baseCheckpointId: claimed.workspace.checkpointId }
                : {}),
              snapshot,
            });
          }
        }
        if (!cancellationRequested && buildArtifact) {
          if (claimed.job.purpose === "publish") {
            const publication = await client.publication(
              entry.jobId,
              lease,
              buildArtifact,
            );
            events.push("publication.created", {
              publicationId: publication.publicationId,
              number: publication.number,
              digest: publication.digest,
            });
          } else {
            const preview = await client.preview(
              entry.jobId,
              lease,
              buildArtifact,
            );
            events.push("preview.ready", {
              previewId: preview.previewId,
              path: preview.path,
              digest: preview.digest,
            });
          }
        }
        heartbeatAbort.abort();
        await heartbeat;
        if (leaseLost) throw new Error("Agent lease lost");
        events.push("agent.completed", {
          state: cancellationRequested ? "cancelled" : "succeeded",
        });
        await events.drain();
        await client.settle(
          entry.jobId,
          lease,
          cancellationRequested ? "cancelled" : "succeeded",
        );
        acknowledge = true;
      } catch (error) {
        heartbeatAbort.abort();
        await heartbeat;
        if (
          error instanceof ControlPlaneError &&
          error.code === "CANCELLATION_REQUESTED"
        ) {
          cancellationRequested = true;
        }
        if (!leaseLost) {
          const message = safeError(error, config.model.apiKey);
          const errorCode =
            error instanceof DashboardBuildError ||
            error instanceof ControlPlaneError
              ? error.code
              : "AGENT_FAILED";
          events.push("agent.failed", {
            code: cancellationRequested ? "CANCELLED" : errorCode,
            message,
          });
          await events.drain();
          await client.settle(
            entry.jobId,
            lease,
            cancellationRequested ? "cancelled" : "failed",
            cancellationRequested
              ? undefined
              : { code: errorCode, message, retryable: false },
          );
          acknowledge = true;
        }
      }
    } catch (error) {
      if (
        error instanceof ControlPlaneError &&
        (error.status === 404 || error.code === "JOB_NOT_CLAIMABLE")
      ) {
        acknowledge = true;
      } else {
        console.error(
          JSON.stringify({
            event: "agent.job.failed",
            jobId: entry.jobId,
            error: safeError(error),
          }),
        );
      }
    }
    if (acknowledge) await acknowledgeAgentJob(redis, entry.id);
  }
}

async function waitForHeartbeat(
  milliseconds: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  await new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return !signal.aborted;
}

function safeError(error: unknown, secret?: string): string {
  const message =
    error instanceof DashboardBuildError
      ? [
          `${error.code}: ${error.message}`,
          error.path ? `Path: ${error.path}` : "",
          error.log ? error.log.slice(-6_000) : "",
        ]
          .filter(Boolean)
          .join("\n")
      : error instanceof Error
        ? error.message
        : String(error);
  return (secret ? message.replaceAll(secret, "[redacted]") : message).slice(
    0,
    2_000,
  );
}

export async function runWorkers(): Promise<void> {
  const config = loadAgentConfig();
  const piRuntime = await createPiModelRuntime(config);
  console.log(
    JSON.stringify({
      event: "agent.started",
      consumerId: config.consumerId,
      workers: config.workers,
      model: `${config.model.provider}/${config.model.model}`,
    }),
  );
  await Promise.all(
    Array.from({ length: config.workers }, (_, index) =>
      runWorker(config, piRuntime, index + 1),
    ),
  );
}

if (import.meta.main) await runWorkers();
