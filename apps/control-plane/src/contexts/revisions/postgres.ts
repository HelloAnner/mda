import type {
  CheckpointAgentWorkspaceRequest,
  CreateDashboardRevisionRequest,
  DashboardRevision,
} from "@mda/contracts";
import type { SQL } from "bun";
import { HttpError } from "../../shared/http.ts";
import { claimIdempotency, requestDigest } from "../../shared/idempotency.ts";

export interface CheckpointRecord {
  id: string;
  tenantId: string;
  dashboardId: string;
  sessionId: string;
  jobId: string;
  parentCheckpointId?: string;
  artifactKey: string;
  digest: string;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
}

export interface AgentCheckpointContext {
  tenantId: string;
  dashboardId: string;
  sessionId: string;
  userId: string;
  latest?: CheckpointRecord;
}

export interface RevisionRecord extends DashboardRevision {
  tenantId: string;
  artifactKey: string;
}

type Row = Record<string, unknown>;

function toCheckpoint(row: Row): CheckpointRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    dashboardId: String(row.dashboard_id),
    sessionId: String(row.session_id),
    jobId: String(row.job_id),
    ...(row.parent_checkpoint_id
      ? { parentCheckpointId: String(row.parent_checkpoint_id) }
      : {}),
    artifactKey: String(row.artifact_key),
    digest: String(row.content_digest),
    fileCount: Number(row.file_count),
    totalBytes: Number(row.total_bytes),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function toRevision(row: Row): RevisionRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    dashboardId: String(row.dashboard_id),
    number: Number(row.revision_number),
    digest: String(row.content_digest),
    fileCount: Number(row.file_count),
    totalBytes: Number(row.total_bytes),
    ...(row.message === null || row.message === undefined
      ? {}
      : { message: String(row.message) }),
    createdAt: new Date(String(row.created_at)).toISOString(),
    artifactKey: String(row.artifact_key),
  };
}

function assertLease(
  row: Row,
  command: Pick<CheckpointAgentWorkspaceRequest, "owner" | "fencingToken">,
  now: Date,
): void {
  if (row.state !== "running") {
    throw new HttpError(
      409,
      "JOB_NOT_CHECKPOINTABLE",
      "Agent Job is not running",
    );
  }
  if (
    row.lease_owner !== command.owner ||
    Number(row.fencing_token) !== command.fencingToken
  ) {
    throw new HttpError(409, "STALE_LEASE", "Agent lease is stale");
  }
  if (new Date(String(row.lease_expires_at)).getTime() <= now.getTime()) {
    throw new HttpError(409, "LEASE_EXPIRED", "Agent lease expired");
  }
}

async function checkpointById(
  db: SQL,
  tenantId: string,
  dashboardId: string,
  checkpointId: string,
): Promise<CheckpointRecord | undefined> {
  const rows = await db`
    SELECT id, tenant_id, dashboard_id, session_id, job_id,
      parent_checkpoint_id, artifact_key, content_digest,
      file_count, total_bytes, created_at
    FROM draft_checkpoints
    WHERE tenant_id = ${tenantId}
      AND dashboard_id = ${dashboardId}
      AND id = ${checkpointId}
      AND status = 'active'
    LIMIT 1
  `;
  const row = rows[0] as Row | undefined;
  return row ? toCheckpoint(row) : undefined;
}

