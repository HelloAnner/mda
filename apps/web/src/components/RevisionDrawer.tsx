import type {
  Dashboard,
  DashboardRevision,
  DashboardRevisionFile,
} from "@mda/contracts";
import {
  ArrowLeft,
  Code2,
  Download,
  FileArchive,
  FileCode2,
  FileJson2,
  FileText,
  Grid2X2,
  List,
  Save,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../lib/api.ts";
import { downloadResponse, formatBytes, relativeTime } from "../lib/format.ts";
import { Button, EmptyState, IconButton, Skeleton, useToast } from "./Ui.tsx";

function fileIcon(path: string, size = 34) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (["json", "toml", "yaml", "yml"].includes(extension ?? "")) {
    return <FileJson2 size={size} />;
  }
  if (["ts", "tsx", "js", "jsx", "css", "html"].includes(extension ?? "")) {
    return <FileCode2 size={size} />;
  }
  if (["zip", "gz", "tar"].includes(extension ?? "")) {
    return <FileArchive size={size} />;
  }
  return <FileText size={size} />;
}

function isTextFile(path: string): boolean {
  return /\.(?:css|csv|html|js|json|jsx|md|svg|toml|ts|tsx|txt|xml|yaml|yml)$/i.test(
    path,
  );
}

interface RevisionDrawerProps {
  api: ApiClient;
  dashboard: Dashboard;
  onSave(origin?: DOMRect): void;
  onClose(): void;
}

