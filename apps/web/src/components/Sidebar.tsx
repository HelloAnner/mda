import type {
  AgentSessionSummary,
  Dashboard,
  DashboardFolder,
} from "@mda/contracts";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Database,
  Folder,
  FolderOpen,
  FolderPlus,
  History,
  LayoutDashboard,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  SearchCode,
  Settings,
  Trash2,
} from "lucide-react";
import { type DragEvent, type ReactNode, useMemo, useState } from "react";
import { relativeTime } from "../lib/format.ts";
import { IconButton } from "./Ui.tsx";

interface SidebarProps {
  collapsed: boolean;
  folders: DashboardFolder[];
  dashboards: Dashboard[];
  sessions: AgentSessionSummary[];
  activeDashboardId?: string;
  activeSessionId?: string;
  view: "chat" | "sources" | "queries" | "jobs";
  tenant: string;
  onToggle(): void;
  onSelectDashboard(id: string): void;
  onSelectSession(id: string): void;
  onNewSession(): void;
  onCreateDashboard(folderId?: string): void;
  onEditDashboard(dashboard: Dashboard): void;
  onArchiveDashboard(dashboard: Dashboard): void;
  onCreateFolder(parentId?: string): void;
  onEditFolder(folder: DashboardFolder): void;
  onDeleteFolder(folder: DashboardFolder): void;
  onMoveDashboard(id: string, folderId?: string): void;
  onView(view: "sources" | "queries" | "jobs"): void;
  onSettings(): void;
}

function ItemMenu({ children }: { children: ReactNode }) {
  return (
    <details className="sidebar-item-menu">
      <summary aria-label="更多操作" title="更多操作">
        <MoreHorizontal size={15} />
      </summary>
      <div className="sidebar-popover">{children}</div>
    </details>
  );
}

