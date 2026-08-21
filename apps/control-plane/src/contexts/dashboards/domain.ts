import type { CreateDashboardRequest, Dashboard } from "@mda/contracts";

export interface NewDashboard extends Dashboard {
  tenantId: string;
  createdBy: string;
  normalizedName: string;
}

export function createDashboard(
  input: CreateDashboardRequest,
  tenantId: string,
  createdBy: string,
  now = new Date(),
): NewDashboard {
  const name = input.name.trim().replace(/\s+/gu, " ");
  const description = input.description?.trim() || undefined;
  const timestamp = now.toISOString();

  return {
    id: `dashboard_${crypto.randomUUID()}`,
    tenantId,
    createdBy,
    name,
    normalizedName: name.normalize("NFKC").toLowerCase(),
    ...(description ? { description } : {}),
    status: "active",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
