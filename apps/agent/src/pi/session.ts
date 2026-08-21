import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentEventType } from "@mda/contracts";
import type { AgentConfig } from "../config.ts";

export type PiModelRuntime = {
  modelRuntime: ModelRuntime;
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
};

export async function createPiModelRuntime(
  config: AgentConfig,
): Promise<PiModelRuntime> {
  const runtimeDir = join(config.workspaceRoot, ".runtime");
  await mkdir(runtimeDir, { recursive: true });
  const modelsPath = join(runtimeDir, "models.json");
  await writeFile(
    modelsPath,
    JSON.stringify({
      providers: {
        [config.model.provider]: {
          name: "MDA LLM",
          baseUrl: config.model.baseUrl,
          api: "openai-completions",
          models: [
            {
              id: config.model.model,
              name: config.model.model,
              reasoning: false,
              input: ["text"],
              contextWindow: 128_000,
              maxTokens: 16_384,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              compat: {
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
                supportsUsageInStreaming: false,
                maxTokensField: "max_tokens",
              },
            },
          ],
        },
      },
    }),
    { mode: 0o600 },
  );
  const modelRuntime = await ModelRuntime.create({
    modelsPath,
    authPath: join(runtimeDir, "auth.json"),
  });
  await modelRuntime.setRuntimeApiKey(
    config.model.provider,
    config.model.apiKey,
  );
  const model = modelRuntime.getModel(
    config.model.provider,
    config.model.model,
  );
  if (!model) {
    throw new Error(
      `Configured model not found: ${config.model.provider}/${config.model.model}`,
    );
  }
  return { modelRuntime, model };
}

function resourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      "You are MDA's coding agent. Work only inside the current dashboard workspace. Use the available file tools to create and edit dashboard source. Be concise when replying to the user.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export async function runPiSession(
  config: AgentConfig,
  runtime: PiModelRuntime,
  input: {
    dashboardId: string;
    sessionId: string;
    prompt: string;
    signal: AbortSignal;
    onEvent(type: AgentEventType, data: Record<string, unknown>): void;
  },
): Promise<void> {
  const cwd = join(config.workspaceRoot, "dashboards", input.dashboardId);
  const sessionDir = join(config.workspaceRoot, "sessions", input.sessionId);
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
  ]);

  // ponytail: local session/workspace persistence supports one deployed worker; move snapshots to S3 before adding replicas.
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });
  const { session } = await createAgentSession({
    cwd,
    agentDir: join(config.workspaceRoot, ".runtime"),
    model: runtime.model,
    modelRuntime: runtime.modelRuntime,
    resourceLoader: resourceLoader(),
    tools: ["read", "write", "edit", "grep", "find", "ls"],
    sessionManager: SessionManager.continueRecent(cwd, sessionDir),
    settingsManager,
    thinkingLevel: "off",
  });

  let assistantError: string | undefined;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "agent_start") {
      input.onEvent("agent.started", {});
    } else if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      input.onEvent("assistant.delta", {
        text: event.assistantMessageEvent.delta,
      });
    } else if (
      event.type === "message_end" &&
      event.message.role === "assistant"
    ) {
      const text = event.message.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("");
      input.onEvent("assistant.completed", {
        text,
        stopReason: event.message.stopReason,
        usage: event.message.usage,
      });
      if (event.message.stopReason === "error") {
        assistantError = event.message.errorMessage ?? "Model request failed";
      }
    } else if (event.type === "tool_execution_start") {
      input.onEvent("tool.started", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
    } else if (event.type === "tool_execution_end") {
      input.onEvent("tool.completed", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
      });
    }
  });
  const abort = () => void session.abort();
  input.signal.addEventListener("abort", abort, { once: true });

  try {
    await session.prompt(input.prompt);
    if (assistantError) throw new Error(assistantError);
  } finally {
    input.signal.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
}
