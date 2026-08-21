import { type ApiError, ApiErrorSchema } from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";

export interface ApiClientConfig {
  apiUrl: string;
  tenant?: string;
  token?: string;
  accessPassword?: string;
  version: string;
}

export class ApiClientError extends Error {
  constructor(
    readonly error: ApiError,
    readonly status: number,
  ) {
    super(`${error.code}: ${error.message}`);
  }
}

export async function apiRequest(
  config: ApiClientConfig,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("x-mda-cli-version", config.version);
  headers.set("x-mda-contract-version", "1");
  if (config.tenant) headers.set("x-mda-tenant", config.tenant);
  if (config.token) headers.set("authorization", `Bearer ${config.token}`);
  if (config.accessPassword) {
    headers.set("x-mda-access-password", config.accessPassword);
  }
  if (init.body) headers.set("content-type", "application/json");

  const response = await fetch(new URL(path, config.apiUrl), {
    ...init,
    headers,
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    if (Value.Check(ApiErrorSchema, body)) {
      throw new ApiClientError(body, response.status);
    }
    throw new Error(`Control Plane returned HTTP ${response.status}`);
  }
  return body;
}
