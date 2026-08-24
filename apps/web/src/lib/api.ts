import type {
  AgentEvent,
  AgentJob,
  AgentJobListResponse,
  AgentSessionListResponse,
  AgentSessionTimeline,
  AuthMeResponse,
  CreateDashboardFolderRequest,
  CreateDashboardPreviewResponse,
  CreateDashboardRequest,
  CreateDataSourceRequest,
  CreatePublicationResponse,
  CreateRegisteredQueryRequest,
  CreateShareLinkResponse,
  Dashboard,
  DashboardFolder,
  DashboardFolderListResponse,
  DashboardListResponse,
  DashboardPreview,
  DashboardPreviewListResponse,
  DashboardRevision,
  DashboardRevisionFileListResponse,
  DashboardRevisionListResponse,
  DataSource,
  DataSourceDescription,
  DataSourceListResponse,
  DataSourceTestResult,
  ExecuteQueryRequest,
  Publication,
  PublicationBuild,
  PublicationListResponse,
  QueryResult,
  RegisteredQuery,
  RegisteredQueryListResponse,
  ServiceMetadata,
  ShareLink,
  ShareLinkListResponse,
  UpdateDashboardFolderRequest,
  UpdateDashboardRequest,
  UpdateDataSourceRequest,
} from "@mda/contracts";

interface ApiErrorBody {
  code?: unknown;
  message?: unknown;
  requestId?: unknown;
  retryable?: unknown;
  details?: unknown;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    readonly status: number,
    body: ApiErrorBody,
  ) {
    super(
      typeof body.message === "string"
        ? body.message
        : `服务返回 HTTP ${status}`,
    );
    this.code = typeof body.code === "string" ? body.code : "HTTP_ERROR";
    this.requestId =
      typeof body.requestId === "string" ? body.requestId : undefined;
    this.retryable = body.retryable === true;
    this.details = body.details;
  }
}