function MenuAction({
  children,
  danger,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={danger ? "is-danger" : ""}
      onClick={(event) => {
        const details = event.currentTarget.closest("details");
        if (details) details.open = false;
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function DashboardItem({
  dashboard,
  active,
  onSelect,
  onEdit,
  onArchive,
}: {
  dashboard: Dashboard;
  active: boolean;
  onSelect(): void;
  onEdit(): void;
  onArchive(): void;
}) {
  return (
    <div className={`sidebar-dashboard${active ? " is-current" : ""}`}>
      <button
        type="button"
        onClick={onSelect}
        title={dashboard.name}
        draggable={dashboard.status === "active"}
        onDragStart={(event) => {
          event.dataTransfer.setData(
            "application/x-mda-dashboard",
            dashboard.id,
          );
          event.dataTransfer.effectAllowed = "move";
        }}
      >
        <LayoutDashboard size={14} />
        <span>{dashboard.name}</span>
        {dashboard.status === "archived" && <Archive size={12} />}
      </button>
      {dashboard.status === "active" && (
        <ItemMenu>
          <MenuAction onClick={onEdit}>
            <Pencil size={13} /> 编辑
          </MenuAction>
          <MenuAction onClick={onArchive} danger>
            <Archive size={13} /> 归档
          </MenuAction>
        </ItemMenu>
      )}
    </div>
  );
}

interface FolderNodeProps {
  folder: DashboardFolder;
  allFolders: DashboardFolder[];
  dashboards: Dashboard[];
  expanded: Set<string>;
  activeDashboardId?: string;
  onToggle(id: string): void;
  onSelectDashboard(id: string): void;
  onEditDashboard(dashboard: Dashboard): void;
  onArchiveDashboard(dashboard: Dashboard): void;
  onCreateDashboard(folderId?: string): void;
  onCreateFolder(parentId?: string): void;
  onEditFolder(folder: DashboardFolder): void;
  onDeleteFolder(folder: DashboardFolder): void;
  onMoveDashboard(id: string, folderId?: string): void;
}

function FolderNode(props: FolderNodeProps) {
  const {
    folder,
    allFolders,
    dashboards,
    expanded,
    activeDashboardId,
    onToggle,
    onMoveDashboard,
  } = props;
  const children = allFolders.filter((item) => item.parentId === folder.id);
  const boards = dashboards.filter((item) => item.folderId === folder.id);
  const open = expanded.has(folder.id);
  const [dragOver, setDragOver] = useState(false);

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const dashboardId = event.dataTransfer.getData(
      "application/x-mda-dashboard",
    );
    if (dashboardId) onMoveDashboard(dashboardId, folder.id);
  }

  return (
    <div className="folder-node">
      <div
        className={`folder-row${dragOver ? " is-drop-target" : ""}`}
        data-folder-target={folder.id}
      >
        <button
          type="button"
          onClick={() => onToggle(folder.id)}
          title={folder.name}
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes("application/x-mda-dashboard")
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={drop}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {open ? <FolderOpen size={15} /> : <Folder size={15} />}
          <span>{folder.name}</span>
          <small>{children.length + boards.length || ""}</small>
        </button>
        <ItemMenu>
          <MenuAction onClick={() => props.onCreateDashboard(folder.id)}>
            <Plus size={13} /> 新建看板
          </MenuAction>
          <MenuAction onClick={() => props.onCreateFolder(folder.id)}>
            <FolderPlus size={13} /> 新建子文件夹
          </MenuAction>
          <MenuAction onClick={() => props.onEditFolder(folder)}>
            <Pencil size={13} /> 编辑
          </MenuAction>
          <MenuAction onClick={() => props.onDeleteFolder(folder)} danger>
            <Trash2 size={13} /> 删除
          </MenuAction>
        </ItemMenu>
      </div>
      {open && (
        <div className="folder-children">
          {children.map((child) => (
            <FolderNode key={child.id} {...props} folder={child} />
          ))}
          {boards.map((dashboard) => (
            <DashboardItem
              dashboard={dashboard}
              active={dashboard.id === activeDashboardId}
              onSelect={() => props.onSelectDashboard(dashboard.id)}
              onEdit={() => props.onEditDashboard(dashboard)}
              onArchive={() => props.onArchiveDashboard(dashboard)}
              key={dashboard.id}
            />
          ))}
          {children.length === 0 && boards.length === 0 && (
            <span className="folder-empty">空文件夹</span>
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(props.folders.map((folder) => folder.id)),
  );
  const roots = props.folders.filter((folder) => !folder.parentId);
  const rootDashboards = props.dashboards.filter(
    (dashboard) => !dashboard.folderId && dashboard.status === "active",
  );
  const archived = props.dashboards.filter(
    (dashboard) => dashboard.status === "archived",
  );
  const activeDashboard = props.dashboards.find(
    (dashboard) => dashboard.id === props.activeDashboardId,
  );
  const sessionGroups = useMemo(() => {
    const today: AgentSessionSummary[] = [];
    const earlier: AgentSessionSummary[] = [];
    const boundary = new Date();
    boundary.setHours(0, 0, 0, 0);
    for (const session of props.sessions) {
      (new Date(session.updatedAt) >= boundary ? today : earlier).push(session);
    }
    return { today, earlier };
  }, [props.sessions]);

  function toggleFolder(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (props.collapsed) {
    return (
      <aside className="sidebar is-collapsed">
        <div className="sidebar-rail">
          <IconButton label="展开侧栏" onClick={props.onToggle}>
            <PanelLeftOpen size={16} />
          </IconButton>
          <span className="rail-divider" />
          <IconButton
            label="新建看板"
            onClick={() => props.onCreateDashboard()}
          >
            <MessageSquarePlus size={17} />
          </IconButton>
          <IconButton
            label="当前看板"
            active={props.view === "chat"}
            onClick={() =>
              activeDashboard && props.onSelectDashboard(activeDashboard.id)
            }
          >
            <LayoutDashboard size={16} />
          </IconButton>
          <span className="rail-spacer" />
          <IconButton
            label="数据源"
            active={props.view === "sources"}
            onClick={() => props.onView("sources")}
          >
            <Database size={16} />
          </IconButton>
          <IconButton
            label="查询"
            active={props.view === "queries"}
            onClick={() => props.onView("queries")}
          >
            <SearchCode size={16} />
          </IconButton>
          <IconButton
            label="任务"
            active={props.view === "jobs"}
            onClick={() => props.onView("jobs")}
          >
            <History size={16} />
          </IconButton>
          <IconButton label="连接设置" onClick={props.onSettings}>
            <CircleUserRound size={17} />
          </IconButton>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-brand">
        <button className="brand-lockup" type="button" onClick={props.onToggle}>
          <span className="brand-mark">M</span>
          <strong>MDA</strong>
          <i />
          <span>看板</span>
        </button>
        <IconButton label="收起侧栏" onClick={props.onToggle}>
          <PanelLeftClose size={16} />
        </IconButton>
      </header>

      <button
        type="button"
        className="new-dashboard-button"
        onClick={() => props.onCreateDashboard()}
      >
        <MessageSquarePlus size={16} />
        新建看板
      </button>

      <div className="sidebar-directory-label">
        <span>看板目录</span>
        <IconButton label="新建文件夹" onClick={() => props.onCreateFolder()}>
          <FolderPlus size={14} />
        </IconButton>
      </div>

      <nav className="sidebar-scroll" aria-label="看板目录">
        <div
          className="root-drop-target"
          role="tree"
          data-folder-target="root"
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes("application/x-mda-dashboard")
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            const dashboardId = event.dataTransfer.getData(
              "application/x-mda-dashboard",
            );
            if (dashboardId) props.onMoveDashboard(dashboardId);
          }}
        >
          {rootDashboards.map((dashboard) => (
            <DashboardItem
              dashboard={dashboard}
              active={dashboard.id === props.activeDashboardId}
              onSelect={() => props.onSelectDashboard(dashboard.id)}
              onEdit={() => props.onEditDashboard(dashboard)}
              onArchive={() => props.onArchiveDashboard(dashboard)}
              key={dashboard.id}
            />
          ))}
        </div>
        {roots.map((folder) => (
          <FolderNode
            folder={folder}
            allFolders={props.folders}
            dashboards={props.dashboards.filter(
              (dashboard) => dashboard.status === "active",
            )}
            expanded={expanded}
            activeDashboardId={props.activeDashboardId}
            onToggle={toggleFolder}
            onSelectDashboard={props.onSelectDashboard}
            onEditDashboard={props.onEditDashboard}
            onArchiveDashboard={props.onArchiveDashboard}
            onCreateDashboard={props.onCreateDashboard}
            onCreateFolder={props.onCreateFolder}
            onEditFolder={props.onEditFolder}
            onDeleteFolder={props.onDeleteFolder}
            onMoveDashboard={props.onMoveDashboard}
            key={folder.id}
          />
        ))}

        {activeDashboard && (
          <section className="session-section">
            <div className="session-group-label">
              <span>会话</span>
              <button type="button" onClick={props.onNewSession}>
                <Plus size={13} />
              </button>
            </div>
            {sessionGroups.today.length > 0 && (
              <small className="time-label">今天</small>
            )}
            {sessionGroups.today.map((session) => (
              <button
                type="button"
                className={`session-row${session.id === props.activeSessionId ? " is-current" : ""}`}
                onClick={() => props.onSelectSession(session.id)}
                key={session.id}
                title={session.title}
              >
                <span>{session.title}</span>
                {["queued", "leased", "running"].includes(
                  session.latestJobState ?? "",
                ) && (
                  <i
                    className="session-spinner"
                    role="status"
                    aria-label="生成中"
                  />
                )}
              </button>
            ))}
            {sessionGroups.earlier.length > 0 && (
              <small className="time-label">更早</small>
            )}
            {sessionGroups.earlier.slice(0, 8).map((session) => (
              <button
                type="button"
                className={`session-row${session.id === props.activeSessionId ? " is-current" : ""}`}
                onClick={() => props.onSelectSession(session.id)}
                key={session.id}
                title={`${session.title} · ${relativeTime(session.updatedAt)}`}
              >
                <span>{session.title}</span>
              </button>
            ))}
          </section>
        )}

        {archived.length > 0 && (
          <section className="archived-section">
            <small className="time-label">已归档</small>
            {archived.map((dashboard) => (
              <DashboardItem
                dashboard={dashboard}
                active={dashboard.id === props.activeDashboardId}
                onSelect={() => props.onSelectDashboard(dashboard.id)}
                onEdit={() => {}}
                onArchive={() => {}}
                key={dashboard.id}
              />
            ))}
          </section>
        )}
      </nav>

      <footer className="sidebar-footer">
        <button
          type="button"
          className={props.view === "sources" ? "is-active" : ""}
          onClick={() => props.onView("sources")}
        >
          <Database size={15} /> 数据源
        </button>
        <button
          type="button"
          className={props.view === "queries" ? "is-active" : ""}
          onClick={() => props.onView("queries")}
        >
          <SearchCode size={15} /> 查询
        </button>
        <button
          type="button"
          className={props.view === "jobs" ? "is-active" : ""}
          onClick={() => props.onView("jobs")}
        >
          <History size={15} /> 任务
        </button>
      </footer>
      <button type="button" className="sidebar-user" onClick={props.onSettings}>
        <span className="user-avatar">
          {props.tenant.slice(0, 1).toUpperCase()}
        </span>
        <span>
          <strong>{props.tenant}</strong>
          <small>已连接</small>
        </span>
        <Settings size={14} />
      </button>
    </aside>
  );
}
