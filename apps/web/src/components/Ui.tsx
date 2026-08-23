import { AlertCircle, Check, Info, LoaderCircle, X } from "lucide-react";
import {
  createContext,
  type FormEvent,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

export function IconButton({
  label,
  active = false,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button${active ? " is-active" : ""} ${className}`}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function Button({
  tone = "default",
  size = "default",
  loading = false,
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "primary" | "danger" | "ghost";
  size?: "compact" | "default";
  loading?: boolean;
}) {
  return (
    <button
      type={props.type ?? "button"}
      className={`button tone-${tone} size-${size} ${className}`}
      {...props}
      disabled={loading || props.disabled}
    >
      {loading && (
        <LoaderCircle size={14} className="spin" aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

const statusTone: Record<string, string> = {
  active: "success",
  healthy: "success",
  ready: "success",
  succeeded: "success",
  passed: "success",
  open: "success",
  building: "progress",
  queued: "progress",
  leased: "progress",
  running: "progress",
  draft: "neutral",
  unknown: "neutral",
  archived: "neutral",
  disabled: "neutral",
  expired: "neutral",
  retired: "neutral",
  revoked: "neutral",
  degraded: "warning",
  unreachable: "danger",
  failed: "danger",
  cancelled: "danger",
  deleted: "danger",
};

const statusLabel: Record<string, string> = {
  active: "启用",
  healthy: "健康",
  ready: "就绪",
  succeeded: "完成",
  passed: "通过",
  open: "进行中",
  building: "构建中",
  queued: "排队中",
  leased: "已领取",
  running: "执行中",
  draft: "草稿",
  unknown: "待检查",
  archived: "已归档",
  disabled: "已停用",
  expired: "已过期",
  retired: "已停用",
  revoked: "已撤销",
  degraded: "需关注",
  unreachable: "不可达",
  failed: "失败",
  cancelled: "已取消",
  deleted: "已删除",
  preview: "预览",
  publish: "发布",
  edit: "对话",
};

export function StatusPill({ value }: { value: string }) {
  return (
    <span className={`status-pill tone-${statusTone[value] ?? "neutral"}`}>
      <i aria-hidden="true" />
      {statusLabel[value] ?? value}
    </span>
  );
}

export function Field({
  label,
  hint,
  required,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={`field ${className}`}>
      <legend className="field-label">
        {label}
        {required && <b aria-hidden="true">*</b>}
      </legend>
      {children}
      {error ? (
        <span className="field-error">{error}</span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </fieldset>
  );
}

export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  width = 520,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose(): void;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      >
        <header className="dialog-header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

export function FormDialog({
  open,
  title,
  description,
  children,
  submitLabel = "保存",
  submitting,
  onClose,
  onSubmit,
  width,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  submitLabel?: string;
  submitting?: boolean;
  onClose(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  width?: number;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      width={width}
    >
      <form onSubmit={onSubmit} className="dialog-form">
        <div className="dialog-form-content">{children}</div>
        <div className="dialog-inline-footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" tone="primary" loading={submitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  danger = false,
  submitting,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  submitting?: boolean;
  onClose(): void;
  onConfirm(): void;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            tone={danger ? "danger" : "primary"}
            loading={submitting}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={`confirm-note${danger ? " is-danger" : ""}`}>
        <AlertCircle size={17} aria-hidden="true" />
        <span>{description}</span>
      </div>
    </Dialog>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? " is-compact" : ""}`}>
      {icon && <span className="empty-state-icon">{icon}</span>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Skeleton({
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`skeleton ${className}`} {...props} />;
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="json-view">{JSON.stringify(value, null, 2)}</pre>;
}

type ToastTone = "info" | "success" | "error";
interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}
interface ToastContextValue {
  notify(message: string, tone?: ToastTone): void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = crypto.randomUUID();
    setItems((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(
      () => setItems((current) => current.filter((item) => item.id !== id)),
      4_200,
    );
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-stack" aria-live="polite">
          {items.map((item) => (
            <div className={`toast tone-${item.tone}`} key={item.id}>
              {item.tone === "success" ? (
                <Check size={15} />
              ) : item.tone === "error" ? (
                <AlertCircle size={15} />
              ) : (
                <Info size={15} />
              )}
              <span>{item.message}</span>
              <button
                type="button"
                aria-label="关闭通知"
                onClick={() =>
                  setItems((current) =>
                    current.filter((candidate) => candidate.id !== item.id),
                  )
                }
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}
