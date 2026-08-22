import type {
  AgentEvent,
  AgentJob,
  AgentLeaseCommand,
  AppendAgentEventsRequest,
  ClaimedAgentJob,
  CreateAgentJobRequest,
  SettleAgentJobRequest,
} from "@mda/contracts";
import type { SQL } from "bun";
import { HttpError } from "../../shared/http.ts";
import { claimIdempotency, requestDigest } from "../../shared/idempotency.ts";
import {
  type AgentJobAggregate,
  AgentJobTransitionError,
  assertActiveLease,
  claimJob,
  recoverExpiredJob,
  renewJobLease,
  requestJobCancellation,
  settleJob,
  startJob,
} from "./domain.ts";

type Row = Record<string, unknown>;

function optionalIso(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : new Date(String(value)).toISOString();
}

function terminalError(value: unknown): AgentJobAggregate["terminalError"] {
  if (!value) return undefined;
  return (
    typeof value === "string" ? JSON.parse(value) : value
  ) as AgentJobAggregate["terminalError"];
}

function toAggregate(row: Row): AgentJobAggregate {
  return {
    id: String(row.id),
    state: row.state as AgentJobAggregate["state"],
    attemptCount: Number(row.attempt_count),
    ...(row.lease_owner ? { leaseOwner: String(row.lease_owner) } : {}),
    fencingToken: Number(row.fencing_token),
    ...(optionalIso(row.lease_expires_at)
      ? { leaseExpiresAt: optionalIso(row.lease_expires_at) }
      : {}),
    ...(optionalIso(row.cancellation_requested_at)
      ? { cancellationRequestedAt: optionalIso(row.cancellation_requested_at) }
      : {}),
    ...(terminalError(row.terminal_error)
      ? { terminalError: terminalError(row.terminal_error) }
      : {}),
    version: Number(row.version),
    createdAt: new Date(String(row.created_at)).toISOString(),
    ...(optionalIso(row.started_at)
      ? { startedAt: optionalIso(row.started_at) }
      : {}),
    ...(optionalIso(row.finished_at)
      ? { finishedAt: optionalIso(row.finished_at) }
      : {}),
  };
}

export function toAgentJob(row: Row): AgentJob {
  const aggregate = toAggregate(row);
  return {
    id: aggregate.id,
    dashboardId: String(row.dashboard_id),
    sessionId: String(row.session_id),
    purpose: row.purpose as AgentJob["purpose"],
    state: aggregate.state,
    attemptCount: aggregate.attemptCount,
    ...(aggregate.cancellationRequestedAt
      ? { cancellationRequestedAt: aggregate.cancellationRequestedAt }
      : {}),
    ...(aggregate.terminalError
      ? { terminalError: aggregate.terminalError }
      : {}),
    version: aggregate.version,
    createdAt: aggregate.createdAt,
    ...(aggregate.startedAt ? { startedAt: aggregate.startedAt } : {}),
    ...(aggregate.finishedAt ? { finishedAt: aggregate.finishedAt } : {}),
  };
}

function transitionError(error: unknown): never {
  if (error instanceof AgentJobTransitionError) {
    throw new HttpError(409, error.code, error.message);
  }
  throw error;
}

async function updateJob(
  transaction: SQL,
  previous: AgentJobAggregate,
  next: AgentJobAggregate,
): Promise<Row> {
  const rows = await transaction`
    UPDATE agent_jobs
    SET state = ${next.state},
        attempt_count = ${next.attemptCount},
        lease_owner = ${next.leaseOwner ?? null},
        fencing_token = ${next.fencingToken},
        lease_expires_at = ${next.leaseExpiresAt ?? null},
        cancellation_requested_at = ${next.cancellationRequestedAt ?? null},
        terminal_error = ${next.terminalError ? JSON.stringify(next.terminalError) : null}::jsonb,
        version = ${next.version},
        started_at = ${next.startedAt ?? null},
        finished_at = ${next.finishedAt ?? null}
    WHERE id = ${previous.id} AND version = ${previous.version}
    RETURNING id, dashboard_id, session_id, purpose, prompt_text, state,
      attempt_count, lease_owner, fencing_token, lease_expires_at,
      cancellation_requested_at, terminal_error, version, created_at,
      started_at, finished_at
  `;
  const row = rows[0] as Row | undefined;
  if (!row) throw new HttpError(409, "VERSION_CONFLICT", "Agent Job changed");
  return row;
}

