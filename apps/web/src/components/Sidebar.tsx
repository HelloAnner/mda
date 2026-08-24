import type {
  AgentSessionSummary,
  Dashboard,
  DashboardFolder,
} from "@mda/contracts";
import {
  Archive,
  Bell,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Gift,
  LayoutDashboard,
  MessageSquarePlus,
  Monitor,
  Pencil,
  Plus,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
import { type DragEvent, type ReactNode, useMemo, useState } from "react";
import { relativeTime } from "../lib/format.ts";

interface SidebarProps {
  collapsed: boolean;
  folders: DashboardFolder[];
  dashboards: Dashboard[];
  sessions: AgentSessionSummary[];
  activeDashboardId?: string;
  activeSessionId?: string;
  view: "chat" | "sources" | "queries" | "jobs";
  accountName: string;
  onHome(): void;
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="5" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="19" r="1.5" fill="currentColor" />
        </svg>
      </summary>
      <div className="popover sidebar-popover">{children}</div>
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
      className={`menu-row${danger ? " is-danger" : ""}`}
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
        className="sidebar-row"
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
            <Pencil size={14} /> 编辑
          </MenuAction>
          <MenuAction onClick={onArchive} danger>
            <Archive size={14} /> 归档
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
          className="sidebar-row"
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
          <span className="row-meta">{children.length + boards.length || ""}</span>
        </button>
        <ItemMenu>
          <MenuAction onClick={() => props.onCreateDashboard(folder.id)}>
            <Plus size={14} /> 新建看板
          </MenuAction>
          <MenuAction onClick={() => props.onCreateFolder(folder.id)}>
            <FolderPlus size={14} /> 新建子文件夹
          </MenuAction>
          <MenuAction onClick={() => props.onEditFolder(folder)}>
            <Pencil size={14} /> 编辑
          </MenuAction>
          <MenuAction onClick={() => props.onDeleteFolder(folder)} danger>
            <Trash2 size={14} /> 删除
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

  const topNavItems = [
    {
      icon: <MessageSquarePlus size={18} />,
      label: "新建任务",
      active: false,
      onClick: () => props.onCreateDashboard(),
    },
    {
      icon: <LayoutDashboard size={18} />,
      label: "我的看板",
      active: props.view === "chat" && !props.activeDashboardId,
      onClick: () => props.onHome(),
    },
  ];

  return (
    <aside className={`sidebar${props.collapsed ? " is-collapsed" : ""}`}>
      <div className="side-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span className="brand-word">MDA</span>
        </div>
        <div className="side-head-actions">
          <button className="icon-button" aria-label="搜索">
            <Search size={18} />
          </button>
          <button className="icon-button" aria-label="新建任务" onClick={() => props.onCreateDashboard()}>
            <SquarePen size={18} />
          </button>
        </div>
      </div>

      <div className="side-body">
        {topNavItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className={`nav-item${item.active ? " is-active" : ""}`}
            onClick={item.onClick}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}

        <div className="side-scroll">
          <div className="section">
            <div className="section-head">
              <span>项目</span>
              <button className="icon-button" aria-label="新建文件夹" onClick={() => props.onCreateFolder()}>
                <FolderPlus size={14} />
              </button>
            </div>
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
          </div>

          {activeDashboard && (
            <div className="section">
              <div className="section-head">
                <span>任务</span>
                <button className="icon-button" aria-label="新会话" onClick={props.onNewSession}>
                  <Plus size={14} />
                </button>
              </div>
              {sessionGroups.today.length > 0 && (
                <span className="time-label">今天</span>
              )}
              {sessionGroups.today.map((session) => (
                <button
                  type="button"
                  className={`sidebar-row${session.id === props.activeSessionId ? " is-current" : ""}`}
                  onClick={() => props.onSelectSession(session.id)}
                  key={session.id}
                  title={session.title}
                >
                  <span>{session.title}</span>
                  {["queued", "leased", "running"].includes(
                    session.latestJobState ?? "",
                  ) && (
                    <span className="trace-spinner" role="status" aria-label="生成中" />
                  )}
                </button>
              ))}
              {sessionGroups.earlier.length > 0 && (
                <span className="time-label">更早</span>
              )}
              {sessionGroups.earlier.slice(0, 8).map((session) => (
                <button
                  type="button"
                  className={`sidebar-row${session.id === props.activeSessionId ? " is-current" : ""}`}
                  onClick={() => props.onSelectSession(session.id)}
                  key={session.id}
                  title={`${session.title} · ${relativeTime(session.updatedAt)}`}
                >
                  <span>{session.title}</span>
                </button>
              ))}
            </div>
          )}

          {archived.length > 0 && (
            <div className="section">
              <div className="section-head"><span>已归档</span></div>
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
            </div>
          )}
        </div>
      </div>

      <div className="side-foot">
        <div className="side-promo">
          <span className="side-promo-icon">
            <Gift size={16} />
          </span>
          <span className="side-promo-text">
            与好友分享 MDA
            <small>各得 500 积分</small>
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
        <div className="account" onClick={props.onSettings}>
          <span className="avatar">{props.accountName.slice(0, 1).toUpperCase()}</span>
          <span className="account-name">{props.accountName}</span>
          <span className="account-actions">
            <Monitor size={14} />
            <Bell size={14} />
            <Settings size={14} />
          </span>
        </div>
      </div>
    </aside>
  );
}