function jsonInit(method: string, value: unknown): RequestInit {
  return {
    method,
    body: JSON.stringify(value),
  };
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function parseSseBlock(block: string): AgentEvent | undefined {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  try {
    const event = JSON.parse(data) as Partial<AgentEvent>;
    return typeof event.sequence === "number" &&
      typeof event.timestamp === "string" &&
      typeof event.type === "string" &&
      typeof event.jobId === "string" &&
      event.data !== null &&
      typeof event.data === "object"
      ? (event as AgentEvent)
      : undefined;
  } catch {
    return undefined;
  }
}

export class ApiClient {
  private headers(init?: HeadersInit, hasBody = false): Headers {
    const headers = new Headers(init);
    headers.set("x-mda-web-version", "0.1.0");
    headers.set("x-mda-contract-version", "1");
    headers.set("x-request-id", crypto.randomUUID());
    if (hasBody && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return headers;
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await window.fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: this.headers(init.headers, init.body !== undefined),
    });
    if (response.ok) return response;
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = { message: `服务返回 HTTP ${response.status}` };
    }
    throw new ApiClientError(response.status, body);
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return (await this.fetch(path, init)).json() as Promise<T>;
  }

  metadata(): Promise<ServiceMetadata> {
    return this.request("/api/meta");
  }

  async ready(): Promise<boolean> {
    return (await window.fetch("/health/ready", { credentials: "same-origin" })).ok;
  }

  me(): Promise<AuthMeResponse> {
    return this.request("/api/auth/me");
  }

  register(username: string, password: string): Promise<AuthMeResponse> {
    return this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  }

  login(username: string, password: string): Promise<AuthMeResponse> {
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  }

  async logout(): Promise<void> {
    await this.fetch("/api/auth/logout", { method: "POST" });
  }

  folders(): Promise<DashboardFolder[]> {
    return this.request<DashboardFolderListResponse>(
      "/api/dashboard-folders",
    ).then(({ items }) => items);
  }

  createFolder(input: CreateDashboardFolderRequest): Promise<DashboardFolder> {
    return this.request("/api/dashboard-folders", {
      ...jsonInit("POST", input),
      headers: { "idempotency-key": crypto.randomUUID() },
    });
  }

  updateFolder(
    id: string,
    input: UpdateDashboardFolderRequest,
  ): Promise<DashboardFolder> {
    return this.request(
      `/api/dashboard-folders/${encoded(id)}`,
      jsonInit("PATCH", input),
    );
  }

  async deleteFolder(id: string, expectedVersion: number): Promise<void> {
    await this.fetch(
      `/api/dashboard-folders/${encoded(id)}`,
      jsonInit("DELETE", { expectedVersion }),
    );
  }

  dashboards(limit = 100): Promise<Dashboard[]> {
    return this.request<DashboardListResponse>(
      `/api/dashboards?limit=${limit}`,
    ).then(({ items }) => items);
  }

  dashboard(id: string): Promise<Dashboard> {
    return this.request(`/api/dashboards/${encoded(id)}`);
  }

  createDashboard(input: CreateDashboardRequest): Promise<Dashboard> {
    return this.request("/api/dashboards", {
      ...jsonInit("POST", input),
      headers: { "idempotency-key": crypto.randomUUID() },
    });
  }

  updateDashboard(
    id: string,
    input: UpdateDashboardRequest,
  ): Promise<Dashboard> {
    return this.request(
      `/api/dashboards/${encoded(id)}`,
      jsonInit("PATCH", input),
    );
  }

  archiveDashboard(id: string, expectedVersion: number): Promise<Dashboard> {
    return this.request(
      `/api/dashboards/${encoded(id)}/archive`,
      jsonInit("POST", { expectedVersion }),
    );
  }

  sessions(dashboardId: string): Promise<AgentSessionListResponse> {
    return this.request(
      `/api/dashboards/${encoded(dashboardId)}/sessions?limit=100`,
    );
  }

  timeline(sessionId: string): Promise<AgentSessionTimeline> {
    return this.request(
      `/api/agent-sessions/${encoded(sessionId)}/timeline?limit=100`,
    );
  }

  sendMessage(
    dashboardId: string,
    message: string,
    sessionId?: string,
  ): Promise<AgentJob> {
    return this.request(`/api/dashboards/${encoded(dashboardId)}/messages`, {
      ...jsonInit("POST", {
        message,
        ...(sessionId ? { sessionId } : {}),
      }),
      headers: { "idempotency-key": crypto.randomUUID() },
    });
  }

  jobs(dashboardId?: string): Promise<AgentJob[]> {
    return this.request<AgentJobListResponse>(
      `/api/agent-jobs?limit=100${dashboardId ? `&dashboardId=${encoded(dashboardId)}` : ""}`,
    ).then(({ items }) => items);
  }

  job(id: string): Promise<AgentJob> {
    return this.request(`/api/agent-jobs/${encoded(id)}`);
  }

  cancelJob(id: string): Promise<AgentJob> {
    return this.request(
      `/api/agent-jobs/${encoded(id)}/cancel`,
      jsonInit("POST", {}),
    );
  }

  async readEventStream(
    jobId: string,
    after: number,
    onEvent: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    const response = await this.fetch(
      `/api/agent-jobs/${encoded(jobId)}/events?after=${after}`,
      {
        headers: after ? { "last-event-id": String(after) } : undefined,
        signal,
      },
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("事件流不可用");
    const decoder = new TextDecoder();
    let cursor = after;
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = parseSseBlock(block);
        if (!event || event.sequence <= cursor) continue;
        cursor = event.sequence;
        onEvent(event);
      }
      if (done) return cursor;
    }
  }

  async watchJob(
    initial: AgentJob,
    onEvent: (event: AgentEvent) => void,
    options: { after?: number; signal?: AbortSignal } = {},
  ): Promise<AgentJob> {
    let cursor = options.after ?? 0;
    let consecutiveFailures = 0;
    while (!options.signal?.aborted) {
      try {
        cursor = await this.readEventStream(
          initial.id,
          cursor,
          onEvent,
          options.signal,
        );
        consecutiveFailures = 0;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        consecutiveFailures += 1;
      }
      try {
        const current = await this.job(initial.id);
        if (["succeeded", "failed", "cancelled"].includes(current.state)) {
          return current;
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        consecutiveFailures += 1;
      }
      await sleep(
        Math.min(2_000, 250 * 2 ** consecutiveFailures),
        options.signal,
      );
    }
    throw options.signal?.reason ?? new DOMException("Aborted", "AbortError");
  }

  revisions(dashboardId: string): Promise<DashboardRevision[]> {
    return this.request<DashboardRevisionListResponse>(
      `/api/dashboards/${encoded(dashboardId)}/revisions?limit=100`,
    ).then(({ items }) => items);
  }

  saveRevision(
    dashboardId: string,
    message?: string,
  ): Promise<DashboardRevision> {
    return this.request(`/api/dashboards/${encoded(dashboardId)}/revisions`, {
      ...jsonInit("POST", message?.trim() ? { message: message.trim() } : {}),
      headers: { "idempotency-key": crypto.randomUUID() },
    });
  }

  revisionFiles(
    revisionId: string,
  ): Promise<DashboardRevisionFileListResponse> {
    return this.request(`/api/revisions/${encoded(revisionId)}/files`);
  }

  readRevisionFile(revisionId: string, path: string): Promise<Response> {
    return this.fetch(
      `/api/revisions/${encoded(revisionId)}/files/${encoded(path)}`,
    );
  }

  exportRevision(revisionId: string): Promise<Response> {
    return this.fetch(`/api/revisions/${encoded(revisionId)}/export`);
  }

  previews(dashboardId: string): Promise<DashboardPreview[]> {
    return this.request<DashboardPreviewListResponse>(
      `/api/dashboards/${encoded(dashboardId)}/previews?limit=100`,
    ).then(({ items }) => items);
  }

  preview(id: string): Promise<DashboardPreview> {
    return this.request(`/api/previews/${encoded(id)}`);
  }

  createPreview(
    dashboardId: string,
    revisionId?: string,
  ): Promise<CreateDashboardPreviewResponse> {
    return this.request(`/api/dashboards/${encoded(dashboardId)}/previews`, {
      ...jsonInit("POST", revisionId ? { revisionId } : {}),
      headers: { "idempotency-key": crypto.randomUUID() },
    });
  }

  publications(dashboardId: string): Promise<Publication[]> {
    return this.request<PublicationListResponse>(
      `/api/dashboards/${encoded(dashboardId)}/publications?limit=100`,
    ).then(({ items }) => items);
  }

  publication(id: string): Promise<Publication> {
    return this.request(`/api/publications/${encoded(id)}`);
  }

  createPublication(
    dashboardId: string,
    revisionId: string,
  ): Promise<CreatePublicationResponse> {
    return this.request(
      `/api/dashboards/${encoded(dashboardId)}/publications`,
      {
        ...jsonInit("POST", { revisionId }),
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    );
  }

  publicationBuild(id: string): Promise<PublicationBuild> {
    return this.request(`/api/publication-builds/${encoded(id)}`);
  }

  exportPublication(id: string): Promise<Response> {
    return this.fetch(`/api/publications/${encoded(id)}/export`);
  }

  shares(dashboardId: string): Promise<ShareLink[]> {
    return this.request<ShareLinkListResponse>(
      `/api/dashboards/${encoded(dashboardId)}/share-links?limit=100`,
    ).then(({ items }) => items);
  }

  createShare(
    publicationId: string,
    expiresInSeconds?: number,
  ): Promise<CreateShareLinkResponse> {
    return this.request(
      `/api/publications/${encoded(publicationId)}/share-links`,
      {
        ...jsonInit("POST", expiresInSeconds ? { expiresInSeconds } : {}),
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    );
  }

  revokeShare(id: string): Promise<ShareLink> {
    return this.request(
      `/api/share-links/${encoded(id)}/revoke`,
      jsonInit("POST", {}),
    );
  }

  dataSources(): Promise<DataSource[]> {
    return this.request<DataSourceListResponse>("/api/data-sources").then(
      ({ items }) => items,
    );
  }

  dataSource(id: string): Promise<DataSource> {
    return this.request(`/api/data-sources/${encoded(id)}`);
  }

  describeDataSource(id: string): Promise<DataSourceDescription> {
    return this.request(`/api/data-sources/${encoded(id)}/description`);
  }

  createDataSource(input: CreateDataSourceRequest): Promise<DataSource> {
    return this.request("/api/data-sources", {
      ...jsonInit("POST", input),
      headers: { "idempotency-key": crypto.randomUUID() },
    });
  }

  renameDataSource(
    id: string,
    name: string,
    expectedVersion: number,
  ): Promise<DataSource> {
    return this.request(
      `/api/data-sources/${encoded(id)}/rename`,
      jsonInit("POST", { name, expectedVersion }),
    );
  }

  updateDataSource(
    id: string,
    input: UpdateDataSourceRequest,
  ): Promise<DataSource> {
    return this.request(
      `/api/data-sources/${encoded(id)}/update`,
      jsonInit("POST", input),
    );
  }

  testDataSource(id: string): Promise<DataSourceTestResult> {
    return this.request(
      `/api/data-sources/${encoded(id)}/test`,
      jsonInit("POST", {}),
    );
  }

  sourceAction(
    id: string,
    action: "activate" | "enable" | "disable" | "delete" | "restore",
  ): Promise<DataSource> {
    return this.request(
      `/api/data-sources/${encoded(id)}/${action}`,
      jsonInit("POST", {}),
    );
  }

  refreshSourceSchema(id: string): Promise<DataSourceDescription> {
    return this.request(
      `/api/data-sources/${encoded(id)}/schema-refresh`,
      jsonInit("POST", {}),
    );
  }

  queries(sourceId?: string): Promise<RegisteredQuery[]> {
    return this.request<RegisteredQueryListResponse>(
      `/api/queries${sourceId ? `?sourceId=${encoded(sourceId)}` : ""}`,
    ).then(({ items }) => items);
  }

  query(id: string): Promise<RegisteredQuery> {
    return this.request(`/api/queries/${encoded(id)}`);
  }

  registerQuery(input: CreateRegisteredQueryRequest): Promise<RegisteredQuery> {
    return this.request("/api/queries", {
      ...jsonInit("POST", input),
      headers: { "idempotency-key": crypto.randomUUID() },
    });
  }

  executeQuery(id: string, input: ExecuteQueryRequest): Promise<QueryResult> {
    return this.request(
      `/api/queries/${encoded(id)}/execute`,
      jsonInit("POST", input),
    );
  }
}

export type { AuthMeResponse } from "@mda/contracts";

