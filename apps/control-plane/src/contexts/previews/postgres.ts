import type {
  AgentJob,
  AgentLeaseCommand,
  AgentTerminalError,
  CreateDashboardPreviewRequest,
  DashboardPreview,
} from "@mda/contracts";
import type { SQL } from "bun";
import { HttpError } from "../../shared/http.ts";
import { claimIdempotency, requestDigest } from "../../shared/idempotency.ts";
import { toAgentJob } from "../agent-work/postgres.ts";

export interface PreviewRecord extends Omit<DashboardPreview, "url"> {
  tenantId: string;
  artifactKey?: string;
}

export interface PreviewUploadContext {
  id: string;
  tenantId: string;
  dashboardId: string;
  jobId: string;
  checkpointId: string;
  revisionId?: string;
  sourceDigest: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  existing: boolean;
}

type Row = Record<string, unknown>;

function optionalIso(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : new Date(String(value)).toISOString();
}

function terminalError(value: unknown): AgentTerminalError | undefined {
  if (!value) return undefined;
  return (
    typeof value === "string" ? JSON.parse(value) : value
  ) as AgentTerminalError;
}

export function toPreviewRecord(row: Row, now = new Date()): PreviewRecord {
  const expiresAt = new Date(String(row.expires_at)).toISOString();
  const storedStatus = row.status as PreviewRecord["status"];
  const status =
    storedStatus !== "failed" && new Date(expiresAt).getTime() <= now.getTime()
      ? "expired"
      : storedStatus;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    dashboardId: String(row.dashboard_id),
    jobId: String(row.job_id),
    sourceCheckpointId: String(row.source_checkpoint_id),
    ...(row.source_revision_id
      ? { sourceRevisionId: String(row.source_revision_id) }
      : {}),
    sourceDigest: String(row.source_digest),
    status,
    templateVersion: "1",
    runtimeVersion: "1",
    ...(row.manifest_digest
      ? { manifestDigest: String(row.manifest_digest) }
      : {}),
    ...(row.build_digest ? { buildDigest: String(row.build_digest) } : {}),
    ...(row.file_count === null || row.file_count === undefined
      ? {}
      : { fileCount: Number(row.file_count) }),
    ...(row.total_bytes === null || row.total_bytes === undefined
      ? {}
      : { totalBytes: Number(row.total_bytes) }),
    ...(terminalError(row.terminal_error)
      ? { error: terminalError(row.terminal_error) }
      : {}),
    ...(row.artifact_key ? { artifactKey: String(row.artifact_key) } : {}),
    expiresAt,
    createdAt: new Date(String(row.created_at)).toISOString(),
    ...(optionalIso(row.completed_at)
      ? { completedAt: optionalIso(row.completed_at) }
      : {}),
  };
}

const previewSelect = `
  id, tenant_id, dashboard_id, job_id, source_checkpoint_id,
  source_revision_id, source_digest, status, template_version,
  runtime_version, manifest_digest, build_digest, artifact_key,
  file_count, total_bytes, terminal_error, created_at, completed_at, expires_at
`;

function assertLease(row: Row, command: AgentLeaseCommand, now: Date): void {
  if (
    row.state !== "running" ||
    row.lease_owner !== command.owner ||
    Number(row.fencing_token) !== command.fencingToken
  ) {
    throw new HttpError(409, "STALE_LEASE", "Agent lease is stale");
  }
  if (new Date(String(row.lease_expires_at)).getTime() <= now.getTime()) {
    throw new HttpError(409, "LEASE_EXPIRED", "Agent lease expired");
  }
}