async function lockedJob(
  transaction: SQL,
  id: string,
  tenantId?: string,
): Promise<Row> {
  const rows = tenantId
    ? await transaction`
        SELECT id, dashboard_id, session_id, purpose, prompt_text, state,
          attempt_count, lease_owner, fencing_token, lease_expires_at,
          cancellation_requested_at, terminal_error, version, created_at,
          started_at, finished_at
        FROM agent_jobs
        WHERE id = ${id} AND tenant_id = ${tenantId}
        FOR UPDATE
      `
    : await transaction`
        SELECT id, dashboard_id, session_id, purpose, prompt_text, state,
          attempt_count, lease_owner, fencing_token, lease_expires_at,
          cancellation_requested_at, terminal_error, version, created_at,
          started_at, finished_at
        FROM agent_jobs
        WHERE id = ${id}
        FOR UPDATE
      `;
  const row = rows[0] as Row | undefined;
  if (!row)
    throw new HttpError(404, "AGENT_JOB_NOT_FOUND", "Agent Job not found");
  return row;
}

export async function enqueueAgentJob(
  db: SQL,
  dashboardId: string,
  input: CreateAgentJobRequest,
  principal: { tenantId: string; userId: string },
  idempotencyKey: string,
  requestId: string,
): Promise<{ job: AgentJob; created: boolean }> {
  const jobId = `job_${crypto.randomUUID()}`;
  const sessionId = input.sessionId ?? `session_${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();
  const operation = `agent-job.create:${dashboardId}`;

  try {
    return await db.begin(async (transaction) => {
      const existingResultId = await claimIdempotency(transaction, {
        tenantId: principal.tenantId,
        operation,
        key: idempotencyKey,
        requestDigest: requestDigest({ dashboardId, ...input }),
        resultId: jobId,
      });
      if (existingResultId) {
        const existing = await transaction`
          SELECT id, dashboard_id, session_id, purpose, state, attempt_count,
            lease_owner, fencing_token, lease_expires_at,
            cancellation_requested_at, terminal_error, version, created_at,
            started_at, finished_at
          FROM agent_jobs
          WHERE id = ${existingResultId} AND tenant_id = ${principal.tenantId}
        `;
        const row = existing[0] as Row | undefined;
        if (!row) throw new Error("Idempotency result is missing");
        return { job: toAgentJob(row), created: false };
      }

      const dashboards = await transaction`
        SELECT 1 FROM dashboards
        WHERE id = ${dashboardId}
          AND tenant_id = ${principal.tenantId}
          AND status = 'active'
      `;
      if (dashboards.length === 0) {
        throw new HttpError(404, "DASHBOARD_NOT_FOUND", "Dashboard not found");
      }

      if (input.sessionId) {
        const sessions = await transaction`
          SELECT 1 FROM agent_sessions
          WHERE id = ${sessionId}
            AND tenant_id = ${principal.tenantId}
            AND dashboard_id = ${dashboardId}
            AND status = 'open'
        `;
        if (sessions.length === 0) {
          throw new HttpError(
            404,
            "AGENT_SESSION_NOT_FOUND",
            "Agent Session not found",
          );
        }
      } else {
        await transaction`
          INSERT INTO agent_sessions (
            id, tenant_id, dashboard_id, status, version, created_at, updated_at
          ) VALUES (
            ${sessionId}, ${principal.tenantId}, ${dashboardId}, 'open', 1,
            ${timestamp}, ${timestamp}
          )
        `;
      }

      const inserted = await transaction`
        INSERT INTO agent_jobs (
          id, tenant_id, dashboard_id, session_id, purpose, prompt_text,
          state, attempt_count, fencing_token, version, created_by, created_at
        ) VALUES (
          ${jobId}, ${principal.tenantId}, ${dashboardId}, ${sessionId}, 'edit',
          ${input.message.trim()}, 'queued', 0, 0, 1,
          ${principal.userId}, ${timestamp}
        )
        RETURNING id, dashboard_id, session_id, purpose, state, attempt_count,
          lease_owner, fencing_token, lease_expires_at,
          cancellation_requested_at, terminal_error, version, created_at,
          started_at, finished_at
      `;
      const row = inserted[0] as Row | undefined;
      if (!row) throw new Error("Agent Job insert returned no row");
      const job = toAgentJob(row);
      const event = {
        id: `event_${crypto.randomUUID()}`,
        type: "agent.job-queued",
        schemaVersion: 1,
        tenantId: principal.tenantId,
        aggregateId: job.id,
        aggregateVersion: job.version,
        occurredAt: job.createdAt,
        requestId,
        data: { jobId: job.id, attempt: 1 },
      };
      await transaction`
        INSERT INTO control_outbox (
          id, tenant_id, event_type, aggregate_id, payload, occurred_at
        ) VALUES (
          ${event.id}, ${principal.tenantId}, ${event.type}, ${job.id},
          ${JSON.stringify(event)}::jsonb, ${job.createdAt}
        )
      `;
      await transaction`
        INSERT INTO audit_events (
          id, tenant_id, actor_id, action, aggregate_id,
          request_id, data, occurred_at
        ) VALUES (
          ${`audit_${crypto.randomUUID()}`}, ${principal.tenantId},
          ${principal.userId}, ${event.type}, ${job.id}, ${requestId},
          ${JSON.stringify({ dashboardId, sessionId })}::jsonb, ${job.createdAt}
        )
      `;
      return { job, created: true };
    });
  } catch (error) {
    if (
      (error as { errno?: string }).errno === "23505" &&
      (error as { constraint?: string }).constraint ===
        "agent_jobs_one_active_per_session_idx"
    ) {
      throw new HttpError(
        409,
        "AGENT_SESSION_BUSY",
        "Agent Session already has active work",
      );
    }
    throw error;
  }
}

export async function authorizeAgentJobLease(
  db: SQL,
  id: string,
  command: AgentLeaseCommand,
  now = new Date(),
): Promise<{ tenantId: string; userId: string }> {
  const rows = await db`
    SELECT tenant_id, created_by, id, state, attempt_count, lease_owner,
      fencing_token, lease_expires_at, cancellation_requested_at,
      terminal_error, version, created_at, started_at, finished_at
    FROM agent_jobs WHERE id = ${id} LIMIT 1
  `;
  const row = rows[0] as Row | undefined;
  if (!row) {
    throw new HttpError(404, "AGENT_JOB_NOT_FOUND", "Agent Job not found");
  }
  try {
    assertActiveLease(
      toAggregate(row),
      command.owner,
      command.fencingToken,
      now,
    );
  } catch (error) {
    transitionError(error);
  }
  return { tenantId: String(row.tenant_id), userId: String(row.created_by) };
}

export async function listAgentJobs(
  db: SQL,
  tenantId: string,
  dashboardId: string | undefined,
  limit: number,
): Promise<AgentJob[]> {
  const rows = await db`
    SELECT id, dashboard_id, session_id, purpose, state, attempt_count,
      lease_owner, fencing_token, lease_expires_at,
      cancellation_requested_at, terminal_error, version, created_at,
      started_at, finished_at
    FROM agent_jobs
    WHERE tenant_id = ${tenantId}
      AND (${dashboardId ?? null}::text IS NULL OR dashboard_id = ${dashboardId ?? null})
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return [...rows].map((row) => toAgentJob(row as Row));
}

