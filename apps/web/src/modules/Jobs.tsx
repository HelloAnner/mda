import type { AgentEvent, AgentJob, Dashboard } from "@mda/contracts";
import {
  Ban,
  Braces,
  Clock3,
  History,
  LayoutDashboard,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  JsonView,
  Skeleton,
  StatusPill,
  useToast,
} from "../components/Ui.tsx";
import type { ApiClient } from "../lib/api.ts";
import { toolLabel } from "../lib/events.ts";
import {
  formatDuration,
  jobDuration,
  relativeTime,
  shortId,
} from "../lib/format.ts";

function eventLabel(event: AgentEvent): string {
  if (event.type === "agent.started") return "Agent 开始工作";
  if (event.type === "assistant.delta") return "生成回答内容";
  if (event.type === "assistant.completed") return "回答生成完成";
  if (event.type === "tool.started")
    return `开始 · ${toolLabel(String(event.data.toolName ?? "tool"))}`;
  if (event.type === "tool.completed")
    return `${event.data.isError ? "失败" : "完成"} · ${toolLabel(String(event.data.toolName ?? "tool"))}`;
  if (event.type === "build.started") return "开始构建看板";
  if (event.type === "validation.completed")
    return `构建验证${event.data.status === "passed" ? "通过" : "失败"}`;
  if (event.type === "build.completed") return "看板构建完成";
  if (event.type === "preview.ready") return "预览已就绪";
  if (event.type === "publication.created") return "发布版本已创建";
  if (event.type === "draft.checkpoint.saved") return "草稿 Checkpoint 已保存";
  if (event.type === "agent.failed") return "Agent 执行失败";
  if (event.type === "agent.completed") return "Agent 工作结束";
  return event.type;
}

