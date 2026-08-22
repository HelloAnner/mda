import type {
  AgentJob,
  AgentLeaseCommand,
  AgentTerminalError,
  CreatePublicationRequest,
  Publication,
  PublicationBuild,
} from "@mda/contracts";
import type { SQL } from "bun";
import { HttpError } from "../../shared/http.ts";
import { claimIdempotency, requestDigest } from "../../shared/idempotency.ts";
import { toAgentJob } from "../agent-work/postgres.ts";

export interface PublicationRecord extends Publication {
  tenantId: string;
  artifactKey: string;
}

export interface PublicationBuildRecord extends PublicationBuild {
  tenantId: string;
  checkpointId: string;
  requestedBy: string;
  requestId: string;
}

type Row = Record<string, unknown>;

const buildSelect = `
  id, tenant_id, dashboard_id, revision_id, checkpoint_id, job_id,
  source_digest, status, publication_id, terminal_error, requested_by,
  request_id, created_at, completed_at
`;

const publicationSelect = `
  id, tenant_id, dashboard_id, publication_number, revision_id, build_id,
  source_digest, manifest_digest, build_digest, template_version,
  runtime_version, artifact_key, file_count, total_bytes, created_at
`;

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

function toBuild(row: Row): PublicationBuildRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    dashboardId: String(row.dashboard_id),
    revisionId: String(row.revision_id),
    checkpointId: String(row.checkpoint_id),
    jobId: String(row.job_id),
    sourceDigest: String(row.source_digest),
    status: row.status as PublicationBuild["status"],
    ...(row.publication_id
      ? { publicationId: String(row.publication_id) }
      : {}),
    ...(terminalError(row.terminal_error)
      ? { error: terminalError(row.terminal_error) }
      : {}),
    requestedBy: String(row.requested_by),
    requestId: String(row.request_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    ...(optionalIso(row.completed_at)
      ? { completedAt: optionalIso(row.completed_at) }
      : {}),
  };
}

function toPublication(row: Row): PublicationRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    dashboardId: String(row.dashboard_id),
    revisionId: String(row.revision_id),
    number: Number(row.publication_number),
    sourceDigest: String(row.source_digest),
    manifestDigest: String(row.manifest_digest),
    buildDigest: String(row.build_digest),
    templateVersion: "1",
    runtimeVersion: "1",
    artifactKey: String(row.artifact_key),
    fileCount: Number(row.file_count),
    totalBytes: Number(row.total_bytes),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

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

