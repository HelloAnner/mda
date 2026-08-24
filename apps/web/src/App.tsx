import type {
  AgentSessionSummary,
  Dashboard,
  DashboardFolder,
  ServiceMetadata,
} from "@mda/contracts";
import {
  Check,
  Files,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Save,
  Search,
  Server,
  Share2,
  Sparkles,
  Sun,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  SaveDialog,
  type SaveResult,
  ShareDialog,
} from "./components/ArtifactDialogs.tsx";
import { BoardDrawer } from "./components/BoardDrawer.tsx";
import {
  type BoardProgressUpdate,
  ChatWorkspace,
} from "./components/ChatWorkspace.tsx";
import { AuthScreen } from "./components/AuthScreen.tsx";
import { LandingScreen } from "./components/LandingScreen.tsx";
import { RevisionDrawer } from "./components/RevisionDrawer.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { WorkspaceHome } from "./components/WorkspaceHome.tsx";
import {
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  FormDialog,
  ToastProvider,
  useToast,
} from "./components/Ui.tsx";
import { ApiClient, type AuthMeResponse } from "./lib/api.ts";
import { DataSourcesModule } from "./modules/DataSources.tsx";
import { JobsModule } from "./modules/Jobs.tsx";
import { QueriesModule } from "./modules/Queries.tsx";

type View = "chat" | "sources" | "queries" | "jobs";
type Drawer = "board" | "revisions";

type AuthStatus =
  | { status: "checking" }
  | { status: "guest"; screen: "landing" | "auth" }
  | { status: "authenticated"; user: AuthMeResponse };

interface DashboardEditor {
  dashboard?: Dashboard;
  folderId?: string;
}

interface FolderEditor {
  folder?: DashboardFolder;
  parentId?: string;
}

interface FlyState {
  label: string;
  from: DOMRect;
  to: DOMRect;
  key: string;
}

function currentTheme(): "light" | "dark" {
  return localStorage.getItem("mda.theme") === "dark" ? "dark" : "light";
}

