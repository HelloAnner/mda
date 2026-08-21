import type { CreateDashboardRequest, Dashboard } from "@mda/contracts";
import type { SQL } from "bun";
import { HttpError } from "../../shared/http.ts";
import { createDashboard } from "./domain.ts";

const operation = "dashboard.create";

type Row = Record<string, unknown>;

function toDashboard(row: Row): Dashboard {
  return {
    id: String(row.id),
    name: String(row.name),
    ...(row.description === null || row.description === undefined
      ? {}
      : { description: String(row.description) }),
    status: row.status as Dashboard["status"],
    version: Number(row.version),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function insertDashboard(
  db: SQL,
  input: CreateDashboardRequest,
  principal: { tenantId: string; userId: string },
  idempotencyKey: string,
  requestId: string,
): Promise<{ dashboard: Dashboard; created: boolean }> {
  const dashboard = createDashboard(
    input,
    principal.tenantId,
    principal.userId,
  );
  const requestDigest = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(input))
    .digest("hex");

  try {
    return await db.begin(async (transaction) => {
      const claimed = await transaction`
        INSERT INTO control_idempotency_keys (
          tenant_id, operation, key, request_digest, result_id
        ) VALUES (
          ${principal.tenantId}, ${operation}, ${idempotencyKey},
          ${requestDigest}, ${dashboard.id}
        )
        ON CONFLICT DO NOTHING
        RETURNING result_id
      `;

      if (claimed.length === 0) {
        const existingKeys = await transaction`
          SELECT request_digest, result_id
          FROM control_idempotency_keys
          WHERE tenant_id = ${principal.tenantId}
            AND operation = ${operation}
            AND key = ${idempotencyKey}
        `;
        const existingKey = existingKeys[0] as Row | undefined;
        if (!existingKey || existingKey.request_digest !== requestDigest) {
          throw new HttpError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for another request",
          );
        }
        const existingDashboards = await transaction`
          SELECT id, name, description, status, version, created_at, updated_at
          FROM dashboards
          WHERE tenant_id = ${principal.tenantId}
            AND id = ${String(existingKey.result_id)}
        `;
        const existingDashboard = existingDashboards[0] as Row | undefined;
        if (!existingDashboard)
          throw new Error("Idempotency result is missing");
        return { dashboard: toDashboard(existingDashboard), created: false };
      }

      const insertedDashboards = await transaction`
        INSERT INTO dashboards (
          id, tenant_id, name, normalized_name, description, status,
          version, created_by, created_at, updated_at
        ) VALUES (
          ${dashboard.id}, ${dashboard.tenantId}, ${dashboard.name},
          ${dashboard.normalizedName}, ${dashboard.description ?? null},
          ${dashboard.status}, ${dashboard.version}, ${dashboard.createdBy},
          ${dashboard.createdAt}, ${dashboard.updatedAt}
        )
        RETURNING id, name, description, status, version, created_at, updated_at
      `;
      const insertedDashboard = insertedDashboards[0] as Row | undefined;
      if (!insertedDashboard)
        throw new Error("Dashboard insert returned no row");
      const persistedDashboard = toDashboard(insertedDashboard);
      const event = {
        id: `event_${crypto.randomUUID()}`,
        type: "dashboard.created",
        schemaVersion: 1,
        tenantId: dashboard.tenantId,
        aggregateId: dashboard.id,
        aggregateVersion: dashboard.version,
        occurredAt: persistedDashboard.createdAt,
        requestId,
        data: { name: dashboard.name },
      };
      await transaction`
        INSERT INTO control_outbox (
          id, tenant_id, event_type, aggregate_id, payload, occurred_at
        ) VALUES (
          ${event.id}, ${dashboard.tenantId}, ${event.type}, ${dashboard.id},
          ${JSON.stringify(event)}::jsonb, ${persistedDashboard.createdAt}
        )
      `;
      await transaction`
        INSERT INTO audit_events (
          id, tenant_id, actor_id, action, aggregate_id,
          request_id, data, occurred_at
        ) VALUES (
          ${`audit_${crypto.randomUUID()}`}, ${dashboard.tenantId},
          ${dashboard.createdBy}, ${event.type}, ${dashboard.id}, ${requestId},
          ${JSON.stringify({ name: dashboard.name })}::jsonb,
          ${persistedDashboard.createdAt}
        )
      `;

      return { dashboard: persistedDashboard, created: true };
    });
  } catch (error) {
    if (
      !(error instanceof HttpError) &&
      ((error as { code?: string }).code === "23505" ||
        (error as { errno?: string }).errno === "23505")
    ) {
      throw new HttpError(
        409,
        "DASHBOARD_NAME_CONFLICT",
        "A Dashboard with this name already exists",
      );
    }
    throw error;
  }
}

export async function listDashboards(
  db: SQL,
  tenantId: string,
  limit: number,
): Promise<Dashboard[]> {
  const rows = await db`
    SELECT id, name, description, status, version, created_at, updated_at
    FROM dashboards
    WHERE tenant_id = ${tenantId}
    ORDER BY updated_at DESC, id DESC
    LIMIT ${limit}
  `;
  return [...rows].map((row) => toDashboard(row as Row));
}

export async function getDashboard(
  db: SQL,
  tenantId: string,
  id: string,
): Promise<Dashboard | undefined> {
  const rows = await db`
    SELECT id, name, description, status, version, created_at, updated_at
    FROM dashboards
    WHERE tenant_id = ${tenantId} AND id = ${id}
    LIMIT 1
  `;
  const row = rows[0] as Row | undefined;
  return row ? toDashboard(row) : undefined;
}