async function latestCheckpoint(
  db: SQL,
  tenantId: string,
  dashboardId: string,
): Promise<CheckpointRecord | undefined> {
  const rows = await db`
    SELECT id, tenant_id, dashboard_id, session_id, job_id,
      parent_checkpoint_id, artifact_key, content_digest,
      file_count, total_bytes, created_at
    FROM draft_checkpoints
    WHERE tenant_id = ${tenantId}
      AND dashboard_id = ${dashboardId}
      AND status = 'active'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;
  const row = rows[0] as Row | undefined;
  return row ? toCheckpoint(row) : undefined;
}

export async function getAgentCheckpointContext(
  db: SQL,
  jobId: string,
  command?: Pick<CheckpointAgentWorkspaceRequest, "owner" | "fencingToken">,
  now = new Date(),
): Promise<AgentCheckpointContext> {
  const rows = await db`
    SELECT tenant_id, dashboard_id, session_id, created_by, purpose,
      source_checkpoint_id, state, lease_owner, fencing_token, lease_expires_at
    FROM agent_jobs
    WHERE id = ${jobId}
    LIMIT 1
  `;
  const row = rows[0] as Row | undefined;
  if (!row) {
    throw new HttpError(404, "AGENT_JOB_NOT_FOUND", "Agent Job not found");
  }
  if (command) {
    assertLease(row, command, now);
    if (row.purpose !== "edit") {
      throw new HttpError(
        409,
        "JOB_NOT_CHECKPOINTABLE",
        "Only edit Jobs may create source Checkpoints",
      );
    }
  }
  const tenantId = String(row.tenant_id);
  const dashboardId = String(row.dashboard_id);
  const latest = row.source_checkpoint_id
    ? await checkpointById(
        db,
        tenantId,
        dashboardId,
        String(row.source_checkpoint_id),
      )
    : await latestCheckpoint(db, tenantId, dashboardId);
  return {
    tenantId,
    dashboardId,
    sessionId: String(row.session_id),
    userId: String(row.created_by),
    ...(latest ? { latest } : {}),
  };
}

export async function insertDraftCheckpoint(
  db: SQL,
  input: {
    jobId: string;
    command: Pick<
      CheckpointAgentWorkspaceRequest,
      "owner" | "fencingToken" | "baseCheckpointId"
    >;
    artifactKey: string;
    digest: string;
    fileCount: number;
    totalBytes: number;
  },
  now = new Date(),
): Promise<{ checkpoint: CheckpointRecord; created: boolean }> {
  return db.begin(async (transaction) => {
    const jobRows = await transaction`
      SELECT tenant_id, dashboard_id, session_id, created_by, state,
        lease_owner, fencing_token, lease_expires_at
      FROM agent_jobs
      WHERE id = ${input.jobId}
      FOR UPDATE
    `;
    const job = jobRows[0] as Row | undefined;
    if (!job) {
      throw new HttpError(404, "AGENT_JOB_NOT_FOUND", "Agent Job not found");
    }
    assertLease(job, input.command, now);
    const tenantId = String(job.tenant_id);
    const dashboardId = String(job.dashboard_id);
    await transaction`
      SELECT id FROM dashboards
      WHERE tenant_id = ${tenantId} AND id = ${dashboardId}
      FOR UPDATE
    `;
    const stagedRows = await transaction`
      SELECT id, tenant_id, dashboard_id, session_id, job_id,
        parent_checkpoint_id, artifact_key, content_digest,
        file_count, total_bytes, created_at
      FROM draft_checkpoints
      WHERE job_id = ${input.jobId} AND status = 'staged'
      LIMIT 1
    `;
    const staged = stagedRows[0] as Row | undefined;
    if (staged) {
      const checkpoint = toCheckpoint(staged);
      if (checkpoint.digest !== input.digest) {
        throw new HttpError(
          409,
          "CHECKPOINT_CONFLICT",
          "Agent Job already staged different source",
        );
      }
      return { checkpoint, created: false };
    }
    const current = await latestCheckpoint(transaction, tenantId, dashboardId);
    if (current?.digest === input.digest) {
      return { checkpoint: current, created: false };
    }
    if ((current?.id ?? undefined) !== input.command.baseCheckpointId) {
      throw new HttpError(
        409,
        "DRAFT_CONFLICT",
        "Dashboard Draft changed in another Session",
      );
    }

    const id = `checkpoint_${crypto.randomUUID()}`;
    const rows = await transaction`
      INSERT INTO draft_checkpoints (
        id, tenant_id, dashboard_id, session_id, job_id,
        parent_checkpoint_id, artifact_key, content_digest,
        file_count, total_bytes, created_by, created_at
      ) VALUES (
        ${id}, ${tenantId}, ${dashboardId}, ${String(job.session_id)},
        ${input.jobId}, ${current?.id ?? null}, ${input.artifactKey},
        ${input.digest}, ${input.fileCount}, ${input.totalBytes},
        ${String(job.created_by)}, ${now.toISOString()}
      )
      RETURNING id, tenant_id, dashboard_id, session_id, job_id,
        parent_checkpoint_id, artifact_key, content_digest,
        file_count, total_bytes, created_at
    `;
    const row = rows[0] as Row | undefined;
    if (!row) throw new Error("Checkpoint insert returned no row");
    return { checkpoint: toCheckpoint(row), created: true };
  });
}

export async function createDashboardRevision(
  db: SQL,
  dashboardId: string,
  input: CreateDashboardRevisionRequest,
  principal: { tenantId: string; userId: string },
  idempotencyKey: string,
  requestId: string,
  now = new Date(),
): Promise<{ revision: RevisionRecord; created: boolean }> {
  const operation = `dashboard-revision.create:${dashboardId}`;
  return db.begin(async (transaction) => {
    const dashboards = await transaction`
      SELECT id FROM dashboards
      WHERE tenant_id = ${principal.tenantId}
        AND id = ${dashboardId}
        AND status = 'active'
      FOR UPDATE
    `;
    if (dashboards.length === 0) {
      throw new HttpError(404, "DASHBOARD_NOT_FOUND", "Dashboard not found");
    }
    const checkpoint = await latestCheckpoint(
      transaction,
      principal.tenantId,
      dashboardId,
    );
    if (!checkpoint) {
      throw new HttpError(
        409,
        "DRAFT_NOT_AVAILABLE",
        "Dashboard has no source Checkpoint to save",
      );
    }
    const existingRows = await transaction`
      SELECT id, tenant_id, dashboard_id, revision_number, artifact_key,
        content_digest, file_count, total_bytes, message, created_at
      FROM dashboard_revisions
      WHERE tenant_id = ${principal.tenantId}
        AND dashboard_id = ${dashboardId}
        AND checkpoint_id = ${checkpoint.id}
      LIMIT 1
    `;
    const existing = existingRows[0] as Row | undefined;
    const revisionId = existing
      ? String(existing.id)
      : `revision_${crypto.randomUUID()}`;
    const replayId = await claimIdempotency(transaction, {
      tenantId: principal.tenantId,
      operation,
      key: idempotencyKey,
      requestDigest: requestDigest({
        dashboardId,
        message: input.message?.trim() || undefined,
      }),
      resultId: revisionId,
    });
    if (replayId) {
      const rows = await transaction`
        SELECT id, tenant_id, dashboard_id, revision_number, artifact_key,
          content_digest, file_count, total_bytes, message, created_at
        FROM dashboard_revisions
        WHERE tenant_id = ${principal.tenantId} AND id = ${replayId}
      `;
      const row = rows[0] as Row | undefined;
      if (!row) throw new Error("Idempotency result is missing");
      return { revision: toRevision(row), created: false };
    }
    if (existing) return { revision: toRevision(existing), created: false };

    const numberRows = await transaction`
      SELECT COALESCE(max(revision_number), 0)::int + 1 AS number
      FROM dashboard_revisions
      WHERE tenant_id = ${principal.tenantId} AND dashboard_id = ${dashboardId}
    `;
    const number = Number((numberRows[0] as Row).number);
    const message = input.message?.trim() || undefined;
    const rows = await transaction`
      INSERT INTO dashboard_revisions (
        id, tenant_id, dashboard_id, revision_number, checkpoint_id,
        artifact_key, content_digest, file_count, total_bytes,
        message, created_by, created_at
      ) VALUES (
        ${revisionId}, ${principal.tenantId}, ${dashboardId}, ${number},
        ${checkpoint.id}, ${checkpoint.artifactKey}, ${checkpoint.digest},
        ${checkpoint.fileCount}, ${checkpoint.totalBytes},
        ${message ?? null}, ${principal.userId}, ${now.toISOString()}
      )
      RETURNING id, tenant_id, dashboard_id, revision_number, artifact_key,
        content_digest, file_count, total_bytes, message, created_at
    `;
    const row = rows[0] as Row | undefined;
    if (!row) throw new Error("Revision insert returned no row");
    const revision = toRevision(row);
    const event = {
      id: `event_${crypto.randomUUID()}`,
      type: "dashboard.revision-created",
      schemaVersion: 1,
      tenantId: principal.tenantId,
      aggregateId: revision.id,
      aggregateVersion: revision.number,
      occurredAt: revision.createdAt,
      requestId,
      data: { dashboardId, revisionNumber: revision.number },
    };
    await transaction`
      INSERT INTO control_outbox (
        id, tenant_id, event_type, aggregate_id, payload, occurred_at
      ) VALUES (
        ${event.id}, ${principal.tenantId}, ${event.type}, ${revision.id},
        ${JSON.stringify(event)}::jsonb, ${revision.createdAt}
      )
    `;
    await transaction`
      INSERT INTO audit_events (
        id, tenant_id, actor_id, action, aggregate_id,
        request_id, data, occurred_at
      ) VALUES (
        ${`audit_${crypto.randomUUID()}`}, ${principal.tenantId},
        ${principal.userId}, ${event.type}, ${revision.id}, ${requestId},
        ${JSON.stringify({ dashboardId, revisionNumber: revision.number })}::jsonb,
        ${revision.createdAt}
      )
    `;
    return { revision, created: true };
  });
}

export async function listDashboardRevisions(
  db: SQL,
  tenantId: string,
  dashboardId: string,
  limit: number,
): Promise<RevisionRecord[]> {
  const rows = await db`
    SELECT id, tenant_id, dashboard_id, revision_number, artifact_key,
      content_digest, file_count, total_bytes, message, created_at
    FROM dashboard_revisions
    WHERE tenant_id = ${tenantId} AND dashboard_id = ${dashboardId}
    ORDER BY revision_number DESC, id DESC
    LIMIT ${limit}
  `;
  return [...rows].map((row) => toRevision(row as Row));
}

export async function getDashboardRevision(
  db: SQL,
  tenantId: string,
  revisionId: string,
): Promise<RevisionRecord | undefined> {
  const rows = await db`
    SELECT id, tenant_id, dashboard_id, revision_number, artifact_key,
      content_digest, file_count, total_bytes, message, created_at
    FROM dashboard_revisions
    WHERE tenant_id = ${tenantId} AND id = ${revisionId}
    LIMIT 1
  `;
  const row = rows[0] as Row | undefined;
  return row ? toRevision(row) : undefined;
}