export function JobsModule({
  api,
  dashboards,
}: {
  api: ApiClient;
  dashboards: Dashboard[];
}) {
  const { notify } = useToast();
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [dashboardFilter, setDashboardFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selected = jobs.find((job) => job.id === selectedId);
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return jobs.filter(
      (job) =>
        (!dashboardFilter || job.dashboardId === dashboardFilter) &&
        (!stateFilter || job.state === stateFilter) &&
        (!needle ||
          `${job.id} ${job.sessionId} ${job.purpose}`
            .toLocaleLowerCase()
            .includes(needle)),
    );
  }, [dashboardFilter, jobs, search, stateFilter]);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const items = await api.jobs();
        setJobs(items);
        setSelectedId((current) =>
          current && items.some((job) => job.id === current)
            ? current
            : items[0]?.id,
        );
      } catch (error) {
        if (!quiet)
          notify(
            error instanceof Error ? error.message : "无法读取任务",
            "error",
          );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [api, notify],
  );

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 2_500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    const controller = new AbortController();
    setEvents([]);
    setEventsLoading(true);
    void api
      .readEventStream(
        selectedId,
        0,
        (event) =>
          setEvents((current) =>
            current.some((item) => item.sequence === event.sequence)
              ? current
              : [...current, event].sort((a, b) => a.sequence - b.sequence),
          ),
        controller.signal,
      )
      .catch((error) => {
        if (!controller.signal.aborted) {
          notify(
            error instanceof Error ? error.message : "事件读取失败",
            "error",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setEventsLoading(false);
      });
    return () => controller.abort();
  }, [api, notify, selectedId]);

  async function cancel() {
    if (!selected) return;
    setSubmitting(true);
    try {
      await api.cancelJob(selected.id);
      setCancelOpen(false);
      await refresh(true);
      notify("已请求取消任务", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "任务取消失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="management-page">
      <header className="management-header">
        <div>
          <span className="module-icon">
            <History size={18} />
          </span>
          <div>
            <h1>任务与事件</h1>
            <p>检查每次对话、预览和发布的持久化执行记录。</p>
          </div>
        </div>
        <Button onClick={() => void refresh()}>
          <RefreshCw size={14} /> 刷新
        </Button>
      </header>
      <div className="jobs-toolbar">
        <label className="management-search">
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索 Job / Session"
          />
        </label>
        <select
          value={dashboardFilter}
          onChange={(event) => setDashboardFilter(event.target.value)}
        >
          <option value="">全部看板</option>
          {dashboards.map((dashboard) => (
            <option value={dashboard.id} key={dashboard.id}>
              {dashboard.name}
            </option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value)}
        >
          <option value="">全部状态</option>
          {[
            "queued",
            "leased",
            "running",
            "succeeded",
            "failed",
            "cancelled",
          ].map((state) => (
            <option value={state} key={state}>
              {state}
            </option>
          ))}
        </select>
        <span>{visible.length} 项</span>
      </div>
      <div className="jobs-layout">
        <section className="jobs-list">
          {loading ? (
            ["one", "two", "three", "four", "five", "six", "seven"].map(
              (item) => (
                <div className="job-row" key={item}>
                  <Skeleton />
                  <Skeleton />
                </div>
              ),
            )
          ) : visible.length === 0 ? (
            <EmptyState
              title="没有匹配的任务"
              description="完成一次对话后，任务记录会显示在这里。"
            />
          ) : (
            visible.map((job) => {
              const dashboard = dashboards.find(
                (item) => item.id === job.dashboardId,
              );
              return (
                <button
                  type="button"
                  className={`job-row${job.id === selectedId ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(job.id)}
                  key={job.id}
                >
                  <span className={`job-purpose purpose-${job.purpose}`}>
                    {job.purpose === "edit" ? (
                      <Braces size={14} />
                    ) : (
                      <LayoutDashboard size={14} />
                    )}
                  </span>
                  <span>
                    <strong>
                      {dashboard?.name ?? shortId(job.dashboardId)}
                    </strong>
                    <small>
                      {job.purpose} · {shortId(job.id)} ·{" "}
                      {relativeTime(job.createdAt)}
                    </small>
                  </span>
                  <StatusPill value={job.state} />
                </button>
              );
            })
          )}
        </section>
        <section className="job-detail">
          {!selected ? (
            <EmptyState title="选择一个任务" />
          ) : (
            <>
              <header className="job-detail-header">
                <div>
                  <span className={`job-purpose purpose-${selected.purpose}`}>
                    {selected.purpose === "edit" ? (
                      <Braces size={16} />
                    ) : (
                      <LayoutDashboard size={16} />
                    )}
                  </span>
                  <div>
                    <h2>{shortId(selected.id)}</h2>
                    <small>{selected.id}</small>
                  </div>
                </div>
                <div>
                  <StatusPill value={selected.state} />
                  {["queued", "leased", "running"].includes(selected.state) && (
                    <Button
                      size="compact"
                      tone="danger"
                      onClick={() => setCancelOpen(true)}
                    >
                      <Ban size={13} /> 取消
                    </Button>
                  )}
                </div>
              </header>
              <div className="job-stat-grid">
                <div>
                  <Clock3 size={14} />
                  <span>
                    <small>耗时</small>
                    <strong>{formatDuration(jobDuration(selected))}</strong>
                  </span>
                </div>
                <div>
                  <Wrench size={14} />
                  <span>
                    <small>工具动作</small>
                    <strong>
                      {
                        events.filter((event) => event.type === "tool.started")
                          .length
                      }
                    </strong>
                  </span>
                </div>
                <div>
                  <RefreshCw size={14} />
                  <span>
                    <small>尝试次数</small>
                    <strong>{selected.attemptCount}</strong>
                  </span>
                </div>
              </div>
              <div className="job-identifiers">
                <div>
                  <small>Session</small>
                  <code>{selected.sessionId}</code>
                </div>
                <div>
                  <small>Dashboard</small>
                  <code>{selected.dashboardId}</code>
                </div>
              </div>
              {selected.terminalError && (
                <div className="form-banner is-error">
                  <strong>{selected.terminalError.code}</strong>
                  <span>{selected.terminalError.message}</span>
                </div>
              )}
              <div className="event-section-head">
                <h3>持久化事件</h3>
                <span>{events.length}</span>
              </div>
              <div className="event-timeline">
                {eventsLoading && events.length === 0 ? (
                  <>
                    <Skeleton />
                    <Skeleton />
                    <Skeleton />
                  </>
                ) : events.length === 0 ? (
                  <EmptyState title="暂无事件" compact />
                ) : (
                  events.map((event) => (
                    <details
                      className={`event-row event-${event.type.includes("failed") || event.data.isError ? "failed" : "normal"}`}
                      key={event.sequence}
                    >
                      <summary>
                        <i />
                        <span>
                          <strong>{eventLabel(event)}</strong>
                          <small>
                            #{event.sequence} ·{" "}
                            {new Date(event.timestamp).toLocaleTimeString(
                              "zh-CN",
                            )}
                          </small>
                        </span>
                        <code>{event.type}</code>
                      </summary>
                      <JsonView value={event.data} />
                    </details>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={cancelOpen}
        title="取消任务"
        description="当前 Agent 运行会收到取消请求；已经保存的成功版本不会被删除。"
        confirmLabel="取消任务"
        danger
        submitting={submitting}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => void cancel()}
      />
    </main>
  );
}
