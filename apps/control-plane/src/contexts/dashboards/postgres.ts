import type {
  ArchiveDashboardRequest,
  CreateDashboardRequest,
  Dashboard,
  UpdateDashboardRequest,
} from "@mda/contracts";
import type { SQL } from "bun";
import { HttpError } from "../../shared/http.ts";
import { claimIdempotency, requestDigest } from "../../shared/idempotency.ts";
import { createDashboard, normalizeDashboardName } from "./domain.ts";

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
  const digest = requestDigest(input);

  try {
    return await db.begin(async (transaction) => {
      const existingResultId = await claimIdempotency(transaction, {
        tenantId: principal.tenantId,
        operation,
        key: idempotencyKey,
        requestDigest: digest,
        resultId: dashboard.id,
      });

      if (existingResultId) {
        const existingDashboards = await transaction`
          SELECT id, name, description, status, version, created_at, updated_at
          FROM dashboards
          WHERE tenant_id = ${principal.tenantId}
            AND id = ${existingResultId}
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

export async function updateDashboard(
  db: SQL,
  tenantId: string,
  userId: string,
  requestId: string,
  id: string,
  input: UpdateDashboardRequest | ArchiveDashboardRequest,
  archive = false,
): Promise<Dashboard> {
  try {
    return await db.begin(async (transaction) => {
      const current = await transaction`
        SELECT id, name, normalized_name, description, status, version,
          created_at, updated_at
        FROM dashboards
        WHERE tenant_id = ${tenantId} AND id = ${id}
        FOR UPDATE
      `;
      const row = current[0] as Row | undefined;
      if (!row) {
        throw new HttpError(404, "DASHBOARD_NOT_FOUND", "Dashboard not found");
      }
      if (Number(row.version) !== input.expectedVersion) {
        throw new HttpError(409, "VERSION_CONFLICT", "Dashboard changed");
      }
      if (row.status === "archived") {
        if (archive) return toDashboard(row);
        throw new HttpError(409, "DASHBOARD_ARCHIVED", "Dashboard is archived");
      }
      const update = archive ? undefined : (input as UpdateDashboardRequest);
      const name = update?.name
        ? normalizeDashboardName(update.name)
        : {
            name: String(row.name),
            normalizedName: String(row.normalized_name),
          };
      const description =
        update?.description === undefined
          ? row.description
          : update.description?.trim() || null;
      const now = new Date().toISOString();
      const updated = await transaction`
        UPDATE dashboards
        SET name = ${name.name}, normalized_name = ${name.normalizedName},
          description = ${description ?? null},
          status = ${archive ? "archived" : "active"},
          version = version + 1, updated_at = ${now}
        WHERE tenant_id = ${tenantId} AND id = ${id}
          AND version = ${input.expectedVersion}
        RETURNING id, name, description, status, version, created_at, updated_at
      `;
      const dashboard = toDashboard(updated[0] as Row);
      const action = archive
        ? "dashboard.archived"
        : "dashboard.metadata-updated";
      const data = archive
        ? {}
        : { name: dashboard.name, description: dashboard.description ?? null };
      await transaction`
        INSERT INTO control_outbox (
          id, tenant_id, event_type, aggregate_id, payload, occurred_at
        ) VALUES (
          ${`event_${crypto.randomUUID()}`}, ${tenantId}, ${action}, ${id},
          ${JSON.stringify({ type: action, dashboardId: id, version: dashboard.version, data })}::jsonb,
          ${now}
        )
      `;
      await transaction`
        INSERT INTO audit_events (
          id, tenant_id, actor_id, action, aggregate_id, request_id, data, occurred_at
        ) VALUES (
          ${`audit_${crypto.randomUUID()}`}, ${tenantId}, ${userId}, ${action},
          ${id}, ${requestId}, ${JSON.stringify(data)}::jsonb, ${now}
        )
      `;
      return dashboard;
    });
  } catch (error) {
    if ((error as { errno?: string }).errno === "23505") {
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
