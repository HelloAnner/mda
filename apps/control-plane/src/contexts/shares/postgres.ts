import type { CreateShareLinkRequest, ShareLink } from "@mda/contracts";
import type { SQL } from "bun";
import { HttpError } from "../../shared/http.ts";
import { claimIdempotency, requestDigest } from "../../shared/idempotency.ts";
import { shareToken, shareTokenDigest } from "./token.ts";

export interface ShareLinkRecord extends ShareLink {
  tenantId: string;
  tokenDigest: string;
}

type Row = Record<string, unknown>;

function toShareLink(row: Row, now = new Date()): ShareLinkRecord {
  const stored = row.status as "active" | "revoked";
  const expiresAt = row.expires_at
    ? new Date(String(row.expires_at)).toISOString()
    : undefined;
  const status =
    stored === "active" &&
    expiresAt &&
    new Date(expiresAt).getTime() <= now.getTime()
      ? "expired"
      : stored;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    dashboardId: String(row.dashboard_id),
    publicationId: String(row.publication_id),
    access: "public",
    tokenDigest: String(row.token_digest),
    status,
    version: Number(row.version),
    ...(expiresAt ? { expiresAt } : {}),
    createdAt: new Date(String(row.created_at)).toISOString(),
    ...(row.revoked_at
      ? { revokedAt: new Date(String(row.revoked_at)).toISOString() }
      : {}),
  };
}

const shareSelect = `
  id, tenant_id, dashboard_id, publication_id, access_mode,
  token_digest, status, version, expires_at, created_at, revoked_at
`;

