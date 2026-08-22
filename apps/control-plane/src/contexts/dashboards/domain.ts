import type { CreateDashboardRequest, Dashboard } from "@mda/contracts";

export interface NewDashboard extends Dashboard {
  tenantId: string;
  createdBy: string;
  normalizedName: string;
}

export function normalizeDashboardName(value: string): {
  name: string;
  normalizedName: string;
} {
  const name = value.trim().replace(/\s+/gu, " ");
  return { name, normalizedName: name.normalize("NFKC").toLowerCase() };
}

export function createDashboard(
  input: CreateDashboardRequest,
  tenantId: string,
  createdBy: string,
  now = new Date(),
): NewDashboard {
  const { name, normalizedName } = normalizeDashboardName(input.name);
  const description = input.description?.trim() || undefined;
  const timestamp = now.toISOString();

  return {
    id: `dashboard_${crypto.randomUUID()}`,
    tenantId,
    createdBy,
    name,
    normalizedName,
    ...(description ? { description } : {}),
    status: "active",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