export async function getAgentJobPrincipal(
  db: SQL,
  id: string,
): Promise<{ tenantId: string; userId: string }> {
  const rows = await db`
    SELECT tenant_id, created_by FROM agent_jobs WHERE id = ${id} LIMIT 1
  `;
  const row = rows[0] as Row | undefined;
  if (!row) {
    throw new HttpError(404, "AGENT_JOB_NOT_FOUND", "Agent Job not found");
  }
  return { tenantId: String(row.tenant_id), userId: String(row.created_by) };
}

export async function getAgentJob(
  db: SQL,
  tenantId: string,
  id: string,
): Promise<AgentJob | undefined> {
  const rows = await db`
    SELECT id, dashboard_id, session_id, purpose, state, attempt_count,
      lease_owner, fencing_token, lease_expires_at,
      cancellation_requested_at, terminal_error, version, created_at,
      started_at, finished_at
    FROM agent_jobs
    WHERE id = ${id} AND tenant_id = ${tenantId}
  `;
  const row = rows[0] as Row | undefined;
  return row ? toAgentJob(row) : undefined;
}

export async function claimAgentJob(
  db: SQL,
  id: string,
  owner: string,
  leaseMs: number,
  now = new Date(),
): Promise<ClaimedAgentJob> {
  try {
    return await db.begin(async (transaction) => {
      const row = await lockedJob(transaction, id);
      const previous = toAggregate(row);
      const updated = await updateJob(
        transaction,
        previous,
        claimJob(previous, owner, now, leaseMs),
      );
      const persisted = toAggregate(updated);
      const previews = await transaction`
        SELECT id, source_digest
        FROM dashboard_previews
        WHERE job_id = ${id} AND status = 'building'
        LIMIT 1
      `;
      const preview = previews[0] as Row | undefined;
      const publicationBuilds = await transaction`
        SELECT id, revision_id, source_digest
        FROM publication_builds
        WHERE job_id = ${id} AND status = 'building'
        LIMIT 1
      `;
      const publicationBuild = publicationBuilds[0] as Row | undefined;
      return {
        job: toAgentJob(updated),
        prompt: String(row.prompt_text),
        dataSources: { status: "not-configured", items: [] },
        ...(preview
          ? {
              preview: {
                id: String(preview.id),
                sourceDigest: String(preview.source_digest),
              },
            }
          : {}),
        ...(publicationBuild
          ? {
              publication: {
                buildId: String(publicationBuild.id),
                revisionId: String(publicationBuild.revision_id),
                sourceDigest: String(publicationBuild.source_digest),
              },
            }
          : {}),
        lease: {
          owner,
          fencingToken: persisted.fencingToken,
          expiresAt: persisted.leaseExpiresAt as string,
        },
      };
    });
  } catch (error) {
    transitionError(error);
  }
}

