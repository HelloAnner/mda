import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  type AgentEventType,
  type CreateRegisteredQueryRequest,
  CreateRegisteredQueryRequestSchema,
  type DashboardBuildArtifact,
  type DataSourceDescription,
  type DataSourceListResponse,
  DataValueSchema,
  type ExecuteQueryRequest,
  type QueryResult,
  type RegisteredQuery,
  type RegisteredQueryListResponse,
} from "@mda/contracts";
import { buildDashboard, DashboardBuildError } from "@mda/dashboard-template";
import { Type } from "@sinclair/typebox";
import { captureWorkspace } from "../workspace.ts";

export interface DashboardDataAccess {
  list(): Promise<DataSourceListResponse>;
  describe(sourceId: string): Promise<DataSourceDescription>;
  queries(sourceId?: string): Promise<RegisteredQueryListResponse>;
  register(
    input: CreateRegisteredQueryRequest,
    idempotencyKey: string,
  ): Promise<RegisteredQuery>;
  execute(queryId: string, input: ExecuteQueryRequest): Promise<QueryResult>;
}

interface DashboardToolInput {
  workspace: string;
  onEvent(type: AgentEventType, data: Record<string, unknown>): void;
  onPreviewBuilt(artifact: DashboardBuildArtifact): void;
  dataAccess?: DashboardDataAccess;
}

export const dashboardToolNames = [
  "list_data_sources",
  "describe_data_source",
  "list_queries",
  "register_query",
  "test_query",
  "validate_dashboard",
  "build_preview",
] as const;

function safeBuildError(error: unknown): string {
  if (!(error instanceof DashboardBuildError)) {
    return error instanceof Error ? error.message : String(error);
  }
  return [
    `${error.code}: ${error.message}`,
    error.path ? `Path: ${error.path}` : "",
    error.log ? error.log.slice(-6_000) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function textResult(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  return text.length <= 40_000
    ? text
    : `${text.slice(0, 40_000)}\n[Tool result truncated]`;
}

function dataAccess(input: DashboardToolInput) {
  if (!input.dataAccess) {
    throw new Error("Data Source Service is unavailable");
  }
  return input.dataAccess;
}

export function createDashboardTools(
  input: DashboardToolInput,
): ToolDefinition[] {
  async function build(signal: AbortSignal | undefined) {
    input.onEvent("build.started", { templateVersion: "1" });
    try {
      const snapshot = await captureWorkspace(input.workspace);
      const result = await buildDashboard(snapshot, signal);
      input.onEvent("validation.completed", {
        status: "passed",
        sourceDigest: result.artifact.sourceDigest,
        manifestDigest: result.artifact.manifestDigest,
      });
      input.onEvent("build.completed", {
        status: "succeeded",
        digest: result.artifact.digest,
        fileCount: result.artifact.fileCount,
        totalBytes: result.artifact.totalBytes,
        durationMs: result.durationMs,
      });
      return result;
    } catch (error) {
      input.onEvent("validation.completed", {
        status: "failed",
        message: safeBuildError(error),
      });
      throw new Error(safeBuildError(error));
    }
  }

  return [
    defineTool({
      name: "list_data_sources",
      label: "List Data Sources",
      description:
        "List credential-free Data Sources authorized for this Dashboard. Results describe data capabilities only and never prescribe UI components.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => {
        const value = await dataAccess(input).list();
        return {
          content: [{ type: "text", text: textResult(value) }],
          details: { count: value.items.length },
        };
      },
    }),
    defineTool({
      name: "describe_data_source",
      label: "Describe Data Source",
      description:
        "Read the factual schema and runtime capabilities of one authorized Data Source. It returns no credentials or presentation instructions.",
      parameters: Type.Object(
        { sourceId: Type.String({ minLength: 1, maxLength: 200 }) },
        { additionalProperties: false },
      ),
      execute: async (_id, params) => {
        const value = await dataAccess(input).describe(params.sourceId);
        return {
          content: [{ type: "text", text: textResult(value) }],
          details: { sourceId: params.sourceId },
        };
      },
    }),
    defineTool({
      name: "list_queries",
      label: "List Queries",
      description:
        "List active immutable registered Queries and their revisions, parameters, result columns, and public policy.",
      parameters: Type.Object(
        {
          sourceId: Type.Optional(
            Type.String({ minLength: 1, maxLength: 200 }),
          ),
        },
        { additionalProperties: false },
      ),
      execute: async (_id, params) => {
        const value = await dataAccess(input).queries(params.sourceId);
        return {
          content: [{ type: "text", text: textResult(value) }],
          details: { count: value.items.length },
        };
      },
    }),
    defineTool({
      name: "register_query",
      label: "Register Query",
      description:
        "Validate and register an Agent-authored bounded read-only HTTP Query as an immutable active Query Revision. The source host and credentials remain server-side.",
      parameters: CreateRegisteredQueryRequestSchema,
      execute: async (toolCallId, params) => {
        const value = await dataAccess(input).register(
          params,
          `agent-query:${toolCallId}`,
        );
        return {
          content: [{ type: "text", text: textResult(value) }],
          details: { queryId: value.id, revision: value.revision },
        };
      },
    }),
    defineTool({
      name: "test_query",
      label: "Test Query",
      description:
        "Execute one registered immutable Query Revision with typed sample parameters and return bounded current rows plus freshness metadata.",
      parameters: Type.Object(
        {
          queryId: Type.String({ minLength: 1, maxLength: 200 }),
          revision: Type.Optional(Type.Integer({ minimum: 1 })),
          parameters: Type.Record(Type.String(), DataValueSchema),
        },
        { additionalProperties: false },
      ),
      execute: async (_id, params) => {
        const value = await dataAccess(input).execute(params.queryId, {
          ...(params.revision ? { revision: params.revision } : {}),
          parameters: params.parameters,
        });
        return {
          content: [{ type: "text", text: textResult(value) }],
          details: {
            queryId: params.queryId,
            rowCount: value.meta.rowCount,
            truncated: value.meta.truncated,
          },
        };
      },
    }),
    defineTool({
      name: "validate_dashboard",
      label: "Validate Dashboard",
      description:
        "Validate dashboard.manifest.json and run the fixed, clean Vite build with approved dependencies. This checks build and security boundaries without prescribing components, charts, layouts, or source organization. Output is bounded.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async (_toolCallId, _params, signal) => {
        const result = await build(signal);
        return {
          content: [
            {
              type: "text",
              text: `Dashboard validation passed. Build ${result.artifact.digest} contains ${result.artifact.fileCount} files (${result.artifact.totalBytes} bytes).`,
            },
          ],
          details: {
            status: "passed",
            digest: result.artifact.digest,
            durationMs: result.durationMs,
          },
        };
      },
    }),
    defineTool({
      name: "build_preview",
      label: "Build Preview",
      description:
        "Run the fixed clean Dashboard build and prepare an immutable Preview bundle. The platform stores it only after the Agent Job has staged its matching source Checkpoint. Use this after source changes are complete.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async (_toolCallId, _params, signal) => {
        const result = await build(signal);
        input.onPreviewBuilt(result.artifact);
        return {
          content: [
            {
              type: "text",
              text: `Preview build passed with digest ${result.artifact.digest}. The platform will store the signed Preview after this Job checkpoints the matching source.`,
            },
          ],
          details: {
            status: "passed",
            digest: result.artifact.digest,
            durationMs: result.durationMs,
          },
        };
      },
    }),
  ];
}
