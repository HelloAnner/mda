import type { AgentEvent, AgentJob } from "@mda/contracts";

export interface ToolActivity {
  id: string;
  name: string;
  label: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  sequence: number;
}

export interface ProcessActivity {
  id: string;
  label: string;
  status: "running" | "completed" | "failed";
  sequence: number;
  tools: ToolActivity[];
}

const toolLabels: Record<string, string> = {
  read: "阅读源文件",
  write: "写入看板文件",
  edit: "编辑看板文件",
  bash: "运行验证命令",
  grep: "检索源码内容",
  find: "查找项目文件",
  ls: "浏览工作目录",
  list_data_sources: "读取可用数据源",
  describe_data_source: "读取数据源结构",
  list_queries: "读取已注册查询",
  register_query: "注册只读数据查询",
  test_query: "验证数据查询",
  validate_dashboard: "验证看板边界与构建",
  build_preview: "构建看板预览",
};

export function toolLabel(name: string): string {
  return toolLabels[name] ?? name.replaceAll("_", " ");
}

export function assistantText(events: AgentEvent[]): string {
  const deltas = events
    .filter((event) => event.type === "assistant.delta")
    .map((event) => String(event.data.text ?? ""))
    .join("");
  if (deltas) return deltas;
  const completed = events.findLast(
    (event) => event.type === "assistant.completed",
  );
  return completed ? String(completed.data.text ?? "") : "";
}

function phaseLabel(event: AgentEvent): string | undefined {
  if (event.type === "agent.started") return "正在理解需求并整理实现路径。";
  if (event.type === "build.started") return "正在构建看板并检查运行边界。";
  if (event.type === "validation.completed") {
    return event.data.status === "passed"
      ? "构建验证已经通过，正在整理可查看的结果。"
      : "构建验证发现问题，正在保留可诊断信息。";
  }
  if (event.type === "build.completed") return "看板渲染已经完成。";
  if (event.type === "preview.ready") return "预览已经准备好，可以立即查看。";
  if (event.type === "publication.created") return "不可变发布版本已经生成。";
  if (event.type === "draft.checkpoint.saved")
    return "本轮源码已安全保存到草稿。";
  if (event.type === "agent.progress") {
    if (event.data.phase === "model" && event.data.status === "started") {
      return "正在分析上下文并组织下一步工作。";
    }
    if (event.data.phase === "compaction") {
      return event.data.status === "started"
        ? "正在精简较长的会话上下文。"
        : "会话上下文整理完成。";
    }
  }
  if (event.type === "agent.failed") return "本轮执行未能完成。";
  return undefined;
}

export function processActivities(
  events: AgentEvent[],
  running: boolean,
): ProcessActivity[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const tools = new Map<string, ToolActivity>();
  for (const event of ordered) {
    if (event.type === "tool.started") {
      const id = String(event.data.toolCallId ?? `tool-${event.sequence}`);
      const name = String(event.data.toolName ?? "tool");
      tools.set(id, {
        id,
        name,
        label: toolLabel(name),
        status: "running",
        startedAt: event.timestamp,
        sequence: event.sequence,
      });
    }
    if (event.type === "tool.completed") {
      const id = String(event.data.toolCallId ?? `tool-${event.sequence}`);
      const existing = tools.get(id);
      const name = String(event.data.toolName ?? existing?.name ?? "tool");
      const startedAt = existing?.startedAt ?? event.timestamp;
      tools.set(id, {
        id,
        name,
        label: toolLabel(name),
        status: event.data.isError ? "failed" : "completed",
        startedAt,
        finishedAt: event.timestamp,
        durationMs: Math.max(
          0,
          new Date(event.timestamp).getTime() - new Date(startedAt).getTime(),
        ),
        sequence: existing?.sequence ?? event.sequence,
      });
    }
  }

  const notes = ordered
    .map((event) => ({ event, label: phaseLabel(event) }))
    .filter((item): item is { event: AgentEvent; label: string } =>
      Boolean(item.label),
    );
  if (notes.length === 0 && tools.size > 0) {
    notes.push({
      event: ordered[0] as AgentEvent,
      label: "正在调用工具完成看板工作。",
    });
  }

  return notes.map(({ event, label }, index) => {
    const nextSequence =
      notes[index + 1]?.event.sequence ?? Number.POSITIVE_INFINITY;
    const groupedTools = [...tools.values()].filter(
      (tool) => tool.sequence >= event.sequence && tool.sequence < nextSequence,
    );
    const failed =
      event.type === "agent.failed" ||
      (event.type === "validation.completed" && event.data.status !== "passed");
    const isLast = index === notes.length - 1;
    return {
      id: `${event.jobId}:${event.sequence}`,
      label,
      sequence: event.sequence,
      tools: groupedTools,
      status: failed ? "failed" : running && isLast ? "running" : "completed",
    };
  });
}

export function mergeEvent(
  events: AgentEvent[],
  event: AgentEvent,
): AgentEvent[] {
  const current = events.findIndex((item) => item.sequence === event.sequence);
  if (current >= 0) {
    const next = [...events];
    next[current] = event;
    return next;
  }
  return [...events, event].sort((a, b) => a.sequence - b.sequence);
}

export function isActiveJob(job: AgentJob): boolean {
  return ["queued", "leased", "running"].includes(job.state);
}

export function boardStage(
  event: AgentEvent,
): { stage: string; progress: number } | undefined {
  if (event.type === "build.started")
    return { stage: "正在渲染看板", progress: 38 };
  if (event.type === "validation.completed") {
    return event.data.status === "passed"
      ? { stage: "正在验证交互与边界", progress: 68 }
      : { stage: "渲染需要调整", progress: 68 };
  }
  if (event.type === "build.completed")
    return { stage: "正在封装预览", progress: 86 };
  if (event.type === "preview.ready")
    return { stage: "看板已经就绪", progress: 100 };
  if (event.type === "publication.created")
    return { stage: "发布版本已经就绪", progress: 100 };
  return undefined;
}
