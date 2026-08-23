import type {
  AgentEvent,
  AgentJob,
  AgentSessionTimeline,
  Dashboard,
} from "@mda/contracts";
import {
  Archive,
  ArrowUp,
  Copy,
  Files,
  LayoutDashboard,
  Save,
  Share2,
  Square,
} from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ApiClient } from "../lib/api.ts";
import {
  assistantText,
  boardStage,
  isActiveJob,
  mergeEvent,
} from "../lib/events.ts";
import { relativeTime } from "../lib/format.ts";
import { Markdown } from "./Markdown.tsx";
import { ReasoningTrace } from "./ReasoningTrace.tsx";
import { IconButton, useToast } from "./Ui.tsx";

interface Turn {
  job: AgentJob;
  message: string;
  events: AgentEvent[];
}

export interface BoardProgressUpdate {
  job: AgentJob;
  event?: AgentEvent;
  stage: string;
  progress: number;
  state: "running" | "ready" | "failed";
  previewId?: string;
}

interface ChatWorkspaceProps {
  api: ApiClient;
  dashboard: Dashboard;
  sessionId?: string;
  boardOpen: boolean;
  revisionOpen: boolean;
  onSessionChange(id?: string): void;
  onSessionsRefresh(): Promise<void> | void;
  onEdit(): void;
  onSave(): void;
  onShare(): void;
  onToggleBoard(): void;
  onToggleRevisions(): void;
  onBoardProgress(update: BoardProgressUpdate): void;
}

const suggestions = [
  "创建一块面向管理层的销售经营看板，先和我确认指标口径",
  "基于已有数据源设计一块能发现异常的运营看板",
  "检查当前看板的移动布局、空状态和可访问性",
  "为当前看板增加筛选、趋势对比与明细行动区",
];

