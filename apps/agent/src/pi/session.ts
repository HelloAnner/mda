import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
import type {
  AgentDataSourceContext,
  AgentEventType,
  AgentSessionArtifact,
  DashboardBuildArtifact,
  SourceSnapshot,
} from "@mda/contracts";
import type { AgentConfig } from "../config.ts";
import { restoreWorkspace } from "../workspace.ts";
import {
  createDashboardTools,
  type DashboardDataAccess,
  dashboardToolNames,
} from "./tools.ts";

export type PiModelRuntime = {
  modelRuntime: ModelRuntime;
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
};

export const mandatoryDashboardSkills = [
  "dashboard-coding",
  "measure-dashboard-requirements",
  "data-visualization",
  "frontend-design",
  "vercel-react-best-practices",
  "webapp-testing",
  "web-quality-audit",
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
看板工作使用这组必需 Skill：${mandatoryDashboardSkills.join("、")}。必须按阶段渐进读取，而不是一次性把全部内容塞入上下文。

新建看板或实质重构时严格遵循以下流程：

1. **需求确认**：先读取 dashboard-coding 与 measure-dashboard-requirements，再根据目标通常最多读取一个匹配的呈现场景 Skill 和一个匹配的行业 Skill。结合当前数据源事实，给出精简的受众、决定、问题、指标公式、数据需求、刷新、筛选、权限、状态与验收标准；明确假设和 TBD。然后停止，等待用户批准，批准前不得编辑看板源码。
2. **数据表达**：获得当前 Session 的明确批准后，读取 data-visualization。为每个分析关系选择表现形式并说明原因；保证单位、周期、基线、分母、新鲜度、不确定性和可访问替代清楚。
3. **视觉设计**：读取 frontend-design，先建立与主题相关的色彩、字体、层级、响应式策略和一处克制的标志性细节，再按计划实现，避免通用 AI 模板感。
4. **React 工程**：使用 React 时读取 vercel-react-best-practices，并只按需读取相关规则。当前是固定 React/Vite 浏览器运行时；不得套用 Next.js、服务端、SWR、第三方脚本或未批准依赖示例。
5. **功能测试**：完成实现后读取 webapp-testing，按桌面与移动宽度检查筛选、表格、导航、键盘路径以及加载、空、部分、陈旧、错误和正常状态。只有真实浏览器目标与运行器存在时才声称执行了浏览器测试；构建通过不等于功能测试通过。
6. **质量门**：最后读取 web-quality-audit，修复所有有证据的、源码职责范围内的 Critical 与 High 问题。将平台负责或因缺少 Lighthouse、浏览器、屏幕阅读器、部署地址而无法验证的项目明确分开，绝不能写成已通过。

小范围修改或定点修复可以沿用当前 Session 已批准的需求，无需重新停顿，但仍须读取受影响阶段的 Skill 并重新验证。没有明确匹配时不加载可选场景或行业 Skill，绝不能硬套主题。

任何 Skill 示例都不能覆盖本提示中的工作区、依赖、数据和 Tool 边界。Skill 绝不构成组件目录、图表注册表、固定网格、JSON UI Schema 或文件模板；你仍应自由创建最适合任务的组件、布局和交互。绝不编造生产数据；使用样例或 fixture 时，必须在界面和完成说明中清楚标注“样例数据”，不得暗示它是实时、当前或生产数据。

## 构建边界
看板源码只包含 dashboard.manifest.json、src/** 与 public/**。Manifest 必须声明任意位于 src/ 下的 sourceEntry、固定输出 entry: "dist/index.html"、runtimeVersion: "1" 与 queries。每个 Query 声明必须包含真实注册 Query 的 id、revision 和参数类型；页面通过 @mda/dashboard-runtime 的 dashboard.query() 或 dashboard.watch() 获取数据，绝不直接访问源地址。不得创建或修改 package.json、锁文件、Vite 配置、node_modules 或 dist。完成看板源码后必须使用 validate_dashboard 或 build_preview；只有 Tool 成功后才能声称构建、验证或 Preview 成功。

## 可用工具
${[...codingTools, ...dashboardToolNames].join(", ")}`;
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
    dataAccess?: DashboardDataAccess;
    historyArtifact?: AgentSessionArtifact;
    workspaceSnapshot?: SourceSnapshot;
    signal: AbortSignal;
    onEvent(type: AgentEventType, data: Record<string, unknown>): void;
  },
): Promise<{
  previewArtifact?: DashboardBuildArtifact;
  historyArtifact?: AgentSessionArtifact;
}> {
  const paths = resolveSessionPaths(
    config.workspaceRoot,
    input.dashboardId,
    input.sessionId,
  );
  await rm(paths.history, { recursive: true, force: true });
  await Promise.all([
    mkdir(paths.history, { recursive: true }),
    mkdir(paths.runtime, { recursive: true }),
  ]);
  if (input.historyArtifact) {
    const bytes = Buffer.from(input.historyArtifact.content, "base64");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (
      bytes.length !== input.historyArtifact.bytes ||
      digest !== input.historyArtifact.digest
    ) {
      throw new Error("Restored Agent Session history is inconsistent");
    }
    await writeFile(
      join(paths.history, `restored-${input.historyArtifact.digest}.jsonl`),
      bytes,
      { mode: 0o600 },
    );
  }
  await restoreWorkspace(paths.workspace, input.workspaceSnapshot);

  const settingsManager = SettingsManager.inMemory({
    compaction: {
      enabled: true,
      reserveTokens: 32_768,
      keepRecentTokens: 16_000,
    },
    retry: { enabled: true, maxRetries: 2 },
  });
  let previewArtifact: DashboardBuildArtifact | undefined;
  const dashboardTools = createDashboardTools({
    workspace: paths.workspace,
    onEvent: input.onEvent,
    onPreviewBuilt: (artifact) => {
      previewArtifact = artifact;
    },
    ...(input.dataAccess ? { dataAccess: input.dataAccess } : {}),
  });
  const { session } = await createAgentSession({
    cwd: paths.workspace,
    agentDir: paths.runtime,
    model: runtime.model,
    modelRuntime: runtime.modelRuntime,
    resourceLoader: resourceLoader(config.skillsRoot, input.dataSources),
    tools: [...codingTools, ...dashboardToolNames],
    customTools: dashboardTools,
    sessionManager: SessionManager.continueRecent(
      paths.workspace,
      paths.history,
    ),
    settingsManager,
    thinkingLevel: "off",
  });

  let assistantError: string | undefined;
  const toolInputProgress = new Map<
    number,
    { toolName: string; bytes: number; reportedBytes: number }
  >();
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "agent_start") {
      input.onEvent("agent.started", {});
    } else if (event.type === "turn_start") {
      input.onEvent("agent.progress", {
        phase: "model",
        status: "started",
      });
    } else if (event.type === "compaction_start") {
      input.onEvent("agent.progress", {
        phase: "compaction",
        status: "started",
        reason: event.reason,
      });
    } else if (event.type === "compaction_end") {
      input.onEvent("agent.progress", {
        phase: "compaction",
        status: event.aborted || event.errorMessage ? "failed" : "completed",
        reason: event.reason,
        ...(event.result
          ? {
              tokensBefore: event.result.tokensBefore,
              estimatedTokensAfter: event.result.estimatedTokensAfter,
            }
          : {}),
      });
    } else if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        input.onEvent("assistant.delta", { text: update.delta });
      } else if (update.type === "toolcall_start") {
        const block = update.partial.content[update.contentIndex];
        const toolName = block?.type === "toolCall" ? block.name : "tool";
        toolInputProgress.set(update.contentIndex, {
          toolName,
          bytes: 0,
          reportedBytes: 0,
        });
        input.onEvent("agent.progress", {
          phase: "tool-input",
          status: "started",
          toolName,
          bytes: 0,
        });
      } else if (update.type === "toolcall_delta") {
        const progress = toolInputProgress.get(update.contentIndex);
        if (progress) {
          const block = update.partial.content[update.contentIndex];
          if (block?.type === "toolCall" && block.name) {
            progress.toolName = block.name;
          }
          progress.bytes += Buffer.byteLength(update.delta);
          if (progress.bytes - progress.reportedBytes >= 16 * 1024) {
            progress.reportedBytes = progress.bytes;
            input.onEvent("agent.progress", {
              phase: "tool-input",
              status: "streaming",
              toolName: progress.toolName,
              bytes: progress.bytes,
            });
          }
        }
      } else if (update.type === "toolcall_end") {
        const progress = toolInputProgress.get(update.contentIndex);
        input.onEvent("agent.progress", {
          phase: "tool-input",
          status: "completed",
          toolName: update.toolCall.name,
          bytes: progress?.bytes ?? 0,
        });
        toolInputProgress.delete(update.contentIndex);
      }
    } else if (
      event.type === "message_end" &&
      event.message.role === "assistant"
    ) {
      const text = event.message.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("");
      toolInputProgress.clear();
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

  let sessionFile: string | undefined;
  try {
    await session.prompt(input.prompt);
    if (assistantError) throw new Error(assistantError);
    sessionFile = session.sessionFile;
  } finally {
    input.signal.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
  if (!sessionFile) throw new Error("Pi Session history was not persisted");
  const historyBytes = new Uint8Array(await readFile(sessionFile));
  if (historyBytes.length > 20 * 1024 * 1024) {
    throw new Error("Pi Session history is larger than 20 MiB");
  }
  const historyDigest = createHash("sha256").update(historyBytes).digest("hex");
  const historyArtifact: AgentSessionArtifact = {
    digest: historyDigest,
    bytes: historyBytes.length,
    content: Buffer.from(historyBytes).toString("base64"),
  };
  return {
    ...(previewArtifact ? { previewArtifact } : {}),
    historyArtifact,
  };
}
