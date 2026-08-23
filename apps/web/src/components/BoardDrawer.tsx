import type {
  AgentEvent,
  AgentJob,
  Dashboard,
  DashboardPreview,
} from "@mda/contracts";
import {
  ExternalLink,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
  Share2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../lib/api.ts";
import { boardStage } from "../lib/events.ts";
import { relativeTime } from "../lib/format.ts";
import type { BoardProgressUpdate } from "./ChatWorkspace.tsx";
import { Button, EmptyState, IconButton, StatusPill, useToast } from "./Ui.tsx";

function DashboardLoadingVisual({ label }: { label: string }) {
  return (
    <div className="dashboard-loading" role="status" aria-live="polite">
      <div className="dashboard-loading-visual" aria-hidden="true">
        <div className="dashboard-loading-board">
          <div className="dashboard-loading-board-top">
            <span />
            <span />
            <span />
          </div>
          <div className="dashboard-loading-chart">
            <span className="dashboard-loading-bar one" />
            <span className="dashboard-loading-bar two" />
            <span className="dashboard-loading-bar three" />
            <span className="dashboard-loading-bar four" />
          </div>
          <div className="dashboard-loading-lines">
            <span />
            <span />
            <span />
          </div>
          <div className="dashboard-loading-scan" />
        </div>
        <div className="dashboard-loading-magnifier">
          <div className="dashboard-loading-lens" />
          <div className="dashboard-loading-handle" />
        </div>
      </div>
      <div className="dashboard-loading-label">{label}</div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="board-stream-skeleton" aria-hidden="true">
      <div className="skeleton-hero">
        <span />
        <span />
      </div>
      <div className="skeleton-kpis">
        {["one", "two", "three", "four"].map((item) => (
          <span key={item} />
        ))}
      </div>
      <div className="skeleton-charts">
        <span />
        <span />
      </div>
    </div>
  );
}

interface BoardDrawerProps {
  api: ApiClient;
  dashboard: Dashboard;
  progress?: BoardProgressUpdate;
  maximized: boolean;
  onProgress(update?: BoardProgressUpdate): void;
  onSave(origin?: DOMRect): void;
  onShare(): void;
  onToggleMaximize(): void;
  onClose(): void;
}

export function BoardDrawer({
  api,
  dashboard,
  progress,
  maximized,
  onProgress,
  onSave,
  onShare,
  onToggleMaximize,
  onClose,
}: BoardDrawerProps) {
  const { notify } = useToast();
  const [previews, setPreviews] = useState<DashboardPreview[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [frameKey, setFrameKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const followedRef = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const items = await api.previews(dashboard.id);
      setPreviews(items);
      setSelectedId((current) => {
        if (
          progress?.previewId &&
          items.some((item) => item.id === progress.previewId)
        ) {
          return progress.previewId;
        }
        if (current && items.some((item) => item.id === current))
          return current;
        return (
          items.find((item) => item.status === "ready")?.id ?? items[0]?.id
        );
      });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "无法读取看板预览",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [api, dashboard.id, notify, progress?.previewId]);

  useEffect(() => {
    setPreviews([]);
    setSelectedId(undefined);
    setLoading(true);
    followedRef.current = undefined;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (progress?.state === "ready") void refresh();
  }, [progress?.state, refresh]);

  const follow = useCallback(
    async (job: AgentJob) => {
      if (followedRef.current === job.id) return;
      followedRef.current = job.id;
      try {
        const final = await api.watchJob(job, (event: AgentEvent) => {
          const stage = boardStage(event);
          if (!stage) return;
          onProgress({
            job,
            event,
            ...stage,
            state:
              event.type === "preview.ready"
                ? "ready"
                : event.type === "validation.completed" &&
                    event.data.status !== "passed"
                  ? "failed"
                  : "running",
            ...(event.type === "preview.ready" && event.data.previewId
              ? { previewId: String(event.data.previewId) }
              : {}),
          });
        });
        if (final.state === "failed" || final.state === "cancelled") {
          onProgress({
            job: final,
            stage: final.terminalError?.message ?? "看板预览未能完成",
            progress: 100,
            state: "failed",
          });
        }
        await refresh();
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "预览进度连接中断",
          "error",
        );
      } finally {
        setCreating(false);
      }
    },
    [api, notify, onProgress, refresh],
  );

  useEffect(() => {
    if (progress || loading) return;
    const building = previews.find((preview) => preview.status === "building");
    if (!building) return;
    void api.job(building.jobId).then((job) => {
      onProgress({
        job,
        stage: "正在准备看板预览",
        progress: 16,
        state: "running",
      });
      void follow(job);
    });
  }, [api, follow, loading, onProgress, previews, progress]);

  async function createPreview() {
    if (creating) return;
    setCreating(true);
    try {
      const created = await api.createPreview(dashboard.id);
      setPreviews((items) => [created.preview, ...items]);
      setSelectedId(created.preview.id);
      onProgress({
        job: created.job,
        stage: "正在准备看板预览",
        progress: 16,
        state: "running",
      });
      void follow(created.job);
    } catch (error) {
      setCreating(false);
      notify(error instanceof Error ? error.message : "无法创建预览", "error");
    }
  }

  const selected = previews.find((preview) => preview.id === selectedId);
  const activeProgress = progress?.state === "running";
  const showMask =
    activeProgress || creating || selected?.status === "building";
  const readyPreviews = useMemo(
    () => previews.filter((preview) => preview.status !== "failed"),
    [previews],
  );

  function refreshBoard() {
    if (selected?.status === "ready") {
      setFrameKey((value) => value + 1);
      notify("已刷新看板数据", "success");
    } else {
      void createPreview();
    }
  }

  return (
    <section className={`right-region${maximized ? " is-maximized" : ""}`}>
      <aside className="workspace-drawer board-drawer">
        <header className="workspace-header board-header">
          <div className="drawer-title">
            <LayoutGlyph />
            <strong>{dashboard.name}</strong>
          </div>
          <div className="board-tabs" role="tablist" aria-label="看板预览版本">
            {readyPreviews.slice(0, maximized ? 6 : 3).map((preview, index) => (
              <button
                type="button"
                role="tab"
                aria-selected={preview.id === selectedId}
                className={preview.id === selectedId ? "is-active" : ""}
                onClick={() => setSelectedId(preview.id)}
                key={preview.id}
                title={`${preview.sourceRevisionId ? "保存版本" : "草稿预览"} · ${relativeTime(preview.createdAt)}`}
              >
                {preview.sourceRevisionId
                  ? `版本 ${readyPreviews.length - index}`
                  : `预览 ${readyPreviews.length - index}`}
              </button>
            ))}
          </div>
          <div className="drawer-actions">
            <IconButton
              label="保存"
              onClick={(event) =>
                onSave(event.currentTarget.getBoundingClientRect())
              }
            >
              <Save size={15} />
            </IconButton>
            <IconButton
              label="刷新数据"
              onClick={refreshBoard}
              disabled={creating}
            >
              <RefreshCw size={15} className={creating ? "spin" : ""} />
            </IconButton>
            <IconButton label="发布与分享" onClick={onShare}>
              <Share2 size={15} />
            </IconButton>
            {selected?.status === "ready" && (
              <IconButton
                label="在新标签页打开"
                onClick={() =>
                  window.open(selected.url, "_blank", "noopener,noreferrer")
                }
              >
                <ExternalLink size={15} />
              </IconButton>
            )}
            <IconButton
              label={maximized ? "退出全屏" : "全屏"}
              onClick={onToggleMaximize}
            >
              {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </IconButton>
            <IconButton label="关闭" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
        </header>
        <div className="dashboard-stream-rail" aria-hidden={!showMask}>
          {showMask && <span />}
        </div>
        <div className="board-content">
          {loading ? (
            <BoardSkeleton />
          ) : selected?.status === "ready" ? (
            <iframe
              key={`${selected.id}:${frameKey}`}
              className="board-frame"
              src={selected.url}
              title={`${dashboard.name} 预览`}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              referrerPolicy="no-referrer"
            />
          ) : selected?.status === "failed" ? (
            <EmptyState
              title="这次预览没有完成"
              description={
                selected.error?.message ?? "可以在修复源码后重新生成。"
              }
              action={
                <Button tone="primary" onClick={() => void createPreview()}>
                  重新生成
                </Button>
              }
            />
          ) : selected?.status === "expired" ? (
            <EmptyState
              title="预览已经过期"
              description="源文件仍然安全保存，可以生成一个新的短期预览。"
              action={
                <Button tone="primary" onClick={() => void createPreview()}>
                  生成新预览
                </Button>
              }
            />
          ) : !showMask ? (
            <EmptyState
              icon={<LayoutGlyph />}
              title="还没有可查看的看板"
              description="完成一次看板编辑后，生成安全的短期预览。"
              action={
                <Button
                  tone="primary"
                  onClick={() => void createPreview()}
                  loading={creating}
                >
                  生成预览
                </Button>
              }
            />
          ) : null}
          {selected && !showMask && (
            <div className="board-meta-strip">
              <StatusPill value={selected.status} />
              <span>
                {selected.fileCount
                  ? `${selected.fileCount} 个构建文件`
                  : "预览"}
              </span>
              <time>{relativeTime(selected.createdAt)}</time>
            </div>
          )}
          {showMask && (
            <div className="board-progress-mask">
              <BoardSkeleton />
              <div className="board-progress-focus">
                <DashboardLoadingVisual
                  label={progress?.stage ?? "正在渲染看板"}
                />
                <div className="board-progress-track">
                  <span style={{ width: `${progress?.progress ?? 18}%` }} />
                </div>
                <small>页面会在准备好后自动显现</small>
              </div>
            </div>
          )}
          {progress?.state === "failed" && !showMask && (
            <div className="board-progress-error" role="alert">
              <strong>渲染未完成</strong>
              <span>{progress.stage}</span>
              <button type="button" onClick={() => onProgress(undefined)}>
                关闭
              </button>
            </div>
          )}
        </div>
      </aside>
    </section>
  );
}

function LayoutGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.25"
        y="2.25"
        width="15.5"
        height="15.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M2.75 7.4h14.5M8 7.5v9.75"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}
