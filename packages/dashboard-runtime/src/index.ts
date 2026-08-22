export type QueryParameterValue = string | number | boolean | null;
export type QueryParameters = Record<string, QueryParameterValue>;

export interface DashboardContext {
  locale: string;
  timezone: string;
  theme: "light" | "dark";
  mode: "preview" | "published";
}

export interface QueryResult<T extends Record<string, unknown>> {
  rows: T[];
  meta: {
    columns: Array<{ name: string; type: string; nullable: boolean }>;
    rowCount: number;
    truncated: boolean;
    durationMs: number;
    fetchedAt: string;
    cache: { hit: boolean };
  };
}

export interface QueryOptions {
  signal?: AbortSignal;
  freshness?: "allow-cache" | "live";
}

export interface QueryWatchOptions {
  intervalMs: number;
  immediate?: boolean;
  pauseWhenHidden?: boolean;
  refreshOnFocus?: boolean;
  freshness?: "allow-cache" | "live";
}

export type QueryWatchEvent<T extends Record<string, unknown>> =
  | {
      type: "result";
      result: QueryResult<T>;
      reason: "initial" | "interval" | "focus" | "manual" | "parameters";
    }
  | {
      type: "error";
      error: Error;
      willRetry: boolean;
      nextRetryAt?: string;
    };

export interface QueryWatcher {
  refresh(): Promise<void>;
  stop(): void;
  close(): void;
}

function runtimeQueryUrl(queryId: string): URL {
  if (typeof location === "undefined") {
    throw new Error("Dashboard Runtime requires a browser");
  }
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "s" || !parts[1]) {
    throw new Error("Live Dashboard queries require a published Share Link");
  }
  return new URL(
    `/s/${encodeURIComponent(parts[1])}/__mda/query/${encodeURIComponent(queryId)}`,
    location.origin,
  );
}

async function query<T extends Record<string, unknown>>(
  queryId: string,
  parameters: QueryParameters = {},
  options: QueryOptions = {},
): Promise<QueryResult<T>> {
  const response = await fetch(runtimeQueryUrl(queryId), {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ parameters }),
    signal: options.signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    const value = (await response.json().catch(() => undefined)) as
      | { code?: string; message?: string }
      | undefined;
    throw new Error(
      `${value?.code ?? "QUERY_FAILED"}: ${value?.message ?? `HTTP ${response.status}`}`,
    );
  }
  return (await response.json()) as QueryResult<T>;
}

function watch<T extends Record<string, unknown>>(
  queryId: string,
  parameters: QueryParameters | (() => QueryParameters),
  options: QueryWatchOptions,
  listener: (event: QueryWatchEvent<T>) => void,
): QueryWatcher {
  const intervalMs = Math.max(1_000, options.intervalMs);
  let stopped = false;
  let active = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let lastParameters = "";

  const currentParameters = () =>
    typeof parameters === "function" ? parameters() : parameters;

  const schedule = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run("interval"), intervalMs);
  };

  const run = async (
    reason: "initial" | "interval" | "focus" | "manual" | "parameters",
  ) => {
    if (stopped) return;
    if (options.pauseWhenHidden && document.hidden) {
      schedule();
      return;
    }
    if (active) {
      pending = true;
      return;
    }
    active = true;
    const values = currentParameters();
    const serialized = JSON.stringify(values);
    const effectiveReason =
      lastParameters && lastParameters !== serialized ? "parameters" : reason;
    lastParameters = serialized;
    controller = new AbortController();
    try {
      const result = await query<T>(queryId, values, {
        freshness: options.freshness,
        signal: controller.signal,
      });
      if (!stopped)
        listener({ type: "result", result, reason: effectiveReason });
    } catch (error) {
      if (!stopped && !controller.signal.aborted) {
        listener({
          type: "error",
          error: error instanceof Error ? error : new Error(String(error)),
          willRetry: true,
          nextRetryAt: new Date(Date.now() + intervalMs).toISOString(),
        });
      }
    } finally {
      active = false;
      controller = undefined;
      if (pending) {
        pending = false;
        void run("parameters");
      } else {
        schedule();
      }
    }
  };

  const onVisibility = () => {
    if (!document.hidden) void run("focus");
  };
  const onFocus = () => void run("focus");
  if (options.pauseWhenHidden) {
    document.addEventListener("visibilitychange", onVisibility);
  }
  if (options.refreshOnFocus) window.addEventListener("focus", onFocus);
  if (options.immediate !== false) void run("initial");
  else schedule();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
  };
  return {
    refresh: () => run("manual"),
    stop,
    close: stop,
  };
}

function post(type: "ready" | "error", details: Record<string, unknown>): void {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    { source: "mda-dashboard-runtime", schemaVersion: 1, type, ...details },
    "*",
  );
}

export const dashboard = {
  query,
  watch,

  async getContext(): Promise<DashboardContext> {
    const dark =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      locale: typeof navigator === "undefined" ? "en" : navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      theme: dark ? "dark" : "light",
      mode:
        typeof location !== "undefined" && location.pathname.startsWith("/s/")
          ? "published"
          : "preview",
    };
  },

  ready(details: { title?: string } = {}): void {
    post("ready", details);
  },

  reportError(error: unknown): void {
    post("error", {
      message: error instanceof Error ? error.message : String(error),
    });
  },
};