export function ChatWorkspace({
  api,
  dashboard,
  sessionId,
  boardOpen,
  revisionOpen,
  onSessionChange,
  onSessionsRefresh,
  onEdit,
  onSave,
  onShare,
  onToggleBoard,
  onToggleRevisions,
  onBoardProgress,
}: ChatWorkspaceProps) {
  const { notify } = useToast();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const watcherRef = useRef<AbortController | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const activeTurn = turns.findLast((turn) => isActiveJob(turn.job));
  const scrollVersion = turns
    .map(
      (turn) =>
        `${turn.job.id}:${turn.job.version}:${turn.events.at(-1)?.sequence ?? 0}`,
    )
    .join("|");

  const updateTurn = useCallback(
    (jobId: string, update: (turn: Turn) => Turn) => {
      setTurns((current) =>
        current.map((turn) => (turn.job.id === jobId ? update(turn) : turn)),
      );
    },
    [],
  );

  const followJob = useCallback(
    async (initial: AgentJob, after = 0) => {
      watcherRef.current?.abort();
      const controller = new AbortController();
      watcherRef.current = controller;
      try {
        const final = await api.watchJob(
          initial,
          (event) => {
            updateTurn(initial.id, (turn) => ({
              ...turn,
              events: mergeEvent(turn.events, event),
            }));
            const stage = boardStage(event);
            if (stage) {
              onBoardProgress({
                job: initial,
                event,
                ...stage,
                state:
                  event.type === "preview.ready" ||
                  event.type === "publication.created"
                    ? "ready"
                    : event.type === "validation.completed" &&
                        event.data.status !== "passed"
                      ? "failed"
                      : "running",
                ...(event.type === "preview.ready" && event.data.previewId
                  ? { previewId: String(event.data.previewId) }
                  : {}),
              });
            }
          },
          { after, signal: controller.signal },
        );
        updateTurn(initial.id, (turn) => ({ ...turn, job: final }));
        if (final.state === "failed") {
          onBoardProgress({
            job: final,
            stage: "本轮看板工作未完成",
            progress: 100,
            state: "failed",
          });
        }
        await onSessionsRefresh();
      } catch (error) {
        if (!controller.signal.aborted) {
          notify(
            error instanceof Error ? error.message : "事件连接暂时中断",
            "error",
          );
        }
      } finally {
        if (watcherRef.current === controller) watcherRef.current = undefined;
        setSending(false);
      }
    },
    [api, notify, onBoardProgress, onSessionsRefresh, updateTurn],
  );

  useEffect(() => {
    watcherRef.current?.abort();
    setTurns([]);
    setTruncated(false);
    if (!sessionId) {
      setLoading(false);
      return;
    }
    let disposed = false;
    setLoading(true);
    void api
      .timeline(sessionId)
      .then((timeline: AgentSessionTimeline) => {
        if (disposed) return;
        setTurns(timeline.turns);
        setTruncated(timeline.truncated);
        const active = timeline.turns.findLast((turn) => isActiveJob(turn.job));
        if (active) {
          setSending(true);
          void followJob(active.job, active.events.at(-1)?.sequence ?? 0);
        }
      })
      .catch((error) => {
        if (!disposed) {
          notify(
            error instanceof Error ? error.message : "无法读取会话",
            "error",
          );
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      watcherRef.current?.abort();
    };
  }, [api, followJob, notify, sessionId]);

  useEffect(() => {
    if (!scrollVersion || !shouldFollowRef.current) return;
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollVersion]);

  async function send(value = message) {
    const text = value.trim();
    if (!text || sending || dashboard.status !== "active") return;
    setSending(true);
    setMessage("");
    try {
      const job = await api.sendMessage(dashboard.id, text, sessionId);
      if (!sessionId) onSessionChange(job.sessionId);
      setTurns((current) => [...current, { job, message: text, events: [] }]);
      await onSessionsRefresh();
      void followJob(job);
    } catch (error) {
      setMessage(text);
      setSending(false);
      notify(error instanceof Error ? error.message : "消息发送失败", "error");
    }
  }

  async function cancel() {
    if (!activeTurn) return;
    try {
      const job = await api.cancelJob(activeTurn.job.id);
      updateTurn(job.id, (turn) => ({ ...turn, job }));
      notify("已请求停止当前任务");
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法停止任务", "error");
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const conversationTitle =
    turns[0]?.message.trim().replace(/\s+/gu, " ").slice(0, 80) ||
    dashboard.name;

  return (
    <main className="chat-panel">
      <header className="chat-header">
        <div className="chat-title">
          <button type="button" onClick={onEdit} title="编辑看板信息">
            <span>{conversationTitle}</span>
          </button>
          {dashboard.status === "archived" && (
            <span className="archived-badge">已归档</span>
          )}
        </div>
        <div className="header-actions">
          <IconButton
            label="保存看板"
            onClick={onSave}
            disabled={dashboard.status !== "active"}
          >
            <Save size={15} />
          </IconButton>
          <IconButton
            label="发布与分享"
            onClick={onShare}
            disabled={dashboard.status !== "active"}
          >
            <Share2 size={15} />
          </IconButton>
          <i />
          <IconButton
            label="智能看板"
            active={boardOpen}
            onClick={onToggleBoard}
          >
            <LayoutDashboard size={16} />
          </IconButton>
          <IconButton
            label="版本文件"
            active={revisionOpen}
            onClick={onToggleRevisions}
          >
            <Files size={16} />
          </IconButton>
        </div>
      </header>

      <div
        className="message-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          shouldFollowRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            48;
        }}
      >
        {loading ? (
          <div className="conversation-loading">
            <span />
            <span />
            <span />
          </div>
        ) : turns.length === 0 ? (
          <section className="conversation-home">
            <div className="home-dots" aria-hidden="true" />
            <div className="home-content">
              <span className="home-mark">M</span>
              <h1>今天想构建什么看板？</h1>
              <p>先说清楚受众、要做的决定和可用数据，MDA 会与你逐步完成。</p>
              <div className="recommendation-card">
                <span>从这里开始</span>
                {suggestions.map((suggestion) => (
                  <button
                    type="button"
                    onClick={() => void send(suggestion)}
                    key={suggestion}
                  >
                    <span>{suggestion}</span>
                    <ArrowUp size={14} />
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <div className="messages">
            {truncated && (
              <div className="form-banner">仅显示最近 100 个回合。</div>
            )}
            {turns.map((turn) => {
              const content = assistantText(turn.events);
              const running = isActiveJob(turn.job);
              return (
                <div className="conversation-turn" key={turn.job.id}>
                  <article className="user-message">
                    <div className="user-bubble">{turn.message}</div>
                  </article>
                  <article className="assistant-message">
                    <header className="assistant-head">
                      <span className="agent-mark">M</span>
                      <strong>MDA</strong>
                      <time>{relativeTime(turn.job.createdAt)}</time>
                    </header>
                    <ReasoningTrace job={turn.job} events={turn.events} />
                    {content && (
                      <section
                        className={`answer-card${running ? " is-streaming" : ""}`}
                      >
                        <Markdown content={content} />
                        {running && (
                          <div className="streaming-status" aria-live="polite">
                            <i /> 生成中
                          </div>
                        )}
                      </section>
                    )}
                    {turn.job.terminalError && (
                      <div className="assistant-error" role="alert">
                        <strong>{turn.job.terminalError.code}</strong>
                        <span>{turn.job.terminalError.message}</span>
                      </div>
                    )}
                    {!running && content && (
                      <div className="post-actions">
                        <IconButton
                          label="复制回答"
                          onClick={() => {
                            void navigator.clipboard.writeText(content);
                            notify("回答已复制", "success");
                          }}
                        >
                          <Copy size={14} />
                        </IconButton>
                      </div>
                    )}
                  </article>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {dashboard.status === "active" ? (
        <footer className="composer-area">
          <div className="composer">
            <textarea
              value={message}
              onChange={(event) =>
                setMessage(event.target.value.slice(0, 20_000))
              }
              onKeyDown={keyDown}
              placeholder="描述需求，继续完善这块看板"
              aria-label="消息"
              disabled={sending}
            />
            <div className="composer-actions">
              <span>
                {message.length
                  ? `${message.length.toLocaleString("zh-CN")} / 20,000`
                  : "Enter 发送 · Shift + Enter 换行"}
              </span>
              {activeTurn ? (
                <button
                  type="button"
                  className="stop-button"
                  onClick={() => void cancel()}
                  title="停止生成"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="send-button"
                  onClick={() => void send()}
                  disabled={!message.trim() || sending}
                  title="发送"
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
          </div>
          <div className="ai-note">内容由 AI 生成，请仔细甄别</div>
        </footer>
      ) : (
        <footer className="archived-note">
          <Archive size={15} /> 这块看板已经归档，历史内容仍可查看。
        </footer>
      )}
    </main>
  );
}