export function RevisionDrawer({
  api,
  dashboard,
  onSave,
  onClose,
}: RevisionDrawerProps) {
  const { notify } = useToast();
  const [revisions, setRevisions] = useState<DashboardRevision[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [files, setFiles] = useState<DashboardRevisionFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [preview, setPreview] = useState<{
    file: DashboardRevisionFile;
    content?: string;
    loading: boolean;
  }>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api.revisions(dashboard.id);
      setRevisions(items);
      setSelectedId((current) =>
        current && items.some((item) => item.id === current)
          ? current
          : items[0]?.id,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "无法读取保存版本",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [api, dashboard.id, notify]);

  useEffect(() => {
    setRevisions([]);
    setFiles([]);
    setSelectedId(undefined);
    setPreview(undefined);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setFiles([]);
      return;
    }
    let disposed = false;
    setFilesLoading(true);
    void api
      .revisionFiles(selectedId)
      .then(({ items }) => {
        if (!disposed) setFiles(items);
      })
      .catch((error) => {
        if (!disposed)
          notify(
            error instanceof Error ? error.message : "无法读取文件",
            "error",
          );
      })
      .finally(() => {
        if (!disposed) setFilesLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [api, notify, selectedId]);

  const selected = revisions.find((revision) => revision.id === selectedId);
  const visibleFiles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? files.filter((file) => file.path.toLocaleLowerCase().includes(needle))
      : files;
  }, [files, query]);

  async function openFile(file: DashboardRevisionFile) {
    setPreview({ file, loading: true });
    if (!isTextFile(file.path)) {
      setPreview({ file, loading: false });
      return;
    }
    try {
      const response = await api.readRevisionFile(
        selectedId as string,
        file.path,
      );
      const text = await response.text();
      setPreview({
        file,
        content:
          text.length > 500_000
            ? `${text.slice(0, 500_000)}\n\n[文件预览已截断]`
            : text,
        loading: false,
      });
    } catch (error) {
      setPreview(undefined);
      notify(error instanceof Error ? error.message : "无法预览文件", "error");
    }
  }

  async function downloadFile(file: DashboardRevisionFile) {
    try {
      await downloadResponse(
        await api.readRevisionFile(selectedId as string, file.path),
        file.path.split("/").at(-1) ?? "source-file",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "文件下载失败", "error");
    }
  }

  async function exportRevision() {
    if (!selected) return;
    try {
      await downloadResponse(
        await api.exportRevision(selected.id),
        `${dashboard.name}-r${selected.number}.tar.gz`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "版本导出失败", "error");
    }
  }

  return (
    <section className="right-region">
      <aside className="workspace-drawer revision-drawer">
        <header className="workspace-header">
          <div className="drawer-title">
            <Code2 size={20} />
            <strong>
              {preview ? preview.file.path.split("/").at(-1) : "版本文件"}
            </strong>
          </div>
          <div className="drawer-actions">
            {preview && (
              <IconButton
                label="返回文件列表"
                onClick={() => setPreview(undefined)}
              >
                <ArrowLeft size={15} />
              </IconButton>
            )}
            {!preview && (
              <>
                <IconButton
                  label="保存当前草稿"
                  onClick={(event) =>
                    onSave(event.currentTarget.getBoundingClientRect())
                  }
                >
                  <Save size={15} />
                </IconButton>
                <IconButton
                  label="导出当前版本"
                  onClick={() => void exportRevision()}
                  disabled={!selected}
                >
                  <Download size={15} />
                </IconButton>
              </>
            )}
            <IconButton label="关闭" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
        </header>

        {preview ? (
          <div className="source-preview">
            <div className="source-preview-meta">
              <span>{preview.file.path}</span>
              <small>{formatBytes(preview.file.size)}</small>
              <Button
                size="compact"
                onClick={() => void downloadFile(preview.file)}
              >
                <Download size={13} /> 下载
              </Button>
            </div>
            {preview.loading ? (
              <div className="source-preview-loading">
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            ) : preview.content !== undefined ? (
              <pre>
                <code>{preview.content}</code>
              </pre>
            ) : (
              <EmptyState
                title="此文件不提供文本预览"
                description="可以下载原始文件后使用本地应用查看。"
                action={
                  <Button onClick={() => void downloadFile(preview.file)}>
                    下载文件
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <>
            <div className="revision-primary-toolbar">
              <div className="segments">
                {revisions.slice(0, 5).map((revision) => (
                  <button
                    type="button"
                    className={revision.id === selectedId ? "is-selected" : ""}
                    onClick={() => setSelectedId(revision.id)}
                    key={revision.id}
                    title={revision.message || `版本 ${revision.number}`}
                  >
                    r{revision.number}
                  </button>
                ))}
              </div>
              <span className="file-stat">
                {selected
                  ? `${selected.fileCount} 个文件，${formatBytes(selected.totalBytes)}`
                  : "尚未保存"}
              </span>
              <Button
                tone="primary"
                size="compact"
                onClick={(event) =>
                  onSave(event.currentTarget.getBoundingClientRect())
                }
              >
                <Save size={13} /> 保存
              </Button>
            </div>
            <div className="revision-secondary-toolbar">
              <label className="drawer-search">
                <Search size={14} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索文件"
                />
              </label>
              {selected && (
                <span className="revision-time">
                  {relativeTime(selected.createdAt)}
                </span>
              )}
              <div className="view-toggle">
                <button
                  type="button"
                  className={view === "grid" ? "is-selected" : ""}
                  onClick={() => setView("grid")}
                  title="网格"
                >
                  <Grid2X2 size={14} />
                </button>
                <button
                  type="button"
                  className={view === "list" ? "is-selected" : ""}
                  onClick={() => setView("list")}
                  title="列表"
                >
                  <List size={15} />
                </button>
              </div>
            </div>
            <div className={`file-browser is-${view}`}>
              {loading || filesLoading ? (
                [
                  "one",
                  "two",
                  "three",
                  "four",
                  "five",
                  "six",
                  "seven",
                  "eight",
                ].map((item) => (
                  <div className="file-skeleton" key={item}>
                    <Skeleton />
                    <Skeleton />
                    <Skeleton />
                  </div>
                ))
              ) : revisions.length === 0 ? (
                <EmptyState
                  icon={<Save size={20} />}
                  title="还没有保存版本"
                  description="完成一次看板编辑后，将当前草稿保存为不可变版本。"
                  action={
                    <Button tone="primary" onClick={() => onSave()}>
                      保存当前草稿
                    </Button>
                  }
                />
              ) : visibleFiles.length === 0 ? (
                <EmptyState title="没有匹配的文件" compact />
              ) : (
                visibleFiles.map((file) => (
                  <article className="file-card" key={file.path}>
                    <button
                      type="button"
                      className="file-card-open"
                      onClick={() => void openFile(file)}
                    >
                      <div className="file-preview-icon">
                        {fileIcon(file.path)}
                      </div>
                      <div className="file-meta">
                        <strong>{file.path}</strong>
                        <small>{formatBytes(file.size)}</small>
                      </div>
                    </button>
                    <IconButton
                      label="下载"
                      onClick={() => void downloadFile(file)}
                    >
                      <Download size={13} />
                    </IconButton>
                  </article>
                ))
              )}
            </div>
          </>
        )}
      </aside>
    </section>
  );
}