export async function createShareLink(
  db: SQL,
  publicationId: string,
  input: CreateShareLinkRequest,
  principal: { tenantId: string; userId: string },
  idempotencyKey: string,
  requestId: string,
  signingKey: string,
  now = new Date(),
): Promise<{ shareLink: ShareLinkRecord; token: string; created: boolean }> {
  const id = `share_${crypto.randomUUID()}`;
  const token = shareToken(signingKey, id);
  const digest = shareTokenDigest(token);
  const createdAt = now.toISOString();
  const expiresAt = input.expiresInSeconds
    ? new Date(now.getTime() + input.expiresInSeconds * 1_000).toISOString()
    : undefined;
  const operation = `share-link.create:${publicationId}`;

  return db.begin(async (transaction) => {
    const publications = await transaction`
      SELECT id, dashboard_id FROM publications
      WHERE tenant_id = ${principal.tenantId} AND id = ${publicationId}
      LIMIT 1
    `;
    const publication = publications[0] as Row | undefined;
    if (!publication) {
      throw new HttpError(
        404,
        "PUBLICATION_NOT_FOUND",
        "Publication not found",
      );
    }
    const blockedBindings = await transaction`
      SELECT 1 FROM publication_query_bindings
      WHERE publication_id = ${publicationId} AND public_execution = FALSE
      LIMIT 1
    `;
    if (blockedBindings.length) {
      throw new HttpError(
        409,
        "PUBLIC_QUERY_NOT_APPROVED",
        "Publication contains a Query that is not approved for public execution",
      );
    }
    const replayId = await claimIdempotency(transaction, {
      tenantId: principal.tenantId,
      operation,
      key: idempotencyKey,
      requestDigest: requestDigest({ publicationId, ...input }),
      resultId: id,
    });
    if (replayId) {
      const rows = await transaction.unsafe(
        `SELECT ${shareSelect} FROM share_links WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [principal.tenantId, replayId],
      );
      const row = rows[0] as Row | undefined;
      if (!row) throw new Error("Idempotency result is missing");
      return {
        shareLink: toShareLink(row, now),
        token: shareToken(signingKey, replayId),
        created: false,
      };
    }
    const rows = await transaction`
      INSERT INTO share_links (
        id, tenant_id, dashboard_id, publication_id, access_mode,
        token_digest, status, version, expires_at, created_by, created_at
      ) VALUES (
        ${id}, ${principal.tenantId}, ${String(publication.dashboard_id)},
        ${publicationId}, 'public', ${digest}, 'active', 1,
        ${expiresAt ?? null}, ${principal.userId}, ${createdAt}
      )
      RETURNING id, tenant_id, dashboard_id, publication_id, access_mode,
        token_digest, status, version, expires_at, created_at, revoked_at
    `;
    const shareLink = toShareLink(rows[0] as Row, now);
    const event = {
      id: `event_${crypto.randomUUID()}`,
      type: "share-link.created",
      schemaVersion: 1,
      tenantId: principal.tenantId,
      aggregateId: id,
      aggregateVersion: 1,
      occurredAt: createdAt,
      requestId,
      data: {
        dashboardId: shareLink.dashboardId,
        publicationId,
        access: "public",
        expiresAt: expiresAt ?? null,
      },
    };
    await transaction`
      INSERT INTO control_outbox (
        id, tenant_id, event_type, aggregate_id, payload, occurred_at
      ) VALUES (
        ${event.id}, ${principal.tenantId}, ${event.type}, ${id},
        ${JSON.stringify(event)}::jsonb, ${createdAt}
      )
    `;
    await transaction`
      INSERT INTO audit_events (
        id, tenant_id, actor_id, action, aggregate_id,
        request_id, data, occurred_at
      ) VALUES (
        ${`audit_${crypto.randomUUID()}`}, ${principal.tenantId},
        ${principal.userId}, ${event.type}, ${id}, ${requestId},
        ${JSON.stringify(event.data)}::jsonb, ${createdAt}
      )
    `;
    return { shareLink, token, created: true };
  });
}

export async function getShareLink(
  db: SQL,
  tenantId: string,
  id: string,
): Promise<ShareLinkRecord | undefined> {
  const rows = await db.unsafe(
    `SELECT ${shareSelect} FROM share_links WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0] as Row | undefined;
  return row ? toShareLink(row) : undefined;
}

export async function getShareLinkByTokenDigest(
  db: SQL,
  tokenDigest: string,
): Promise<ShareLinkRecord | undefined> {
  const rows = await db.unsafe(
    `SELECT ${shareSelect} FROM share_links WHERE token_digest = $1 LIMIT 1`,
    [tokenDigest],
  );
  const row = rows[0] as Row | undefined;
  return row ? toShareLink(row) : undefined;
}

export async function listShareLinks(
  db: SQL,
  tenantId: string,
  dashboardId: string,
  limit: number,
): Promise<ShareLinkRecord[]> {
  const rows = await db.unsafe(
    `SELECT ${shareSelect} FROM share_links
     WHERE tenant_id = $1 AND dashboard_id = $2
     ORDER BY created_at DESC, id DESC LIMIT $3`,
    [tenantId, dashboardId, limit],
  );
  return [...rows].map((row) => toShareLink(row as Row));
}

export async function revokeShareLink(
  db: SQL,
  tenantId: string,
  id: string,
  userId: string,
  requestId: string,
  now = new Date(),
): Promise<ShareLinkRecord> {
  return db.begin(async (transaction) => {
    const rows = await transaction.unsafe(
      `SELECT ${shareSelect} FROM share_links WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id],
    );
    const row = rows[0] as Row | undefined;
    if (!row) {
      throw new HttpError(404, "SHARE_LINK_NOT_FOUND", "Share Link not found");
    }
    if (row.status === "revoked") return toShareLink(row, now);
    const updated = await transaction`
      UPDATE share_links
      SET status = 'revoked', version = version + 1,
        revoked_by = ${userId}, revoked_at = ${now.toISOString()}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'active'
      RETURNING id, tenant_id, dashboard_id, publication_id, access_mode,
        token_digest, status, version, expires_at, created_at, revoked_at
    `;
    const shareLink = toShareLink(updated[0] as Row, now);
    const event = {
      id: `event_${crypto.randomUUID()}`,
      type: "share-link.revoked",
      schemaVersion: 1,
      tenantId,
      aggregateId: id,
      aggregateVersion: shareLink.version,
      occurredAt: now.toISOString(),
      requestId,
      data: {
        dashboardId: shareLink.dashboardId,
        publicationId: shareLink.publicationId,
      },
    };
    await transaction`
      INSERT INTO control_outbox (
        id, tenant_id, event_type, aggregate_id, payload, occurred_at
      ) VALUES (
        ${event.id}, ${tenantId}, ${event.type}, ${id},
        ${JSON.stringify(event)}::jsonb, ${event.occurredAt}
      )
    `;
    await transaction`
      INSERT INTO audit_events (
        id, tenant_id, actor_id, action, aggregate_id,
        request_id, data, occurred_at
      ) VALUES (
        ${`audit_${crypto.randomUUID()}`}, ${tenantId}, ${userId},
        ${event.type}, ${id}, ${requestId}, ${JSON.stringify(event.data)}::jsonb,
        ${event.occurredAt}
      )
    `;
    return shareLink;
  });
}