async function applyLeaseCommand(
  db: SQL,
  id: string,
  transition: (job: AgentJobAggregate, now: Date) => AgentJobAggregate,
  now = new Date(),
): Promise<AgentJob> {
  try {
    return await db.begin(async (transaction) => {
      const row = await lockedJob(transaction, id);
      const previous = toAggregate(row);
      const updated = await updateJob(
        transaction,
        previous,
        transition(previous, now),
      );
      return toAgentJob(updated);
    });
  } catch (error) {
    transitionError(error);
  }
}

export function startAgentJob(
  db: SQL,
  id: string,
  command: AgentLeaseCommand,
  now = new Date(),
): Promise<AgentJob> {
  return applyLeaseCommand(
    db,
    id,
    (job, current) =>
      startJob(job, command.owner, command.fencingToken, current),
    now,
  );
}

export function heartbeatAgentJob(
  db: SQL,
  id: string,
  command: AgentLeaseCommand,
  leaseMs: number,
  now = new Date(),
): Promise<AgentJob> {
  return applyLeaseCommand(
    db,
    id,
    (job, current) =>
      renewJobLease(job, command.owner, command.fencingToken, current, leaseMs),
    now,
  );
}

export async function settleAgentJob(
  db: SQL,
  id: string,
  command: SettleAgentJobRequest,
  now = new Date(),
): Promise<AgentJob> {
  try {
    return await db.begin(async (transaction) => {
      const row = await lockedJob(transaction, id);
      const previous = toAggregate(row);
      const next = settleJob(previous, command, now);
      if (command.state === "succeeded") {
        const checkpointRows = await transaction`
          SELECT id, tenant_id, dashboard_id, parent_checkpoint_id,
            content_digest
          FROM draft_checkpoints
          WHERE job_id = ${id} AND status = 'staged'
          LIMIT 1
        `;
        const checkpoint = checkpointRows[0] as Row | undefined;
        if (checkpoint) {
          await transaction`
            SELECT id FROM dashboards
            WHERE tenant_id = ${String(checkpoint.tenant_id)}
              AND id = ${String(checkpoint.dashboard_id)}
            FOR UPDATE
          `;
          const latestRows = await transaction`
            SELECT id FROM draft_checkpoints
            WHERE tenant_id = ${String(checkpoint.tenant_id)}
              AND dashboard_id = ${String(checkpoint.dashboard_id)}
              AND status = 'active'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          `;
          const latestId = latestRows[0]
            ? String((latestRows[0] as Row).id)
            : undefined;
          const parentId = checkpoint.parent_checkpoint_id
            ? String(checkpoint.parent_checkpoint_id)
            : undefined;
          if (latestId !== parentId) {
            throw new HttpError(
              409,
              "DRAFT_CONFLICT",
              "Dashboard Draft changed in another Session",
            );
          }
          await transaction`
            UPDATE draft_checkpoints
            SET status = 'active'
            WHERE id = ${String(checkpoint.id)} AND status = 'staged'
          `;
          const sequenceRows = await transaction`
            SELECT COALESCE(max(sequence), 0)::int + 1 AS sequence
            FROM agent_events
            WHERE job_id = ${id}
          `;
          await transaction`
            INSERT INTO agent_events (
              id, tenant_id, job_id, sequence, type, data, created_at
            ) VALUES (
              ${`agent-event_${crypto.randomUUID()}`},
              ${String(checkpoint.tenant_id)}, ${id},
              ${Number((sequenceRows[0] as Row).sequence)},
              'draft.checkpoint.saved',
              ${JSON.stringify({
                checkpointId: String(checkpoint.id),
                digest: String(checkpoint.content_digest),
              })}::jsonb,
              ${now.toISOString()}
            )
          `;
        }
      }
      if (row.purpose === "preview") {
        const previews = await transaction`
          SELECT id, status FROM dashboard_previews
          WHERE job_id = ${id}
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
        `;
        const preview = previews[0] as Row | undefined;
        if (command.state === "succeeded" && preview?.status !== "ready") {
          throw new HttpError(
            409,
            "PREVIEW_NOT_READY",
            "Preview Job cannot succeed without a validated build",
          );
        }
        if (command.state !== "succeeded" && preview?.status === "building") {
          const error =
            command.error ??
            (command.state === "cancelled"
              ? {
                  code: "CANCELLED",
                  message: "Preview build was cancelled",
                  retryable: false,
                }
              : {
                  code: "PREVIEW_BUILD_FAILED",
                  message: "Preview build failed",
                  retryable: false,
                });
          await transaction`
            UPDATE dashboard_previews
            SET status = 'failed', terminal_error = ${JSON.stringify(error)}::jsonb,
              completed_at = ${now.toISOString()}
            WHERE id = ${String(preview.id)} AND status = 'building'
          `;
        }
      }
      if (row.purpose === "publish") {
        const builds = await transaction`
          SELECT id, status, publication_id FROM publication_builds
          WHERE job_id = ${id}
          LIMIT 1
          FOR UPDATE
        `;
        const build = builds[0] as Row | undefined;
        if (
          command.state === "succeeded" &&
          (build?.status !== "ready" || !build.publication_id)
        ) {
          throw new HttpError(
            409,
            "PUBLICATION_NOT_READY",
            "Publication Job cannot succeed without an immutable Publication",
          );
        }
        if (command.state !== "succeeded" && build?.status === "building") {
          const error =
            command.error ??
            (command.state === "cancelled"
              ? {
                  code: "CANCELLED",
                  message: "Publication build was cancelled",
                  retryable: false,
                }
              : {
                  code: "PUBLICATION_BUILD_FAILED",
                  message: "Publication build failed",
                  retryable: false,
                });
          await transaction`
            UPDATE publication_builds
            SET status = 'failed', terminal_error = ${JSON.stringify(error)}::jsonb,
              completed_at = ${now.toISOString()}
            WHERE id = ${String(build.id)} AND status = 'building'
          `;
        }
      }
      const updated = await updateJob(transaction, previous, next);
      return toAgentJob(updated);
    });
  } catch (error) {
    transitionError(error);
  }
}