export async function createDashboardPreview(
  db: SQL,
  dashboardId: string,
  input: CreateDashboardPreviewRequest,
  principal: { tenantId: string; userId: string },
  idempotencyKey: string,
  requestId: string,
  ttlSeconds: number,
  now = new Date(),
): Promise<{ preview: PreviewRecord; job: AgentJob; created: boolean }> {
  const previewId = `preview_${crypto.randomUUID()}`;
  const jobId = `job_${crypto.randomUUID()}`;
  const sessionId = `session_${crypto.randomUUID()}`;
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000).toISOString();
  const operation = `dashboard-preview.create:${dashboardId}`;

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

    const sourceRows = input.revisionId
      ? await transaction`
          SELECT r.id AS revision_id, r.checkpoint_id, r.content_digest
          FROM dashboard_revisions r
          WHERE r.tenant_id = ${principal.tenantId}
            AND r.dashboard_id = ${dashboardId}
            AND r.id = ${input.revisionId}
          LIMIT 1
        `
      : await transaction`
          SELECT NULL::text AS revision_id, c.id AS checkpoint_id,
            c.content_digest
          FROM draft_checkpoints c
          WHERE c.tenant_id = ${principal.tenantId}
            AND c.dashboard_id = ${dashboardId}
            AND c.status = 'active'
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT 1
        `;
    const source = sourceRows[0] as Row | undefined;
    if (!source) {
      throw new HttpError(
        input.revisionId ? 404 : 409,
        input.revisionId ? "REVISION_NOT_FOUND" : "DRAFT_NOT_AVAILABLE",
        input.revisionId
          ? "Dashboard Revision not found"
          : "Dashboard has no source Checkpoint to preview",
      );
    }

    const replayId = await claimIdempotency(transaction, {
      tenantId: principal.tenantId,
      operation,
      key: idempotencyKey,
      requestDigest: requestDigest({ dashboardId, ...input }),
      resultId: previewId,
    });
    if (replayId) {
      const previews = await transaction.unsafe(
        `SELECT ${previewSelect} FROM dashboard_previews WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [principal.tenantId, replayId],
      );
      const previewRow = previews[0] as Row | undefined;
      if (!previewRow) throw new Error("Idempotency result is missing");
      const jobs = await transaction`
        SELECT id, dashboard_id, session_id, purpose, state, attempt_count,
          lease_owner, fencing_token, lease_expires_at,
          cancellation_requested_at, terminal_error, version, created_at,
          started_at, finished_at
        FROM agent_jobs
        WHERE id = ${String(previewRow.job_id)}
      `;
      return {
        preview: toPreviewRecord(previewRow, now),
        job: toAgentJob(jobs[0] as Row),
        created: false,
      };
    }

    await transaction`
      INSERT INTO agent_sessions (
        id, tenant_id, dashboard_id, status, version, created_at, updated_at
      ) VALUES (
        ${sessionId}, ${principal.tenantId}, ${dashboardId}, 'open', 1,
        ${createdAt}, ${createdAt}
      )
    `;
    const jobs = await transaction`
      INSERT INTO agent_jobs (
        id, tenant_id, dashboard_id, session_id, purpose, prompt_text,
        source_checkpoint_id, source_revision_id, state, attempt_count,
        fencing_token, version, created_by, created_at
      ) VALUES (
        ${jobId}, ${principal.tenantId}, ${dashboardId}, ${sessionId},
        'preview', 'Build Dashboard Preview', ${String(source.checkpoint_id)},
        ${source.revision_id ? String(source.revision_id) : null}, 'queued',
        0, 0, 1, ${principal.userId}, ${createdAt}
      )
      RETURNING id, dashboard_id, session_id, purpose, state, attempt_count,
        lease_owner, fencing_token, lease_expires_at,
        cancellation_requested_at, terminal_error, version, created_at,
        started_at, finished_at
    `;
    const previews = await transaction`
      INSERT INTO dashboard_previews (
        id, tenant_id, dashboard_id, job_id, source_checkpoint_id,
        source_revision_id, source_digest, status, template_version,
        runtime_version, created_by, created_at, expires_at
      ) VALUES (
        ${previewId}, ${principal.tenantId}, ${dashboardId}, ${jobId},
        ${String(source.checkpoint_id)},
        ${source.revision_id ? String(source.revision_id) : null},
        ${String(source.content_digest)}, 'building', '1', '1',
        ${principal.userId}, ${createdAt}, ${expiresAt}
      )
      RETURNING id, tenant_id, dashboard_id, job_id, source_checkpoint_id,
        source_revision_id, source_digest, status, template_version,
        runtime_version, manifest_digest, build_digest, artifact_key,
        file_count, total_bytes, terminal_error, created_at, completed_at,
        expires_at
    `;
    const job = toAgentJob(jobs[0] as Row);
    const preview = toPreviewRecord(previews[0] as Row, now);
    const event = {
      id: `event_${crypto.randomUUID()}`,
      type: "agent.job-queued",
      schemaVersion: 1,
      tenantId: principal.tenantId,
      aggregateId: job.id,
      aggregateVersion: job.version,
      occurredAt: createdAt,
      requestId,
      data: { jobId: job.id, purpose: "preview", previewId },
    };
    await transaction`
      INSERT INTO control_outbox (
        id, tenant_id, event_type, aggregate_id, payload, occurred_at
      ) VALUES (
        ${event.id}, ${principal.tenantId}, ${event.type}, ${job.id},
        ${JSON.stringify(event)}::jsonb, ${createdAt}
      )
    `;
    await transaction`
      INSERT INTO audit_events (
        id, tenant_id, actor_id, action, aggregate_id,
        request_id, data, occurred_at
      ) VALUES (
        ${`audit_${crypto.randomUUID()}`}, ${principal.tenantId},
        ${principal.userId}, 'dashboard.preview-requested', ${previewId},
        ${requestId},
        ${JSON.stringify({ dashboardId, jobId, revisionId: source.revision_id ?? null })}::jsonb,
        ${createdAt}
      )
    `;
    return { preview, job, created: true };
  });
}

export async function getPreviewUploadContext(
  db: SQL,
  jobId: string,
  command: AgentLeaseCommand,
  sourceDigest: string,
  now = new Date(),
  ttlSeconds = 3_600,
): Promise<PreviewUploadContext> {
  return db.begin(async (transaction) => {
    const jobs = await transaction`
      SELECT id, tenant_id, dashboard_id, purpose, created_by, state,
        lease_owner, fencing_token, lease_expires_at
      FROM agent_jobs WHERE id = ${jobId} FOR UPDATE
    `;
    const job = jobs[0] as Row | undefined;
    if (!job) {
      throw new HttpError(404, "AGENT_JOB_NOT_FOUND", "Agent Job not found");
    }
    assertLease(job, command, now);
    const existingRows = await transaction.unsafe(
      `SELECT ${previewSelect} FROM dashboard_previews WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [jobId],
    );
    const existing = existingRows[0] as Row | undefined;
    if (existing) {
      return {
        id: String(existing.id),
        tenantId: String(existing.tenant_id),
        dashboardId: String(existing.dashboard_id),
        jobId,
        checkpointId: String(existing.source_checkpoint_id),
        ...(existing.source_revision_id
          ? { revisionId: String(existing.source_revision_id) }
          : {}),
        sourceDigest: String(existing.source_digest),
        createdBy: String(job.created_by),
        createdAt: new Date(String(existing.created_at)).toISOString(),
        expiresAt: new Date(String(existing.expires_at)).toISOString(),
        existing: true,
      };
    }
    if (job.purpose !== "edit") {
      throw new HttpError(
        409,
        "PREVIEW_NOT_REQUESTED",
        "Agent Job has no pending Preview",
      );
    }
    const checkpoints = await transaction`
      SELECT id, content_digest, created_at
      FROM draft_checkpoints
      WHERE (job_id = ${jobId} AND status = 'staged')
         OR (
           tenant_id = ${String(job.tenant_id)}
           AND dashboard_id = ${String(job.dashboard_id)}
           AND status = 'active'
           AND content_digest = ${sourceDigest}
         )
      ORDER BY CASE WHEN job_id = ${jobId} THEN 0 ELSE 1 END,
        created_at DESC, id DESC
      LIMIT 1
    `;
    const checkpoint = checkpoints[0] as Row | undefined;
    if (!checkpoint) {
      throw new HttpError(
        409,
        "CHECKPOINT_REQUIRED",
        "Preview build does not match a durable source Checkpoint",
      );
    }
    return {
      id: `preview_${crypto.randomUUID()}`,
      tenantId: String(job.tenant_id),
      dashboardId: String(job.dashboard_id),
      jobId,
      checkpointId: String(checkpoint.id),
      sourceDigest: String(checkpoint.content_digest),
      createdBy: String(job.created_by),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
      existing: false,
    };
  });
}

