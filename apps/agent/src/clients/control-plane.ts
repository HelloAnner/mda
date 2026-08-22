import type {
  AgentEvent,
  AgentJob,
  AgentLeaseCommand,
  AgentTerminalError,
  CheckpointAgentWorkspaceRequest,
  CheckpointAgentWorkspaceResponse,
  ClaimedAgentJob,
  DashboardBuildArtifact,
  PendingAgentEvent,
  UploadDashboardPreviewResponse,
} from "@mda/contracts";

export class ControlPlaneError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export function createControlPlaneClient(baseUrl: string, token: string) {
  async function request(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const error = result as { code?: string; message?: string };
      throw new ControlPlaneError(
        response.status,
        error.code ?? "CONTROL_PLANE_ERROR",
        error.message ?? `HTTP ${response.status}`,
      );
    }
    return result;
  }

  return {
    claim(jobId: string, owner: string) {
      return request(
        `/internal/v1/agent-jobs/${encodeURIComponent(jobId)}/claim`,
        {
          owner,
        },
      ) as Promise<ClaimedAgentJob>;
    },
    start(jobId: string, command: AgentLeaseCommand) {
      return request(
        `/internal/v1/agent-jobs/${encodeURIComponent(jobId)}/start`,
        command,
      ) as Promise<AgentJob>;
    },
    heartbeat(jobId: string, command: AgentLeaseCommand) {
      return request(
        `/internal/v1/agent-jobs/${encodeURIComponent(jobId)}/heartbeat`,
        command,
      ) as Promise<AgentJob>;
    },
    checkpoint(jobId: string, command: CheckpointAgentWorkspaceRequest) {
      return request(
        `/internal/v1/agent-jobs/${encodeURIComponent(jobId)}/checkpoint`,
        command,
      ) as Promise<CheckpointAgentWorkspaceResponse>;
    },
    preview(
      jobId: string,
      command: AgentLeaseCommand,
      artifact: DashboardBuildArtifact,
    ) {
      return request(
        `/internal/v1/agent-jobs/${encodeURIComponent(jobId)}/preview`,
        { ...command, artifact },
      ) as Promise<UploadDashboardPreviewResponse>;
    },
    appendEvents(
      jobId: string,
      command: AgentLeaseCommand,
      events: PendingAgentEvent[],
    ) {
      return request(
        `/internal/v1/agent-jobs/${encodeURIComponent(jobId)}/events`,
        { ...command, events },
      ) as Promise<AgentEvent[]>;
    },
    settle(
      jobId: string,
      command: AgentLeaseCommand,
      state: "succeeded" | "failed" | "cancelled",
      error?: AgentTerminalError,
    ) {
      return request(
        `/internal/v1/agent-jobs/${encodeURIComponent(jobId)}/settle`,
        { ...command, state, ...(error ? { error } : {}) },
      ) as Promise<AgentJob>;
    },
  };
}

export type ControlPlaneClient = ReturnType<typeof createControlPlaneClient>;
