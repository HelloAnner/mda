import type {
  CreateDashboardFolderRequest,
  DashboardFolder,
  DeleteDashboardFolderRequest,
  UpdateDashboardFolderRequest,
} from "@mda/contracts";
import type { SQL } from "bun";
import { HttpError } from "../../shared/http.ts";
import { claimIdempotency, requestDigest } from "../../shared/idempotency.ts";
import { normalizeDashboardName } from "../dashboards/domain.ts";

type Row = Record<string, unknown>;

function toFolder(row: Row): DashboardFolder {
  return {
    id: String(row.id),
    name: String(row.name),
    ...(row.parent_id ? { parentId: String(row.parent_id) } : {}),
    version: Number(row.version),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

async function assertParent(
  transaction: SQL,
  tenantId: string,
  parentId: string | undefined,
): Promise<void> {
  if (!parentId) return;
  const rows = await transaction`
    SELECT 1 FROM dashboard_folders
    WHERE tenant_id = ${tenantId} AND id = ${parentId}
  `;
  if (rows.length === 0) {
    throw new HttpError(
      404,
      "DASHBOARD_FOLDER_NOT_FOUND",
      "Parent Dashboard Folder not found",
    );
  }
}

function folderConflict(error: unknown): never {
  if (
    !(error instanceof HttpError) &&
    ((error as { code?: string }).code === "23505" ||
      (error as { errno?: string }).errno === "23505")
  ) {
    throw new HttpError(
      409,
      "DASHBOARD_FOLDER_NAME_CONFLICT",
      "A folder with this name already exists here",
    );
  }
  throw error;
}

export async function listDashboardFolders(
  db: SQL,
  tenantId: string,
): Promise<DashboardFolder[]> {
  const rows = await db`
    SELECT id, parent_id, name, version, created_at, updated_at
    FROM dashboard_folders
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at, id
    LIMIT 500
  `;
  return [...rows].map((row) => toFolder(row as Row));
}

export async function createDashboardFolder(
  db: SQL,
  input: CreateDashboardFolderRequest,
  principal: { tenantId: string; userId: string },
  idempotencyKey: string,
  requestId: string,
): Promise<{ folder: DashboardFolder; created: boolean }> {
  const id = `folder_${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();
  const name = normalizeDashboardName(input.name);
  try {
    return await db.begin(async (transaction) => {
      await assertParent(transaction, principal.tenantId, input.parentId);
      const existingId = await claimIdempotency(transaction, {
        tenantId: principal.tenantId,
        operation: "dashboard-folder.create",
        key: idempotencyKey,
        requestDigest: requestDigest(input),
        resultId: id,
      });
      if (existingId) {
        const existing = await transaction`
          SELECT id, parent_id, name, version, created_at, updated_at
          FROM dashboard_folders
          WHERE tenant_id = ${principal.tenantId} AND id = ${existingId}
        `;
        if (!existing[0]) throw new Error("Idempotency result is missing");
        return { folder: toFolder(existing[0] as Row), created: false };
      }

      const rows = await transaction`
        INSERT INTO dashboard_folders (
          id, tenant_id, parent_id, name, normalized_name, version,
          created_by, created_at, updated_at
        ) VALUES (
          ${id}, ${principal.tenantId}, ${input.parentId ?? null}, ${name.name},
          ${name.normalizedName}, 1, ${principal.userId}, ${timestamp},
          ${timestamp}
        )
        RETURNING id, parent_id, name, version, created_at, updated_at
      `;
      const folder = toFolder(rows[0] as Row);
      const data = { name: folder.name, parentId: folder.parentId ?? null };
      await transaction`
        INSERT INTO control_outbox (
          id, tenant_id, event_type, aggregate_id, payload, occurred_at
        ) VALUES (
          ${`event_${crypto.randomUUID()}`}, ${principal.tenantId},
          'dashboard-folder.created', ${folder.id},
          ${JSON.stringify({ type: "dashboard-folder.created", folderId: folder.id, data })}::jsonb,
          ${timestamp}
        )
      `;
      await transaction`
        INSERT INTO audit_events (
          id, tenant_id, actor_id, action, aggregate_id,
          request_id, data, occurred_at
        ) VALUES (
          ${`audit_${crypto.randomUUID()}`}, ${principal.tenantId},
          ${principal.userId}, 'dashboard-folder.created', ${folder.id},
          ${requestId}, ${JSON.stringify(data)}::jsonb, ${timestamp}
        )
      `;
      return { folder, created: true };
    });
  } catch (error) {
    folderConflict(error);
  }
}

export async function updateDashboardFolder(
  db: SQL,
  tenantId: string,
  userId: string,
  requestId: string,
  id: string,
  input: UpdateDashboardFolderRequest,
): Promise<DashboardFolder> {
  try {
    return await db.begin(async (transaction) => {
      const rows = await transaction`
        SELECT id, parent_id, name, normalized_name, version,
          created_at, updated_at
        FROM dashboard_folders
        WHERE tenant_id = ${tenantId} AND id = ${id}
        FOR UPDATE
      `;
      const current = rows[0] as Row | undefined;
      if (!current) {
        throw new HttpError(
          404,
          "DASHBOARD_FOLDER_NOT_FOUND",
          "Dashboard Folder not found",
        );
      }
      if (Number(current.version) !== input.expectedVersion) {
        throw new HttpError(
          409,
          "VERSION_CONFLICT",
          "Dashboard Folder changed",
        );
      }

      const parentId =
        input.parentId === undefined
          ? current.parent_id
            ? String(current.parent_id)
            : undefined
          : (input.parentId ?? undefined);
      await assertParent(transaction, tenantId, parentId);
      if (parentId) {
        const descendants = await transaction`
          WITH RECURSIVE folder_tree AS (
            SELECT id FROM dashboard_folders
            WHERE tenant_id = ${tenantId} AND id = ${id}
            UNION ALL
            SELECT child.id
            FROM dashboard_folders child
            JOIN folder_tree parent ON child.parent_id = parent.id
            WHERE child.tenant_id = ${tenantId}
          )
          SELECT 1 FROM folder_tree WHERE id = ${parentId} LIMIT 1
        `;
        if (descendants.length > 0) {
          throw new HttpError(
            409,
            "DASHBOARD_FOLDER_CYCLE",
            "A folder cannot be moved inside itself",
          );
        }
      }

      const name = input.name
        ? normalizeDashboardName(input.name)
        : {
            name: String(current.name),
            normalizedName: String(current.normalized_name),
          };
      const timestamp = new Date().toISOString();
      const updated = await transaction`
        UPDATE dashboard_folders
        SET parent_id = ${parentId ?? null}, name = ${name.name},
          normalized_name = ${name.normalizedName}, version = version + 1,
          updated_at = ${timestamp}
        WHERE tenant_id = ${tenantId} AND id = ${id}
          AND version = ${input.expectedVersion}
        RETURNING id, parent_id, name, version, created_at, updated_at
      `;
      if (!updated[0]) {
        throw new HttpError(
          409,
          "VERSION_CONFLICT",
          "Dashboard Folder changed",
        );
      }
      const folder = toFolder(updated[0] as Row);
      const data = { name: folder.name, parentId: folder.parentId ?? null };
      await transaction`
        INSERT INTO control_outbox (
          id, tenant_id, event_type, aggregate_id, payload, occurred_at
        ) VALUES (
          ${`event_${crypto.randomUUID()}`}, ${tenantId},
          'dashboard-folder.updated', ${id},
          ${JSON.stringify({ type: "dashboard-folder.updated", folderId: id, data })}::jsonb,
          ${timestamp}
        )
      `;
      await transaction`
        INSERT INTO audit_events (
          id, tenant_id, actor_id, action, aggregate_id,
          request_id, data, occurred_at
        ) VALUES (
          ${`audit_${crypto.randomUUID()}`}, ${tenantId}, ${userId},
          'dashboard-folder.updated', ${id}, ${requestId},
          ${JSON.stringify(data)}::jsonb, ${timestamp}
        )
      `;
      return folder;
    });
  } catch (error) {
    folderConflict(error);
  }
}

export async function deleteDashboardFolder(
  db: SQL,
  tenantId: string,
  userId: string,
  requestId: string,
  id: string,
  input: DeleteDashboardFolderRequest,
): Promise<void> {
  await db.begin(async (transaction) => {
    const rows = await transaction`
      SELECT id, name, version FROM dashboard_folders
      WHERE tenant_id = ${tenantId} AND id = ${id}
      FOR UPDATE
    `;
    const folder = rows[0] as Row | undefined;
    if (!folder) {
      throw new HttpError(
        404,
        "DASHBOARD_FOLDER_NOT_FOUND",
        "Dashboard Folder not found",
      );
    }
    if (Number(folder.version) !== input.expectedVersion) {
      throw new HttpError(409, "VERSION_CONFLICT", "Dashboard Folder changed");
    }
    const contents = await transaction`
      SELECT
        EXISTS(
          SELECT 1 FROM dashboard_folders
          WHERE tenant_id = ${tenantId} AND parent_id = ${id}
        ) AS has_folders,
        EXISTS(
          SELECT 1 FROM dashboards
          WHERE tenant_id = ${tenantId} AND folder_id = ${id}
        ) AS has_dashboards
    `;
    const content = contents[0] as Row;
    if (content.has_folders || content.has_dashboards) {
      throw new HttpError(
        409,
        "DASHBOARD_FOLDER_NOT_EMPTY",
        "Move this folder's contents before deleting it",
      );
    }
    await transaction`
      DELETE FROM dashboard_folders
      WHERE tenant_id = ${tenantId} AND id = ${id}
        AND version = ${input.expectedVersion}
    `;
    const timestamp = new Date().toISOString();
    const data = { name: String(folder.name) };
    await transaction`
      INSERT INTO control_outbox (
        id, tenant_id, event_type, aggregate_id, payload, occurred_at
      ) VALUES (
        ${`event_${crypto.randomUUID()}`}, ${tenantId},
        'dashboard-folder.deleted', ${id},
        ${JSON.stringify({ type: "dashboard-folder.deleted", folderId: id, data })}::jsonb,
        ${timestamp}
      )
    `;
    await transaction`
      INSERT INTO audit_events (
        id, tenant_id, actor_id, action, aggregate_id,
        request_id, data, occurred_at
      ) VALUES (
        ${`audit_${crypto.randomUUID()}`}, ${tenantId}, ${userId},
        'dashboard-folder.deleted', ${id}, ${requestId},
        ${JSON.stringify(data)}::jsonb, ${timestamp}
      )
    `;
  });
}