export async function completePreview(
  db: SQL,
  context: PreviewUploadContext,
  command: AgentLeaseCommand,
  artifact: {
    sourceDigest: string;
    manifestDigest: string;
    digest: string;
    artifactKey: string;
    fileCount: number;
    totalBytes: number;
  },
  now = new Date(),
): Promise<PreviewRecord> {
  return db.begin(async (transaction) => {
    const jobs = await transaction`
      SELECT state, lease_owner, fencing_token, lease_expires_at
      FROM agent_jobs WHERE id = ${context.jobId} FOR UPDATE
    `;
    const job = jobs[0] as Row | undefined;
    if (!job) {
      throw new HttpError(404, "AGENT_JOB_NOT_FOUND", "Agent Job not found");
    }
    assertLease(job, command, now);
    if (artifact.sourceDigest !== context.sourceDigest) {
      throw new HttpError(
        409,
        "PREVIEW_SOURCE_CONFLICT",
        "Preview build does not match its pinned source",
      );
    }
    const existingRows = await transaction.unsafe(
      `SELECT ${previewSelect} FROM dashboard_previews WHERE id = $1 FOR UPDATE`,
      [context.id],
    );
    const existing = existingRows[0] as Row | undefined;
    if (existing?.status === "ready") {
      const preview = toPreviewRecord(existing, now);
      if (preview.buildDigest !== artifact.digest) {
        throw new HttpError(
          409,
          "PREVIEW_BUILD_CONFLICT",
          "Preview already contains a different build",
        );
      }
      return preview;
    }
    const rows = existing
      ? await transaction`
          UPDATE dashboard_previews
          SET status = 'ready', manifest_digest = ${artifact.manifestDigest},
            build_digest = ${artifact.digest}, artifact_key = ${artifact.artifactKey},
            file_count = ${artifact.fileCount}, total_bytes = ${artifact.totalBytes},
            terminal_error = NULL, completed_at = ${now.toISOString()}
          WHERE id = ${context.id} AND status = 'building'
          RETURNING id, tenant_id, dashboard_id, job_id, source_checkpoint_id,
            source_revision_id, source_digest, status, template_version,
            runtime_version, manifest_digest, build_digest, artifact_key,
            file_count, total_bytes, terminal_error, created_at, completed_at,
            expires_at
        `
      : await transaction`
          INSERT INTO dashboard_previews (
            id, tenant_id, dashboard_id, job_id, source_checkpoint_id,
            source_revision_id, source_digest, status, template_version,
            runtime_version, manifest_digest, build_digest, artifact_key,
            file_count, total_bytes, created_by, created_at, completed_at,
            expires_at
          ) VALUES (
            ${context.id}, ${context.tenantId}, ${context.dashboardId},
            ${context.jobId}, ${context.checkpointId},
            ${context.revisionId ?? null}, ${context.sourceDigest}, 'ready',
            '1', '1', ${artifact.manifestDigest}, ${artifact.digest},
            ${artifact.artifactKey}, ${artifact.fileCount},
            ${artifact.totalBytes}, ${context.createdBy}, ${context.createdAt},
            ${now.toISOString()}, ${context.expiresAt}
          )
          RETURNING id, tenant_id, dashboard_id, job_id, source_checkpoint_id,
            source_revision_id, source_digest, status, template_version,
            runtime_version, manifest_digest, build_digest, artifact_key,
            file_count, total_bytes, terminal_error, created_at, completed_at,
            expires_at
        `;
    const row = rows[0] as Row | undefined;
    if (!row) {
      throw new HttpError(409, "PREVIEW_STATE_CONFLICT", "Preview changed");
    }
    return toPreviewRecord(row, now);
  });
}