function route(): { view: View; dashboardId?: string } {
  const value = window.location.hash.replace(/^#\/?/, "");
  if (value === "sources") return { view: "sources" };
  if (value === "queries") return { view: "queries" };
  if (value === "jobs") return { view: "jobs" };
  const match = value.match(/^dashboards\/(.+)$/);
  return match
    ? { view: "chat", dashboardId: decodeURIComponent(match[1] ?? "") }
    : { view: "chat" };
}

function setRoute(view: View, dashboardId?: string) {
  const value =
    view === "chat" && dashboardId
      ? `#/dashboards/${encodeURIComponent(dashboardId)}`
      : `#/${view === "chat" ? "" : view}`;
  if (window.location.hash !== value) window.location.hash = value;
}

function folderPath(
  folder: DashboardFolder,
  folders: DashboardFolder[],
): string {
  const names = [folder.name];
  let parentId = folder.parentId;
  const seen = new Set([folder.id]);
  while (parentId) {
    const parent = folders.find((item) => item.id === parentId);
    if (!parent || seen.has(parent.id)) break;
    names.unshift(parent.name);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAuthError(error: unknown): boolean {
  return /UNAUTHENTICATED|INVALID_CREDENTIALS/i.test(errorText(error));
}

export default function App() {
  const api = useMemo(() => new ApiClient(), []);
  const [auth, setAuth] = useState<AuthStatus>({ status: "checking" });
  const [pendingMessage, setPendingMessage] = useState<string | undefined>();

  useEffect(() => {
    api
      .me()
      .then((user) => setAuth({ status: "authenticated", user }))
      .catch(() => setAuth({ status: "guest", screen: "landing" }));
  }, [api]);

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const goToAuth = useCallback(
    (mode: "login" | "register", message?: string) => {
      setAuthMode(mode);
      if (message) setPendingMessage(message);
      setAuth({ status: "guest", screen: "auth" });
    },
    [],
  );

  const goToLanding = useCallback(() => {
    setPendingMessage(undefined);
    setAuth({ status: "guest", screen: "landing" });
  }, []);

  const onAuth = useCallback((user: AuthMeResponse) => {
    setAuth({ status: "authenticated", user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setPendingMessage(undefined);
    setAuth({ status: "guest", screen: "landing" });
  }, [api]);

  return (
    <ToastProvider>
      {auth.status === "checking" ? (
        <div className="app-loading">
          <span className="brand-mark">M</span>
          <p>正在准备工作空间</p>
        </div>
      ) : auth.status === "guest" ? (
        auth.screen === "landing" ? (
          <LandingScreen
            onLogin={() => goToAuth("login")}
            onRegister={() => goToAuth("register")}
            onStart={(message) => goToAuth("register", message)}
          />
        ) : (
          <AuthScreen
            api={api}
            initialMode={authMode}
            onAuth={onAuth}
            onBack={goToLanding}
          />
        )
      ) : (
        <Workspace
          api={api}
          user={auth.user}
          initialMessage={pendingMessage}
          onLogout={logout}
        />
      )}
    </ToastProvider>
  );
}

function Workspace({
  api,
  user,
  initialMessage,
  onLogout,
}: {
  api: ApiClient;
  user: AuthMeResponse;
  initialMessage?: string;
  onLogout(): void;
}) {
  const { notify } = useToast();
  const initialRoute = useMemo(route, []);
  const [theme, setTheme] = useState<"light" | "dark">(currentTheme);
  const [view, setView] = useState<View>(initialRoute.view);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [folders, setFolders] = useState<DashboardFolder[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [activeDashboardId, setActiveDashboardId] = useState<
    string | undefined
  >(initialRoute.dashboardId);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const activeSessionRef = useRef<string | undefined>(undefined);
  const newSessionRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<Drawer>();
  const [drawerMaximized, setDrawerMaximized] = useState(false);
  const [boardProgress, setBoardProgress] = useState<BoardProgressUpdate>();
  const [dashboardEditor, setDashboardEditor] = useState<DashboardEditor>();
  const [folderEditor, setFolderEditor] = useState<FolderEditor>();
  const [archiveTarget, setArchiveTarget] = useState<Dashboard>();
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<DashboardFolder>();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveOrigin, setSaveOrigin] = useState<DOMRect>();
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fly, setFly] = useState<FlyState>();
  const [pulseTarget, setPulseTarget] = useState<string>();
  const [metadata, setMetadata] = useState<ServiceMetadata>();

  const activeDashboard = dashboards.find(
    (dashboard) => dashboard.id === activeDashboardId,
  );

  useEffect(() => {
    document.documentElement.className = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "light" ? "#f8f8f7" : "#1a1a1a");
    localStorage.setItem("mda.theme", theme);
  }, [theme]);

  const refreshCore = useCallback(async () => {
    try {
      const [folderItems, dashboardItems, service] = await Promise.all([
        api.folders(),
        api.dashboards(),
        api.metadata(),
      ]);
      setFolders(folderItems);
      setDashboards(dashboardItems);
      setMetadata(service);
      setActiveDashboardId((current) => {
        if (current && dashboardItems.some((item) => item.id === current))
          return current;
        const next = dashboardItems.find(
          (item) => item.status === "active",
        )?.id;
        if (next && route().view === "chat") setRoute("chat", next);
        return next;
      });
    } catch (error) {
      notify(errorText(error), "error");
      if (isAuthError(error)) {
        onLogout();
      }
    } finally {
      setLoading(false);
    }
  }, [api, notify, onLogout]);

  useEffect(() => {
    void refreshCore();
  }, [refreshCore]);

  const bootstrappedRef = useRef(false);
  async function createFirstDashboard(message: string) {
    setSubmitting(true);
    try {
      const name = message.slice(0, 30).trim() || "新看板";
      const dashboard = await api.createDashboard({ name });
      const job = await api.sendMessage(dashboard.id, message);
      await refreshCore();
      chooseDashboard(dashboard.id);
      activeSessionRef.current = job.sessionId;
      setActiveSessionId(job.sessionId);
    } catch (error) {
      notify(errorText(error), "error");
    } finally {
      setSubmitting(false);
    }
  }
  useEffect(() => {
    if (initialMessage && !bootstrappedRef.current && !loading) {
      bootstrappedRef.current = true;
      void createFirstDashboard(initialMessage);
    }
  }, [initialMessage, loading]);

  const refreshSessions = useCallback(async () => {
    if (!activeDashboardId) {
      setSessions([]);
      return;
    }
    try {
      const { items } = await api.sessions(activeDashboardId);
      setSessions(items);
      const current = activeSessionRef.current;
      if (current && items.some((item) => item.id === current)) return;
      if (!newSessionRef.current) {
        const next = items[0]?.id;
        activeSessionRef.current = next;
        setActiveSessionId(next);
      }
    } catch (error) {
      notify(errorText(error), "error");
    }
  }, [activeDashboardId, api, notify]);

  useEffect(() => {
    activeSessionRef.current = undefined;
    setActiveSessionId(undefined);
    newSessionRef.current = false;
    setBoardProgress(undefined);
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    const change = () => {
      const next = route();
      setView(next.view);
      if (next.dashboardId) setActiveDashboardId(next.dashboardId);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  function chooseDashboard(id: string) {
    setView("chat");
    setActiveDashboardId(id);
    setDrawer(undefined);
    setDrawerMaximized(false);
    setRoute("chat", id);
  }

  function chooseView(next: Exclude<View, "chat">) {
    setView(next);
    setDrawer(undefined);
    setDrawerMaximized(false);
    setRoute(next);
  }

  function chooseHome() {
    setView("chat");
    setActiveDashboardId(undefined);
    activeSessionRef.current = undefined;
    setActiveSessionId(undefined);
    setDrawer(undefined);
    setDrawerMaximized(false);
    setRoute("chat");
  }

  function chooseSession(id?: string) {
    activeSessionRef.current = id;
    newSessionRef.current = !id;
    setActiveSessionId(id);
  }

  async function moveDashboard(id: string, folderId?: string) {
    const dashboard = dashboards.find((item) => item.id === id);
    if (!dashboard || (dashboard.folderId ?? undefined) === folderId) return;
    try {
      await api.updateDashboard(id, {
        folderId: folderId ?? null,
        expectedVersion: dashboard.version,
      });
      await refreshCore();
      notify("看板已移动", "success");
    } catch (error) {
      notify(errorText(error), "error");
    }
  }

  function openSave(origin?: DOMRect) {
    setSaveOrigin(origin);
    setSaveOpen(true);
  }

  async function saved(result: SaveResult) {
    await refreshCore();
    const targetId = result.folderId ?? "root";
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-folder-target="${CSS.escape(targetId)}"]`,
      );
      const fallback = new DOMRect(20, window.innerHeight / 2, 36, 36);
      const from =
        result.origin ??
        new DOMRect(
          window.innerWidth * 0.75,
          window.innerHeight * 0.46,
          42,
          42,
        );
      const to = target?.getBoundingClientRect() ?? fallback;
      setFly({
        label: result.dashboard.name,
        from,
        to,
        key: crypto.randomUUID(),
      });
      window.setTimeout(() => {
        setFly(undefined);
        setPulseTarget(targetId);
        window.setTimeout(() => setPulseTarget(undefined), 1_200);
      }, 760);
    });
  }

  const boardProgressChange = useCallback((update?: BoardProgressUpdate) => {
    setBoardProgress(update);
    if (update) {
      setDrawer("board");
      setDrawerMaximized(false);
    }
  }, []);

  const folderOptions = folders.map((folder) => ({
    id: folder.id,
    label: folderPath(folder, folders),
  }));

  return (
    <div
      className={`app-shell${drawerMaximized ? " has-maximized-drawer" : ""}`}
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        folders={folders}
        dashboards={dashboards}
        sessions={sessions}
        activeDashboardId={activeDashboardId}
        activeSessionId={activeSessionId}
        view={view}
        accountName={user.user.username}
        onHome={chooseHome}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onSelectDashboard={chooseDashboard}
        onSelectSession={chooseSession}
        onNewSession={() => chooseSession(undefined)}
        onCreateDashboard={(folderId) => setDashboardEditor({ folderId })}
        onEditDashboard={(dashboard) => setDashboardEditor({ dashboard })}
        onArchiveDashboard={setArchiveTarget}
        onCreateFolder={(parentId) => setFolderEditor({ parentId })}
        onEditFolder={(folder) => setFolderEditor({ folder })}
        onDeleteFolder={setDeleteFolderTarget}
        onMoveDashboard={(id, folderId) => void moveDashboard(id, folderId)}
        onView={chooseView}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className={`main${view === "chat" && !activeDashboard ? " is-home" : ""}`}>
        {(view !== "chat" || activeDashboard) && (
          <header className="topbar">
            <div className="top-left">
              <button type="button" className="model-trigger">
                <span className="model-name">
                  {activeDashboard?.name ?? "MDA Agent"}
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <span className="promo-tag">
                <Sparkles size={14} /> MDA 智能看板
              </span>
            </div>
            <div className="top-actions">
              {view === "chat" && activeDashboard && (
                <>
                  <button className="icon-button" aria-label="保存看板" onClick={() => openSave()} disabled={activeDashboard.status !== "active"}>
                    <Save size={16} />
                  </button>
                  <button className="icon-button" aria-label="发布与分享" onClick={() => setShareOpen(true)} disabled={activeDashboard.status !== "active"}>
                    <Share2 size={16} />
                  </button>
                  <i />
                  <button className={`icon-button${drawer === "board" ? " is-active" : ""}`} aria-label="智能看板" onClick={() => {
                    setDrawer((current) => current === "board" ? undefined : "board");
                    setDrawerMaximized(false);
                  }}>
                    <LayoutDashboard size={16} />
                  </button>
                  <button className={`icon-button${drawer === "revisions" ? " is-active" : ""}`} aria-label="版本文件" onClick={() => {
                    setDrawer((current) => current === "revisions" ? undefined : "revisions");
                    setDrawerMaximized(false);
                  }}>
                    <Files size={16} />
                  </button>
                </>
              )}
              <i />
              <button className="icon-button" aria-label="搜索">
                <Search size={16} />
              </button>
            </div>
          </header>
        )}

        <div className="stage">
          {loading ? (
            <div className="app-loading">
              <span className="brand-mark">M</span>
              <p>正在准备工作空间</p>
            </div>
          ) : view === "sources" ? (
            <DataSourcesModule api={api} />
          ) : view === "queries" ? (
            <QueriesModule api={api} />
          ) : view === "jobs" ? (
            <JobsModule api={api} dashboards={dashboards} />
          ) : activeDashboard ? (
            <ChatWorkspace
              api={api}
              dashboard={activeDashboard}
              sessionId={activeSessionId}
              boardOpen={drawer === "board"}
              revisionOpen={drawer === "revisions"}
              onSessionChange={chooseSession}
              onSessionsRefresh={refreshSessions}
              onEdit={() => setDashboardEditor({ dashboard: activeDashboard })}
              onSave={() => openSave()}
              onShare={() => setShareOpen(true)}
              onToggleBoard={() => {
                setDrawer((current) =>
                  current === "board" ? undefined : "board",
                );
                setDrawerMaximized(false);
              }}
              onToggleRevisions={() => {
                setDrawer((current) =>
                  current === "revisions" ? undefined : "revisions",
                );
                setDrawerMaximized(false);
              }}
              onBoardProgress={boardProgressChange}
            />
          ) : (
            <WorkspaceHome onStart={createFirstDashboard} />
          )}
        </div>

        {view === "chat" && activeDashboard && drawer === "board" && (
          <BoardDrawer
            api={api}
            dashboard={activeDashboard}
            progress={boardProgress}
            maximized={drawerMaximized}
            onProgress={boardProgressChange}
            onSave={openSave}
            onShare={() => setShareOpen(true)}
            onToggleMaximize={() => setDrawerMaximized((value) => !value)}
            onClose={() => {
              setDrawer(undefined);
              setDrawerMaximized(false);
            }}
          />
        )}
        {view === "chat" && activeDashboard && drawer === "revisions" && (
          <RevisionDrawer
            api={api}
            dashboard={activeDashboard}
            onSave={openSave}
            onClose={() => setDrawer(undefined)}
          />
        )}
      </div>

      {dashboardEditor && (
        <DashboardForm
          editor={dashboardEditor}
          folders={folderOptions}
          submitting={submitting}
          onClose={() => setDashboardEditor(undefined)}
          onSubmit={async (input) => {
            setSubmitting(true);
            try {
              const dashboard = dashboardEditor.dashboard
                ? await api.updateDashboard(dashboardEditor.dashboard.id, {
                    name: input.name,
                    description: input.description || null,
                    folderId: input.folderId || null,
                    expectedVersion: dashboardEditor.dashboard.version,
                  })
                : await api.createDashboard({
                    name: input.name,
                    ...(input.description
                      ? { description: input.description }
                      : {}),
                    ...(input.folderId ? { folderId: input.folderId } : {}),
                  });
              await refreshCore();
              setDashboardEditor(undefined);
              chooseDashboard(dashboard.id);
              notify(
                dashboardEditor.dashboard ? "看板信息已更新" : "看板已创建",
                "success",
              );
            } catch (error) {
              notify(errorText(error), "error");
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}

      {folderEditor && (
        <FolderForm
          editor={folderEditor}
          folders={folders}
          options={folderOptions}
          submitting={submitting}
          onClose={() => setFolderEditor(undefined)}
          onSubmit={async (input) => {
            setSubmitting(true);
            try {
              if (folderEditor.folder) {
                await api.updateFolder(folderEditor.folder.id, {
                  name: input.name,
                  parentId: input.parentId || null,
                  expectedVersion: folderEditor.folder.version,
                });
              } else {
                await api.createFolder({
                  name: input.name,
                  ...(input.parentId ? { parentId: input.parentId } : {}),
                });
              }
              await refreshCore();
              setFolderEditor(undefined);
              notify(
                folderEditor.folder ? "文件夹已更新" : "文件夹已创建",
                "success",
              );
            } catch (error) {
              notify(errorText(error), "error");
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="归档看板"
        description="归档后不能继续对话、保存或发布，但历史版本仍可查看和导出。"
        confirmLabel="归档"
        danger
        submitting={submitting}
        onClose={() => setArchiveTarget(undefined)}
        onConfirm={() => {
          if (!archiveTarget) return;
          setSubmitting(true);
          void api
            .archiveDashboard(archiveTarget.id, archiveTarget.version)
            .then(async () => {
              setArchiveTarget(undefined);
              await refreshCore();
              notify("看板已归档", "success");
            })
            .catch((error) => notify(errorText(error), "error"))
            .finally(() => setSubmitting(false));
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteFolderTarget)}
        title="删除文件夹"
        description="只有空文件夹可以删除；其中的看板和子文件夹不会被自动移动。"
        confirmLabel="删除"
        danger
        submitting={submitting}
        onClose={() => setDeleteFolderTarget(undefined)}
        onConfirm={() => {
          if (!deleteFolderTarget) return;
          setSubmitting(true);
          void api
            .deleteFolder(deleteFolderTarget.id, deleteFolderTarget.version)
            .then(async () => {
              setDeleteFolderTarget(undefined);
              await refreshCore();
              notify("文件夹已删除", "success");
            })
            .catch((error) => notify(errorText(error), "error"))
            .finally(() => setSubmitting(false));
        }}
      />

      {activeDashboard && (
        <>
          <SaveDialog
            open={saveOpen}
            api={api}
            dashboards={dashboards}
            folders={folders}
            initialDashboardId={activeDashboard.id}
            origin={saveOrigin}
            onClose={() => setSaveOpen(false)}
            onSaved={saved}
          />
          <ShareDialog
            open={shareOpen}
            api={api}
            dashboard={activeDashboard}
            onClose={() => setShareOpen(false)}
            onProgress={boardProgressChange}
          />
        </>
      )}

      <AccountDialog
        open={settingsOpen}
        user={user}
        theme={theme}
        metadata={metadata}
        onTheme={setTheme}
        onClose={() => setSettingsOpen(false)}
        onLogout={onLogout}
      />

      {fly && <SaveFly state={fly} />}
      {pulseTarget && (
        <style>{`[data-folder-target="${CSS.escape(pulseTarget)}"] { animation: folder-arrival 1.1s ease-out; }`}</style>
      )}
    </div>
  );
}

function DashboardForm({
  editor,
  folders,
  submitting,
  onClose,
  onSubmit,
}: {
  editor: DashboardEditor;
  folders: Array<{ id: string; label: string }>;
  submitting: boolean;
  onClose(): void;
  onSubmit(input: {
    name: string;
    description: string;
    folderId: string;
  }): void;
}) {
  const [name, setName] = useState(editor.dashboard?.name ?? "");
  const [description, setDescription] = useState(
    editor.dashboard?.description ?? "",
  );
  const [folderId, setFolderId] = useState(
    editor.dashboard?.folderId ?? editor.folderId ?? "",
  );
  return (
    <FormDialog
      open
      title={editor.dashboard ? "编辑看板" : "新建看板"}
      description={
        editor.dashboard
          ? "名称、说明与目录不会改变看板 ID 或历史版本。"
          : "先创建一个独立工作空间，再通过对话逐步生成。"
      }
      submitLabel={editor.dashboard ? "保存更改" : "创建看板"}
      submitting={submitting}
      onClose={onClose}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit({
          name: name.trim(),
          description: description.trim(),
          folderId,
        });
      }}
    >
      <Field label="名称" required>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          required
        />
      </Field>
      <Field label="说明">
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={1_000}
        />
      </Field>
      <Field label="目录">
        <select
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
        >
          <option value="">根目录</option>
          {folders.map((folder) => (
            <option value={folder.id} key={folder.id}>
              {folder.label}
            </option>
          ))}
        </select>
      </Field>
    </FormDialog>
  );
}

function FolderForm({
  editor,
  folders,
  options,
  submitting,
  onClose,
  onSubmit,
}: {
  editor: FolderEditor;
  folders: DashboardFolder[];
  options: Array<{ id: string; label: string }>;
  submitting: boolean;
  onClose(): void;
  onSubmit(input: { name: string; parentId: string }): void;
}) {
  const [name, setName] = useState(editor.folder?.name ?? "");
  const [parentId, setParentId] = useState(
    editor.folder?.parentId ?? editor.parentId ?? "",
  );
  const excluded = new Set<string>();
  if (editor.folder) {
    excluded.add(editor.folder.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        if (
          folder.parentId &&
          excluded.has(folder.parentId) &&
          !excluded.has(folder.id)
        ) {
          excluded.add(folder.id);
          changed = true;
        }
      }
    }
  }
  return (
    <FormDialog
      open
      title={editor.folder ? "编辑文件夹" : "新建文件夹"}
      description="文件夹用于组织看板，不改变版本、发布或分享边界。"
      submitLabel={editor.folder ? "保存更改" : "创建文件夹"}
      submitting={submitting}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name: name.trim(), parentId });
      }}
    >
      <Field label="名称" required>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          required
        />
      </Field>
      <Field label="上级目录">
        <select
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
        >
          <option value="">根目录</option>
          {options
            .filter((option) => !excluded.has(option.id))
            .map((option) => (
              <option value={option.id} key={option.id}>
                {option.label}
              </option>
            ))}
        </select>
      </Field>
    </FormDialog>
  );
}

function AccountDialog({
  open,
  user,
  theme,
  metadata,
  onTheme,
  onClose,
  onLogout,
}: {
  open: boolean;
  user: AuthMeResponse;
  theme: "light" | "dark";
  metadata?: ServiceMetadata;
  onTheme(theme: "light" | "dark"): void;
  onClose(): void;
  onLogout(): void;
}) {
  return (
    <Dialog
      open={open}
      title="账户"
      description="当前登录的 MDA 账户。"
      onClose={onClose}
      width={420}
    >
      <div className="settings-sections">
        <section className="service-card">
          <span>
            <Server size={16} />
          </span>
          <div>
            <strong>{user.user.username}</strong>
            <small>{metadata?.service ?? "mda-main"}</small>
          </div>
          <i />
        </section>
        <section>
          <h3>外观</h3>
          <div className="theme-segment">
            <button
              type="button"
              className={theme === "light" ? "is-selected" : ""}
              onClick={() => onTheme("light")}
            >
              <Sun size={14} /> 浅色{theme === "light" && <Check size={13} />}
            </button>
            <button
              type="button"
              className={theme === "dark" ? "is-selected" : ""}
              onClick={() => onTheme("dark")}
            >
              <Moon size={14} /> 深色{theme === "dark" && <Check size={13} />}
            </button>
          </div>
        </section>
        <section className="service-card">
          <span>
            <Server size={16} />
          </span>
          <div>
            <strong>{metadata?.service ?? "mda-main"}</strong>
            <small>
              服务 {metadata?.version ?? "—"} · Contract{" "}
              {metadata?.contractVersion ?? "—"}
            </small>
          </div>
          <i />
        </section>
        <div className="settings-actions">
          <Button tone="danger" onClick={onLogout}>
            <LogOut size={14} /> 退出登录
          </Button>
          <span />
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    </Dialog>
  );
}

function SaveFly({ state }: { state: FlyState }) {
  const style = {
    left: state.from.left,
    top: state.from.top,
    "--fly-x": `${state.to.left - state.from.left}px`,
    "--fly-y": `${state.to.top - state.from.top}px`,
  } as CSSProperties;
  return (
    <div
      className="save-fly-card"
      style={style}
      key={state.key}
      aria-hidden="true"
    >
      <span>
        <LayoutDashboard size={14} />
      </span>
      <strong>{state.label}</strong>
    </div>
  );
}