export async function createPublicationBuild(
  db: SQL,
  dashboardId: string,
  input: CreatePublicationRequest,
  principal: { tenantId: string; userId: string },
  idempotencyKey: string,
  requestId: string,
  now = new Date(),
): Promise<{ build: PublicationBuildRecord; job: AgentJob; created: boolean }> {
  const buildId = `publication-build_${crypto.randomUUID()}`;
  const jobId = `job_${crypto.randomUUID()}`;
  const sessionId = `session_${crypto.randomUUID()}`;
  const createdAt = now.toISOString();
  const operation = `publication.create:${dashboardId}`;

  return db.begin(async (transaction) => {
    const revisions = await transaction`
      SELECT r.id, r.checkpoint_id, r.content_digest
      FROM dashboard_revisions r
      JOIN dashboards d
        ON d.id = r.dashboard_id AND d.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${principal.tenantId}
        AND r.dashboard_id = ${dashboardId}
        AND r.id = ${input.revisionId}
        AND d.status = 'active'
      LIMIT 1
    `;
    const revision = revisions[0] as Row | undefined;
    if (!revision) {
      throw new HttpError(
        404,
        "REVISION_NOT_FOUND",
        "Dashboard Revision not found",
      );
    }
    const replayId = await claimIdempotency(transaction, {
      tenantId: principal.tenantId,
      operation,
      key: idempotencyKey,
      requestDigest: requestDigest({
        dashboardId,
        revisionId: input.revisionId,
      }),
      resultId: buildId,
    });
    if (replayId) {
      const buildRows = await transaction.unsafe(
        `SELECT ${buildSelect} FROM publication_builds WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [principal.tenantId, replayId],
      );
      const buildRow = buildRows[0] as Row | undefined;
      if (!buildRow) throw new Error("Idempotency result is missing");
      const jobs = await transaction`
        SELECT id, dashboard_id, session_id, purpose, state, attempt_count,
          lease_owner, fencing_token, lease_expires_at,
          cancellation_requested_at, terminal_error, version, created_at,
          started_at, finished_at
        FROM agent_jobs
        WHERE id = ${String(buildRow.job_id)}
      `;
      return {
        build: toBuild(buildRow),
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
        'publish', 'Build immutable Dashboard Publication',
        ${String(revision.checkpoint_id)}, ${input.revisionId}, 'queued',
        0, 0, 1, ${principal.userId}, ${createdAt}
      )
      RETURNING id, dashboard_id, session_id, purpose, state, attempt_count,
        lease_owner, fencing_token, lease_expires_at,
        cancellation_requested_at, terminal_error, version, created_at,
        started_at, finished_at
    `;
    const builds = await transaction`
      INSERT INTO publication_builds (
        id, tenant_id, dashboard_id, revision_id, checkpoint_id, job_id,
        source_digest, status, requested_by, request_id, created_at
      ) VALUES (
        ${buildId}, ${principal.tenantId}, ${dashboardId}, ${input.revisionId},
        ${String(revision.checkpoint_id)}, ${jobId},
        ${String(revision.content_digest)}, 'building', ${principal.userId},
        ${requestId}, ${createdAt}
      )
      RETURNING id, tenant_id, dashboard_id, revision_id, checkpoint_id,
        job_id, source_digest, status, publication_id, terminal_error,
        requested_by, request_id, created_at, completed_at
    `;
    const job = toAgentJob(jobs[0] as Row);
    const build = toBuild(builds[0] as Row);
    const event = {
      id: `event_${crypto.randomUUID()}`,
      type: "agent.job-queued",
      schemaVersion: 1,
      tenantId: principal.tenantId,
      aggregateId: job.id,
      aggregateVersion: job.version,
      occurredAt: createdAt,
      requestId,
      data: {
        jobId,
        purpose: "publish",
        buildId,
        revisionId: input.revisionId,
      },
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
        ${principal.userId}, 'publication.requested', ${buildId}, ${requestId},
        ${JSON.stringify({ dashboardId, revisionId: input.revisionId, jobId })}::jsonb,
        ${createdAt}
      )
    `;
    return { build, job, created: true };
  });
}

export async function getPublicationUploadContext(
  db: SQL,
  jobId: string,
  command: AgentLeaseCommand,
  now = new Date(),
): Promise<PublicationBuildRecord> {
  return db.begin(async (transaction) => {
    const jobs = await transaction`
      SELECT state, lease_owner, fencing_token, lease_expires_at
      FROM agent_jobs WHERE id = ${jobId} FOR UPDATE
    `;
    const job = jobs[0] as Row | undefined;
    if (!job) {
      throw new HttpError(404, "AGENT_JOB_NOT_FOUND", "Agent Job not found");
    }
    assertLease(job, command, now);
    const builds = await transaction.unsafe(
      `SELECT ${buildSelect} FROM publication_builds WHERE job_id = $1 LIMIT 1`,
      [jobId],
    );
    const build = builds[0] as Row | undefined;
    if (!build) {
      throw new HttpError(
        409,
        "PUBLICATION_NOT_REQUESTED",
        "Agent Job has no Publication Build",
      );
    }
    return toBuild(build);
  });
}

export async function completePublication(
  db: SQL,
  buildId: string,
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
): Promise<PublicationRecord> {
  return db.begin(async (transaction) => {
    const buildRows = await transaction.unsafe(
      `SELECT ${buildSelect} FROM publication_builds WHERE id = $1 FOR UPDATE`,
      [buildId],
    );
    const buildRow = buildRows[0] as Row | undefined;
    if (!buildRow) {
      throw new HttpError(
        404,
        "PUBLICATION_BUILD_NOT_FOUND",
        "Publication Build not found",
      );
    }
    const build = toBuild(buildRow);
    const jobs = await transaction`
      SELECT state, lease_owner, fencing_token, lease_expires_at
      FROM agent_jobs WHERE id = ${build.jobId} FOR UPDATE
    `;
    const job = jobs[0] as Row | undefined;
    if (!job) throw new Error("Publication Build Job is missing");
    assertLease(job, command, now);
    if (build.status === "ready" && build.publicationId) {
      const existing = await transaction.unsafe(
        `SELECT ${publicationSelect} FROM publications WHERE id = $1 LIMIT 1`,
        [build.publicationId],
      );
      const publication = toPublication(existing[0] as Row);
      if (publication.buildDigest !== artifact.digest) {
        throw new HttpError(
          409,
          "PUBLICATION_BUILD_CONFLICT",
          "Publication Build already contains a different artifact",
        );
      }
      return publication;
    }
    if (build.status !== "building") {
      throw new HttpError(
        409,
        "PUBLICATION_BUILD_CONFLICT",
        "Publication Build is not active",
      );
    }
    if (build.sourceDigest !== artifact.sourceDigest) {
      throw new HttpError(
        409,
        "PUBLICATION_SOURCE_CONFLICT",
        "Publication build does not match its Revision source",
      );
    }
    const numberRows = await transaction`
      SELECT COALESCE(max(publication_number), 0)::int + 1 AS number
      FROM publications
      WHERE tenant_id = ${build.tenantId}
        AND dashboard_id = ${build.dashboardId}
    `;
    const number = Number((numberRows[0] as Row).number);
    const publicationId = `publication_${crypto.randomUUID()}`;
    const rows = await transaction`
      INSERT INTO publications (
        id, tenant_id, dashboard_id, publication_number, revision_id,
        build_id, source_digest, manifest_digest, build_digest,
        template_version, runtime_version, artifact_key, file_count,
        total_bytes, created_by, created_at
      ) VALUES (
        ${publicationId}, ${build.tenantId}, ${build.dashboardId}, ${number},
        ${build.revisionId}, ${build.id}, ${artifact.sourceDigest},
        ${artifact.manifestDigest}, ${artifact.digest}, '1', '1',
        ${artifact.artifactKey}, ${artifact.fileCount}, ${artifact.totalBytes},
        ${build.requestedBy}, ${now.toISOString()}
      )
      RETURNING id, tenant_id, dashboard_id, publication_number, revision_id,
        build_id, source_digest, manifest_digest, build_digest,
        template_version, runtime_version, artifact_key, file_count,
        total_bytes, created_at
    `;
    await transaction`
      UPDATE publication_builds
      SET status = 'ready', publication_id = ${publicationId},
        completed_at = ${now.toISOString()}
      WHERE id = ${build.id} AND status = 'building'
    `;
    const publication = toPublication(rows[0] as Row);
    const event = {
      id: `event_${crypto.randomUUID()}`,
      type: "publication.created",
      schemaVersion: 1,
      tenantId: build.tenantId,
      aggregateId: publication.id,
      aggregateVersion: publication.number,
      occurredAt: publication.createdAt,
      requestId: build.requestId,
      data: {
        dashboardId: build.dashboardId,
        revisionId: build.revisionId,
        publicationNumber: publication.number,
        buildDigest: publication.buildDigest,
      },
    };
    await transaction`
      INSERT INTO control_outbox (
        id, tenant_id, event_type, aggregate_id, payload, occurred_at
      ) VALUES (
        ${event.id}, ${build.tenantId}, ${event.type}, ${publication.id},
        ${JSON.stringify(event)}::jsonb, ${publication.createdAt}
      )
    `;
    await transaction`
      INSERT INTO audit_events (
        id, tenant_id, actor_id, action, aggregate_id,
        request_id, data, occurred_at
      ) VALUES (
        ${`audit_${crypto.randomUUID()}`}, ${build.tenantId},
        ${build.requestedBy}, ${event.type}, ${publication.id},
        ${build.requestId},
        ${JSON.stringify({ dashboardId: build.dashboardId, revisionId: build.revisionId, publicationNumber: publication.number, buildDigest: publication.buildDigest })}::jsonb,
        ${publication.createdAt}
      )
    `;
    return publication;
  });
}

export async function getPublicationBuild(
  db: SQL,
  tenantId: string,
  buildId: string,
): Promise<PublicationBuildRecord | undefined> {
  const rows = await db.unsafe(
    `SELECT ${buildSelect} FROM publication_builds WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, buildId],
  );
  const row = rows[0] as Row | undefined;
  return row ? toBuild(row) : undefined;
}

export async function getPublication(
  db: SQL,
  tenantId: string,
  publicationId: string,
): Promise<PublicationRecord | undefined> {
  const rows = await db.unsafe(
    `SELECT ${publicationSelect} FROM publications WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, publicationId],
  );
  const row = rows[0] as Row | undefined;
  return row ? toPublication(row) : undefined;
}

export async function listPublications(
  db: SQL,
  tenantId: string,
  dashboardId: string,
  limit: number,
): Promise<PublicationRecord[]> {
  const rows = await db.unsafe(
    `SELECT ${publicationSelect} FROM publications
     WHERE tenant_id = $1 AND dashboard_id = $2
     ORDER BY publication_number DESC, id DESC LIMIT $3`,
    [tenantId, dashboardId, limit],
  );
  return [...rows].map((row) => toPublication(row as Row));
}