export async function getDashboardPreview(
  db: SQL,
  tenantId: string,
  previewId: string,
): Promise<PreviewRecord | undefined> {
  const rows = await db.unsafe(
    `SELECT ${previewSelect} FROM dashboard_previews WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, previewId],
  );
  const row = rows[0] as Row | undefined;
  return row ? toPreviewRecord(row) : undefined;
}

export async function getDashboardPreviewForDelivery(
  db: SQL,
  previewId: string,
): Promise<PreviewRecord | undefined> {
  const rows = await db.unsafe(
    `SELECT ${previewSelect} FROM dashboard_previews WHERE id = $1 LIMIT 1`,
    [previewId],
  );
  const row = rows[0] as Row | undefined;
  return row ? toPreviewRecord(row) : undefined;
}

export async function listDashboardPreviews(
  db: SQL,
  tenantId: string,
  dashboardId: string,
  limit: number,
): Promise<PreviewRecord[]> {
  const rows = await db.unsafe(
    `SELECT ${previewSelect} FROM dashboard_previews
     WHERE tenant_id = $1 AND dashboard_id = $2
     ORDER BY created_at DESC, id DESC LIMIT $3`,
    [tenantId, dashboardId, limit],
  );
  return [...rows].map((row) => toPreviewRecord(row as Row));
}
