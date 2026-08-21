import { RedisClient } from "bun";
import {
  ControlPlaneError,
  createControlPlaneClient,
} from "./clients/control-plane.ts";
import { loadAgentConfig } from "./config.ts";
import { AgentEventForwarder } from "./events.ts";
import { createPiModelRuntime, runPiSession } from "./pi/session.ts";
import {
  acknowledgeAgentJob,
  ensureAgentGroup,
  readAgentJob,
} from "./queue.ts";

export async function runWorker(): Promise<void> {
  const config = loadAgentConfig();
  const redis = new RedisClient(config.redisUrl);
  await redis.connect();
  await ensureAgentGroup(redis);
  const client = createControlPlaneClient(
    config.controlPlaneUrl,
    config.internalAgentToken,
  );
  const piRuntime = await createPiModelRuntime(config);

  console.log(
    JSON.stringify({
      event: "agent.started",
      consumerId: config.consumerId,
      model: `${config.model.provider}/${config.model.model}`,
    }),
  );

  while (true) {
    const entry = await readAgentJob(redis, config.consumerId);
    if (!entry) continue;
    let acknowledge = false;
    try {
      const claimed = await client.claim(entry.jobId, config.consumerId);
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
        await runPiSession(config, piRuntime, {
          dashboardId: claimed.job.dashboardId,
          sessionId: claimed.job.sessionId,
          prompt: claimed.prompt,
          signal: runAbort.signal,
          onEvent: (type, data) => events.push(type, data),
        });
        heartbeatAbort.abort();
        await heartbeat;
        if (leaseLost) throw new Error("Agent lease lost");

        const current = await client.heartbeat(entry.jobId, lease);
        cancellationRequested ||= Boolean(current.cancellationRequestedAt);
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
          events.push("agent.failed", {
            code: cancellationRequested ? "CANCELLED" : "AGENT_FAILED",
            message,
          });
          await events.drain();
          await client.settle(
            entry.jobId,
            lease,
            cancellationRequested ? "cancelled" : "failed",
            cancellationRequested
              ? undefined
              : { code: "AGENT_FAILED", message, retryable: false },
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
  const message = error instanceof Error ? error.message : String(error);
  return (secret ? message.replaceAll(secret, "[redacted]") : message).slice(
    0,
    2_000,
  );
}

if (import.meta.main) await runWorker();
