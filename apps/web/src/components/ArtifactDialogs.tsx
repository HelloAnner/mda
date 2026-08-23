import type {
  Dashboard,
  DashboardFolder,
  DashboardRevision,
  Publication,
  ShareLink,
} from "@mda/contracts";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Save,
  Share2,
  Unlink,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ApiClient } from "../lib/api.ts";
import { boardStage } from "../lib/events.ts";
import { downloadResponse, formatBytes, relativeTime } from "../lib/format.ts";
import type { BoardProgressUpdate } from "./ChatWorkspace.tsx";
import {
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  FormDialog,
  StatusPill,
  useToast,
} from "./Ui.tsx";

export interface SaveResult {
  dashboard: Dashboard;
  revision: DashboardRevision;
  folderId?: string;
  origin?: DOMRect;
}

export function SaveDialog({
  open,
  api,
  dashboards,
  folders,
  initialDashboardId,
  origin,
  onClose,
  onSaved,
}: {
  open: boolean;
  api: ApiClient;
  dashboards: Dashboard[];
  folders: DashboardFolder[];
  initialDashboardId: string;
  origin?: DOMRect;
  onClose(): void;
  onSaved(result: SaveResult): Promise<void> | void;
}) {
  const { notify } = useToast();
  const [dashboardId, setDashboardId] = useState(initialDashboardId);
  const [folderId, setFolderId] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const dashboard = dashboards.find((item) => item.id === initialDashboardId);
    setDashboardId(initialDashboardId);
    setFolderId(dashboard?.folderId ?? "");
    setMessage("");
  }, [dashboards, initialDashboardId, open]);

  useEffect(() => {
    const dashboard = dashboards.find((item) => item.id === dashboardId);
    if (dashboard) setFolderId(dashboard.folderId ?? "");
  }, [dashboardId, dashboards]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const selected = dashboards.find((item) => item.id === dashboardId);
    if (!selected) return;
    setSubmitting(true);
    try {
      let dashboard = selected;
      if ((selected.folderId ?? "") !== folderId) {
        dashboard = await api.updateDashboard(selected.id, {
          folderId: folderId || null,
          expectedVersion: selected.version,
        });
      }
      const revision = await api.saveRevision(selected.id, message);
      await onSaved({
        dashboard,
        revision,
        ...(folderId ? { folderId } : {}),
        ...(origin ? { origin } : {}),
      });
      notify(`已保存为 r${revision.number}`, "success");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "看板保存失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      title="保存看板"
      description="将所选看板的最新成功草稿保存为不可变源码版本。"
      submitLabel="保存版本"
      submitting={submitting}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="看板" required hint="每块看板独立保存和管理。">
        <select
          value={dashboardId}
          onChange={(event) => setDashboardId(event.target.value)}
        >
          {dashboards
            .filter((dashboard) => dashboard.status === "active")
            .map((dashboard) => (
              <option value={dashboard.id} key={dashboard.id}>
                {dashboard.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="保存到目录">
        <select
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
        >
          <option value="">根目录</option>
          {folders.map((folder) => (
            <option value={folder.id} key={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="版本说明" hint="可选，最多 500 字。">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="例如：完成区域筛选与移动布局"
        />
      </Field>
      <div className="save-contract-note">
        <Save size={15} />
        <span>保存不会发布或公开看板；分享仍需经过独立构建。</span>
      </div>
    </FormDialog>
  );
}

function shareUrls(): Record<string, string> {
  try {
    return JSON.parse(
      sessionStorage.getItem("mda.share-urls") ?? "{}",
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function rememberShareUrl(id: string, url: string) {
  sessionStorage.setItem(
    "mda.share-urls",
    JSON.stringify({ ...shareUrls(), [id]: url }),
  );
}

export function ShareDialog({
  open,
  api,
  dashboard,
  onClose,
  onProgress,
}: {
  open: boolean;
  api: ApiClient;
  dashboard: Dashboard;
  onClose(): void;
  onProgress(update?: BoardProgressUpdate): void;
}) {
  const { notify } = useToast();
  const [revisions, setRevisions] = useState<DashboardRevision[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [revisionId, setRevisionId] = useState("");
  const [publicationId, setPublicationId] = useState("");
  const [expiry, setExpiry] = useState("604800");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdUrl, setCreatedUrl] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<ShareLink>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [revisionItems, publicationItems, shareItems] = await Promise.all([
        api.revisions(dashboard.id),
        api.publications(dashboard.id),
        api.shares(dashboard.id),
      ]);
      setRevisions(revisionItems);
      setPublications(publicationItems);
      setShares(shareItems);
      setRevisionId((current) =>
        current && revisionItems.some((item) => item.id === current)
          ? current
          : (revisionItems[0]?.id ?? ""),
      );
      setPublicationId((current) =>
        current && publicationItems.some((item) => item.id === current)
          ? current
          : (publicationItems[0]?.id ?? ""),
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "无法读取分享状态",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [api, dashboard.id, notify]);

  useEffect(() => {
    if (!open) return;
    setCreatedUrl("");
    void refresh();
  }, [open, refresh]);

  const matchingPublication = useMemo(
    () =>
      publications.find((publication) => publication.revisionId === revisionId),
    [publications, revisionId],
  );

  useEffect(() => {
    if (matchingPublication) setPublicationId(matchingPublication.id);
    else if (revisionId) setPublicationId("");
  }, [matchingPublication, revisionId]);

  async function ensureRevision(): Promise<DashboardRevision> {
    const selected = revisions.find((revision) => revision.id === revisionId);
    if (selected) return selected;
    const revision = await api.saveRevision(dashboard.id, "发布前自动保存");
    setRevisions((items) => [
      revision,
      ...items.filter((item) => item.id !== revision.id),
    ]);
    setRevisionId(revision.id);
    return revision;
  }

  async function ensurePublication(
    revision: DashboardRevision,
  ): Promise<Publication> {
    const existing = publications.find(
      (item) => item.revisionId === revision.id,
    );
    if (existing) return existing;
    const created = await api.createPublication(dashboard.id, revision.id);
    onProgress({
      job: created.job,
      stage: "正在准备发布构建",
      progress: 16,
      state: "running",
    });
    const final = await api.watchJob(created.job, (event) => {
      const stage = boardStage(event);
      if (!stage) return;
      onProgress({
        job: created.job,
        event,
        ...stage,
        state: event.type === "publication.created" ? "ready" : "running",
      });
    });
    if (final.state !== "succeeded") {
      throw new Error(final.terminalError?.message ?? "发布构建没有完成");
    }
    const build = await api.publicationBuild(created.build.id);
    if (!build.publicationId) throw new Error("发布版本尚未就绪");
    const publication = await api.publication(build.publicationId);
    setPublications((items) => [publication, ...items]);
    setPublicationId(publication.id);
    onProgress(undefined);
    return publication;
  }

  async function createShare(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const revision = await ensureRevision();
      const selectedPublication = publications.find(
        (item) => item.id === publicationId && item.revisionId === revision.id,
      );
      const publication = selectedPublication
        ? await api.publication(selectedPublication.id)
        : await ensurePublication(revision);
      const created = await api.createShare(
        publication.id,
        expiry ? Number(expiry) : undefined,
      );
      rememberShareUrl(created.shareLink.id, created.url);
      setCreatedUrl(created.url);
      setShares((items) => [created.shareLink, ...items]);
      notify("公开分享链接已创建", "success");
    } catch (error) {
      onProgress(undefined);
      notify(error instanceof Error ? error.message : "分享创建失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke() {
    if (!revokeTarget) return;
    setSubmitting(true);
    try {
      const updated = await api.revokeShare(revokeTarget.id);
      setShares((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      setRevokeTarget(undefined);
      notify("分享链接已经撤销", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "撤销失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    notify("链接已复制", "success");
  }

  return (
    <>
      <Dialog
        open={open}
        title="发布与分享"
        description="分享始终指向一个不可变发布版本，可以随时撤销。"
        onClose={onClose}
        width={680}
      >
        <form onSubmit={createShare} className="share-dialog-content">
          <section className="share-create-section">
            <div className="share-step">
              <span>1</span>
              <div>
                <strong>选择保存版本</strong>
                <small>
                  {revisions.length
                    ? "发布会进行一次全新的安全构建。"
                    : "当前草稿会先自动保存。"}
                </small>
              </div>
            </div>
            <Field label="源码版本">
              <select
                value={revisionId}
                onChange={(event) => setRevisionId(event.target.value)}
                disabled={loading}
              >
                {!revisions.length && (
                  <option value="">自动保存当前草稿</option>
                )}
                {revisions.map((revision) => (
                  <option value={revision.id} key={revision.id}>
                    r{revision.number} ·{" "}
                    {revision.message || relativeTime(revision.createdAt)}
                  </option>
                ))}
              </select>
            </Field>
            {matchingPublication && (
              <div className="existing-publication">
                <Check size={14} />
                <span>
                  这个版本已有 Publication p{matchingPublication.number}
                  ，无需重复构建。
                </span>
              </div>
            )}
            <div className="share-step">
              <span>2</span>
              <div>
                <strong>设置链接期限</strong>
                <small>过期或撤销后，下一次请求立即失效。</small>
              </div>
            </div>
            <Field label="有效期">
              <select
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
              >
                <option value="3600">1 小时</option>
                <option value="86400">1 天</option>
                <option value="604800">7 天</option>
                <option value="2592000">30 天</option>
                <option value="">不过期</option>
              </select>
            </Field>
            <Button
              type="submit"
              tone="primary"
              loading={submitting}
              className="share-submit"
            >
              <Share2 size={14} />{" "}
              {matchingPublication ? "创建分享链接" : "构建并创建链接"}
            </Button>
            {createdUrl && (
              <div className="created-share-url">
                <Link2 size={15} />
                <input value={createdUrl} readOnly aria-label="新分享链接" />
                <Button size="compact" onClick={() => void copy(createdUrl)}>
                  <Copy size={13} /> 复制
                </Button>
                <Button
                  size="compact"
                  onClick={() =>
                    window.open(createdUrl, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink size={13} /> 打开
                </Button>
              </div>
            )}
          </section>
          <section className="share-history-section">
            <div className="share-history-head">
              <h3>现有链接</h3>
              <span>{shares.length}</span>
            </div>
            {shares.length === 0 ? (
              <p className="muted-copy">还没有分享链接。</p>
            ) : (
              <div className="share-list">
                {shares.map((share) => {
                  const remembered = shareUrls()[share.id];
                  return (
                    <div className="share-row" key={share.id}>
                      <span className="share-link-icon">
                        <Link2 size={14} />
                      </span>
                      <span>
                        <strong>{shortShare(share.id)}</strong>
                        <small>
                          {share.expiresAt
                            ? `到期 ${new Date(share.expiresAt).toLocaleString("zh-CN")}`
                            : "长期有效"}{" "}
                          · {relativeTime(share.createdAt)}
                        </small>
                      </span>
                      <StatusPill value={share.status} />
                      {remembered && share.status === "active" && (
                        <Button
                          size="compact"
                          tone="ghost"
                          onClick={() => void copy(remembered)}
                        >
                          <Copy size={13} />
                        </Button>
                      )}
                      {share.status === "active" && (
                        <Button
                          size="compact"
                          tone="ghost"
                          onClick={() => setRevokeTarget(share)}
                        >
                          <Unlink size={13} />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          {publications.length > 0 && (
            <section className="publication-list-section">
              <h3>发布版本</h3>
              {publications.slice(0, 5).map((publication) => (
                <div className="publication-row" key={publication.id}>
                  <span>p{publication.number}</span>
                  <small>
                    {formatBytes(publication.totalBytes)} ·{" "}
                    {relativeTime(publication.createdAt)}
                  </small>
                  <Button
                    size="compact"
                    tone="ghost"
                    onClick={async () => {
                      try {
                        await downloadResponse(
                          await api.exportPublication(publication.id),
                          `${dashboard.name}-p${publication.number}.tar.gz`,
                        );
                      } catch (error) {
                        notify(
                          error instanceof Error ? error.message : "下载失败",
                          "error",
                        );
                      }
                    }}
                  >
                    <Download size={13} /> 下载
                  </Button>
                </div>
              ))}
            </section>
          )}
        </form>
      </Dialog>
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="撤销分享链接"
        description="撤销立即生效且不可恢复。已发布的不可变版本仍会保留。"
        confirmLabel="撤销链接"
        danger
        submitting={submitting}
        onClose={() => setRevokeTarget(undefined)}
        onConfirm={() => void revoke()}
      />
    </>
  );
}

function shortShare(value: string): string {
  const tail = value.split("_").at(-1) ?? value;
  return `链接 ${tail.slice(0, 8)}`;
}
