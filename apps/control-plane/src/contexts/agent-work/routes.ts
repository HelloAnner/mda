import {
  AgentLeaseCommandSchema,
  AppendAgentEventsRequestSchema,
  CheckpointAgentWorkspaceRequestSchema,
  ClaimAgentJobRequestSchema,
  CreateAgentJobRequestSchema,
  SettleAgentJobRequestSchema,
} from "@mda/contracts";
import type { SQL } from "bun";
import type { ArtifactStore } from "../../shared/artifacts.ts";
import {
  authorizeInternalRequest,
  type PrincipalContext,
  requirePermission,
} from "../../shared/auth.ts";
import {
  errorResponse,
  HttpError,
  readJson,
  requireIdempotencyKey,
} from "../../shared/http.ts";
import {
  checkpointAgentWorkspace,
  loadAgentWorkspace,
} from "../revisions/service.ts";
import {
  appendAgentEvents,
  cancelAgentJob,
  claimAgentJob,
  enqueueAgentJob,
  getAgentJob,
  heartbeatAgentJob,
  listAgentEvents,
  settleAgentJob,
  startAgentJob,
} from "./postgres.ts";

interface AgentWorkRouteDependencies {
  db: SQL;
  authenticate(request: Request): Promise<PrincipalContext>;
  internalAgentToken?: string;
  agentLeaseMs?: number;
  artifacts?: ArtifactStore;
}

function requireArtifacts(
  dependencies: AgentWorkRouteDependencies,
): ArtifactStore {
  if (!dependencies.artifacts) {
    throw new HttpError(
      503,
      "SERVICE_UNAVAILABLE",
      "Dashboard artifact storage is not configured",
      true,
    );
  }
  return dependencies.artifacts;
}

function decodeId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid resource ID");
  }
}

function agentEventStream(
  request: Request,
  dependencies: AgentWorkRouteDependencies,
  tenantId: string,
  jobId: string,
  after: number,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let cursor = after;
        let lastKeepalive = Date.now();
        try {
          while (!request.signal.aborted) {
            const events = await listAgentEvents(
              dependencies.db,
              tenantId,
              jobId,
              cursor,
            );
            for (const event of events) {
              cursor = event.sequence;
              controller.enqueue(
                encoder.encode(
                  `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                ),
              );
            }
            const job = await getAgentJob(dependencies.db, tenantId, jobId);
            if (!job) break;
            if (
              events.length === 0 &&
              ["succeeded", "failed", "cancelled"].includes(job.state)
            ) {
              break;
            }
            if (Date.now() - lastKeepalive >= 15_000) {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
              lastKeepalive = Date.now();
            }
            // ponytail: bounded polling is enough for the first chat path; Redis wake-ups replace it at SSE scale.
            await Bun.sleep(250);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      })();
    },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}

export async function handleAgentWorkRequest(
  request: Request,
  dependencies: AgentWorkRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const messageMatch = url.pathname.match(
    /^\/api\/dashboards\/([^/]+)\/messages$/,
  );
  const publicJobMatch = url.pathname.match(
    /^\/api\/agent-jobs\/([^/]+)(?:\/(cancel|events))?$/,
  );
  const internalMatch = url.pathname.match(
    /^\/internal\/v1\/agent-jobs\/([^/]+)\/(claim|start|heartbeat|events|checkpoint|settle)$/,
  );
  if (!messageMatch && !publicJobMatch && !internalMatch) return undefined;

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (messageMatch) {
      if (request.method !== "POST") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const principal = await dependencies.authenticate(request);
      requirePermission(principal, "dashboard.edit");
      const result = await enqueueAgentJob(
        dependencies.db,
        decodeId(messageMatch[1] ?? ""),
        await readJson(request, CreateAgentJobRequestSchema),
        principal,
        requireIdempotencyKey(request),
        requestId,
      );
      return Response.json(result.job, { status: result.created ? 202 : 200 });
    }

    if (publicJobMatch) {
      const principal = await dependencies.authenticate(request);
      const jobId = decodeId(publicJobMatch[1] ?? "");
      if (publicJobMatch[2] === "cancel") {
        if (request.method !== "POST") {
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        requirePermission(principal, "dashboard.edit");
        return Response.json(
          await cancelAgentJob(dependencies.db, principal.tenantId, jobId),
        );
      }
      if (request.method !== "GET") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      requirePermission(principal, "dashboard.read");
      const job = await getAgentJob(dependencies.db, principal.tenantId, jobId);
      if (!job) {
        throw new HttpError(404, "AGENT_JOB_NOT_FOUND", "Agent Job not found");
      }
      if (publicJobMatch[2] === "events") {
        const rawCursor =
          request.headers.get("last-event-id") ??
          url.searchParams.get("after") ??
          "0";
        const cursor = Number(rawCursor);
        if (!Number.isInteger(cursor) || cursor < 0) {
          throw new HttpError(400, "VALIDATION_ERROR", "Invalid event cursor");
        }
        return agentEventStream(
          request,
          dependencies,
          principal.tenantId,
          jobId,
          cursor,
        );
      }
      return Response.json(job);
    }

    if (!dependencies.internalAgentToken) {
      throw new HttpError(
        503,
        "SERVICE_UNAVAILABLE",
        "Internal Agent API is not configured",
        true,
      );
    }
    authorizeInternalRequest(request, dependencies.internalAgentToken);
    if (request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }

    const jobId = decodeId(internalMatch?.[1] ?? "");
    const action = internalMatch?.[2];
    const leaseMs = dependencies.agentLeaseMs ?? 30_000;
    if (action === "claim") {
      const command = await readJson(request, ClaimAgentJobRequestSchema);
      const claimed = await claimAgentJob(
        dependencies.db,
        jobId,
        command.owner,
        leaseMs,
      );
      const workspace = await loadAgentWorkspace(
        dependencies.db,
        requireArtifacts(dependencies),
        jobId,
      );
      return Response.json({ ...claimed, ...(workspace ? { workspace } : {}) });
    }
    if (action === "start") {
      return Response.json(
        await startAgentJob(
          dependencies.db,
          jobId,
          await readJson(request, AgentLeaseCommandSchema),
        ),
      );
    }
    if (action === "heartbeat") {
      return Response.json(
        await heartbeatAgentJob(
          dependencies.db,
          jobId,
          await readJson(request, AgentLeaseCommandSchema),
          leaseMs,
        ),
      );
    }
    if (action === "events") {
      return Response.json(
        await appendAgentEvents(
          dependencies.db,
          jobId,
          await readJson(request, AppendAgentEventsRequestSchema),
        ),
      );
    }
    if (action === "checkpoint") {
      return Response.json(
        await checkpointAgentWorkspace(
          dependencies.db,
          requireArtifacts(dependencies),
          jobId,
          await readJson(request, CheckpointAgentWorkspaceRequestSchema),
        ),
      );
    }
    return Response.json(
      await settleAgentJob(
        dependencies.db,
        jobId,
        await readJson(request, SettleAgentJobRequestSchema),
      ),
    );
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error(
        JSON.stringify({ event: "request.failed", error: String(error) }),
      );
    }
    return errorResponse(error, requestId);
  }
}
