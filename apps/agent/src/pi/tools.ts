import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentEventType, DashboardBuildArtifact } from "@mda/contracts";
import { buildDashboard, DashboardBuildError } from "@mda/dashboard-template";
import { Type } from "@sinclair/typebox";
import { captureWorkspace } from "../workspace.ts";

interface DashboardToolInput {
  workspace: string;
  onEvent(type: AgentEventType, data: Record<string, unknown>): void;
  onPreviewBuilt(artifact: DashboardBuildArtifact): void;
}

export const dashboardToolNames = [
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
