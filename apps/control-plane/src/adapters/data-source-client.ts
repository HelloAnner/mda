import type {
  DataSourceDescription,
  DataSourceListResponse,
  ExecuteQueryRequest,
  QueryResult,
  RegisteredQuery,
} from "@mda/contracts";
import type { PrincipalContext } from "../shared/auth.ts";
import { HttpError } from "../shared/http.ts";

export class DataSourceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async request(
    path: string,
    principal: Pick<PrincipalContext, "tenantId" | "userId">,
    init: RequestInit = {},
    publicExecution = false,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    headers.set("x-mda-tenant", principal.tenantId);
    headers.set("x-mda-actor", principal.userId);
    headers.set(
      "x-request-id",
      headers.get("x-request-id") ?? crypto.randomUUID(),
    );
    if (publicExecution) headers.set("x-mda-public-execution", "true");
    if (init.body) headers.set("content-type", "application/json");
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers,
    });
    return response;
  }

  private async json<T>(
    path: string,
    principal: Pick<PrincipalContext, "tenantId" | "userId">,
    init: RequestInit = {},
    publicExecution = false,
  ): Promise<T> {
    const response = await this.request(path, principal, init, publicExecution);
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = value as {
        code?: string;
        message?: string;
        retryable?: boolean;
      };
      throw new HttpError(
        response.status,
        error.code ?? "DATA_SOURCE_UNAVAILABLE",
        error.message ?? "Data Source operation failed",
        error.retryable ?? response.status >= 500,
      );
    }
    return value as T;
  }

  list(principal: Pick<PrincipalContext, "tenantId" | "userId">) {
    return this.json<DataSourceListResponse>(
      "/internal/v1/data-sources?limit=100",
      principal,
    );
  }

  describe(
    principal: Pick<PrincipalContext, "tenantId" | "userId">,
    sourceId: string,
  ) {
    return this.json<DataSourceDescription>(
      `/internal/v1/data-sources/${encodeURIComponent(sourceId)}/description`,
      principal,
    );
  }

  query(
    principal: Pick<PrincipalContext, "tenantId" | "userId">,
    queryId: string,
  ) {
    return this.json<RegisteredQuery>(
      `/internal/v1/queries/${encodeURIComponent(queryId)}`,
      principal,
    );
  }

  execute(
    principal: Pick<PrincipalContext, "tenantId" | "userId">,
    queryId: string,
    input: ExecuteQueryRequest,
    publicExecution = false,
  ) {
    return this.json<QueryResult>(
      `/internal/v1/queries/${encodeURIComponent(queryId)}/execute`,
      principal,
      { method: "POST", body: JSON.stringify(input) },
      publicExecution,
    );
  }

  ready(): Promise<Response> {
    return fetch(new URL("/health/ready", this.baseUrl));
  }
}