export async function recoverExpiredAgentJobs(
  db: SQL,
  limit = 100,
  now = new Date(),
): Promise<number> {
  return db.begin(async (transaction) => {
    const rows = await transaction`
      SELECT id, dashboard_id, session_id, purpose, prompt_text, state,
        attempt_count, lease_owner, fencing_token, lease_expires_at,
        cancellation_requested_at, terminal_error, version, created_at,
        started_at, finished_at
      FROM agent_jobs
      WHERE state IN ('leased', 'running') AND lease_expires_at <= ${now.toISOString()}
      ORDER BY lease_expires_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    let recovered = 0;
    for (const value of rows) {
      const row = value as Row;
      const previous = toAggregate(row);
      let next: AgentJobAggregate;
      try {
        next = recoverExpiredJob(previous, now);
      } catch {
        continue;
      }
      await updateJob(transaction, previous, next);
      if (next.state === "queued") {
        const event = {
          id: `event_${crypto.randomUUID()}`,
          type: "agent.job-queued",
          schemaVersion: 1,
          tenantId: String(
            (
              await transaction`
                SELECT tenant_id FROM agent_jobs WHERE id = ${previous.id}
              `
            )[0]?.tenant_id,
          ),
          aggregateId: previous.id,
          aggregateVersion: next.version,
          occurredAt: now.toISOString(),
          requestId: `recovery:${previous.id}:${next.fencingToken}`,
          data: { jobId: previous.id, attempt: next.attemptCount + 1 },
        };
        await transaction`
          INSERT INTO control_outbox (
            id, tenant_id, event_type, aggregate_id, payload, occurred_at
          ) VALUES (${event.id}, ${event.tenantId}, ${event.type},
            ${previous.id}, ${JSON.stringify(event)}::jsonb, ${event.occurredAt})
        `;
      }
      recovered += 1;
    }
    return recovered;
  });
}

export async function cancelAgentJob(
  db: SQL,
  tenantId: string,
  id: string,
  now = new Date(),
): Promise<AgentJob> {
  try {
    return await db.begin(async (transaction) => {
      const row = await lockedJob(transaction, id, tenantId);
      const previous = toAggregate(row);
      const next = requestJobCancellation(previous, now);
      if (next === previous) return toAgentJob(row);
      return toAgentJob(await updateJob(transaction, previous, next));
    });
  } catch (error) {
    transitionError(error);
  }
}

export async function appendAgentEvents(
  db: SQL,
  id: string,
  command: AppendAgentEventsRequest,
  now = new Date(),
): Promise<AgentEvent[]> {
  try {
    return await db.begin(async (transaction) => {
      const jobRow = await lockedJob(transaction, id);
      assertActiveLease(
        toAggregate(jobRow),
        command.owner,
        command.fencingToken,
        now,
      );
      const tenantRows = await transaction`
        SELECT tenant_id FROM agent_jobs WHERE id = ${id}
      `;
      const tenantId = String((tenantRows[0] as Row).tenant_id);
      const sequenceRows = await transaction`
        SELECT COALESCE(max(sequence), 0)::int AS sequence
        FROM agent_events
        WHERE job_id = ${id}
      `;
      let sequence = Number((sequenceRows[0] as Row).sequence);
      const created: AgentEvent[] = [];
      for (const event of command.events) {
        sequence += 1;
        const rows = await transaction`
          INSERT INTO agent_events (
            id, tenant_id, job_id, sequence, type, data, created_at
          ) VALUES (
            ${`agent-event_${crypto.randomUUID()}`}, ${tenantId}, ${id},
            ${sequence}, ${event.type}, ${JSON.stringify(event.data)}::jsonb,
            ${now.toISOString()}
          )
          RETURNING sequence, created_at
        `;
        created.push({
          sequence: Number((rows[0] as Row).sequence),
          timestamp: new Date(
            String((rows[0] as Row).created_at),
          ).toISOString(),
          type: event.type,
          jobId: id,
          data: event.data,
        });
      }
      return created;
    });
  } catch (error) {
    transitionError(error);
  }
}

export async function listAgentEvents(
  db: SQL,
  tenantId: string,
  id: string,
  after: number,
  limit = 100,
): Promise<AgentEvent[]> {
  const rows = await db`
    SELECT sequence, type, data, created_at
    FROM agent_events
    WHERE tenant_id = ${tenantId} AND job_id = ${id} AND sequence > ${after}
    ORDER BY sequence
    LIMIT ${limit}
  `;
  return [...rows].map((row) => ({
    sequence: Number(row.sequence),
    timestamp: new Date(String(row.created_at)).toISOString(),
    type: row.type as AgentEvent["type"],
    jobId: id,
    data: (typeof row.data === "string"
      ? JSON.parse(row.data)
      : row.data) as Record<string, unknown>,
  }));
}
