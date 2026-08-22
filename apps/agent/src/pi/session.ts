import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  createExtensionRuntime,
  loadSkillsFromDir,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentDataSourceContext, AgentEventType } from "@mda/contracts";
import type { AgentConfig } from "../config.ts";

export type PiModelRuntime = {
  modelRuntime: ModelRuntime;
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
};

export const mandatoryDashboardSkills = [
  "dashboard-coding",
  "dashboard-foundations",
  "dashboard-data-communication",
] as const;

export function loadDashboardSkills(skillsRoot: string) {
  const result = loadSkillsFromDir({
    dir: skillsRoot,
    source: "mda-platform",
  });
  if (result.diagnostics.length) {
    throw new Error(
      `Invalid dashboard Skill catalog: ${result.diagnostics
        .map(({ path, message }) => `${path}: ${message}`)
        .join("; ")}`,
    );
  }
  return result;
}

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

const codingTools = [
  "read",
  "bash",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
] as const;

function resourceLoader(
  skillsRoot: string,
  dataSources: AgentDataSourceContext,
): ResourceLoader {
  const skills = loadDashboardSkills(skillsRoot);
  const dataSourceSummary =
    dataSources.status === "not-configured"
      ? "尚未配置数据源服务。请使用明确标注的模拟数据或空状态，绝不能声称数据是实时的。"
      : dataSources.status === "unavailable"
        ? "数据源服务暂时不可用。请保留已有绑定，不要编造数据源或数据。"
        : dataSources.items.length === 0
          ? "数据源服务可用，但当前看板没有已授权的数据源。请使用明确标注的模拟数据或空状态。"
          : dataSources.items
              .map(
                (source) =>
                  `- ${source.name}（${source.id}）：类型 ${source.kind}，状态 ${source.status}，Schema 修订版 ${source.schemaRevision}${source.description ? ` — ${source.description}` : ""}`,
              )
              .join("\n");
  const systemPrompt = `你是 Moss，一名专业的看板生成与编程助手，也是能够持续多轮对话的协作伙伴。

默认使用中文回复；只有用户明确要求其他语言时才切换。自然回应问候、闲聊和一般问题，记住当前 Session 中之前的消息。用户需要创建或修改看板时，先理解目标，再生成清晰、专业、可访问且响应式的实现。仅在任务确有需要时调用工具。所有文件操作必须位于当前 Session 工作区；遵循相关平台 Skill；完成修改后先验证，再如实报告结果。不要虚构工具执行、浏览器预览、发布状态、数据源或实时数据。

你的业务操作边界仅限于生成和修改看板。数据源摘要只是只读上下文，用于决定看板如何展示数据。不得创建、修改、删除、测试、启用、停用或配置数据源，不得索取、读取或输出数据源凭据。

## 数据源摘要
${dataSourceSummary}

## Skill 使用规则
创建、修改、检查或修复任何看板时，必须先用 read 工具读取这三个基础 Skill：${mandatoryDashboardSkills.join("、")}。然后根据用户目标和数据上下文，通常最多再读取一个匹配的呈现场景 Skill 和一个匹配的行业 Skill；没有明确匹配时只使用基础 Skill，绝不能硬套主题。

Skill 只指导受众、信息、审美、数据语义、状态和注意事项。它们绝不构成组件目录、图表注册表、固定网格、JSON UI Schema 或文件模板。你仍应自由创建最适合任务的组件、布局和交互。

## 可用工具
${codingTools.join(", ")}`;
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => skills,
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export function resolveSessionPaths(
  workspaceRoot: string,
  dashboardId: string,
  sessionId: string,
) {
  const validSegment = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
  if (!validSegment.test(dashboardId) || !validSegment.test(sessionId)) {
    throw new Error("Invalid Agent workspace identifier");
  }
  const root = join(
    workspaceRoot,
    "dashboards",
    dashboardId,
    "sessions",
    sessionId,
  );
  return {
    workspace: join(root, "workspace"),
    history: join(root, "history"),
    runtime: join(root, "runtime"),
  };
}

export async function runPiSession(
  config: AgentConfig,
  runtime: PiModelRuntime,
  input: {
    dashboardId: string;
    sessionId: string;
    prompt: string;
    dataSources: AgentDataSourceContext;
    signal: AbortSignal;
    onEvent(type: AgentEventType, data: Record<string, unknown>): void;
  },
): Promise<void> {
  const paths = resolveSessionPaths(
    config.workspaceRoot,
    input.dashboardId,
    input.sessionId,
  );
  await Promise.all([
    mkdir(paths.workspace, { recursive: true }),
    mkdir(paths.history, { recursive: true }),
    mkdir(paths.runtime, { recursive: true }),
  ]);

  // ponytail: the shared Docker volume is single-host durability; move snapshots to S3 before multi-host deployment.
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });
  const { session } = await createAgentSession({
    cwd: paths.workspace,
    agentDir: paths.runtime,
    model: runtime.model,
    modelRuntime: runtime.modelRuntime,
    resourceLoader: resourceLoader(config.skillsRoot, input.dataSources),
    tools: [...codingTools],
    sessionManager: SessionManager.continueRecent(
      paths.workspace,
      paths.history,
    ),
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
