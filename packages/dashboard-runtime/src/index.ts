export interface DashboardContext {
  locale: string;
  timezone: string;
  theme: "light" | "dark";
  mode: "preview" | "published";
}

export interface QueryResult<T extends Record<string, unknown>> {
  rows: T[];
  columns: Array<{ name: string; type: string }>;
  fetchedAt: string;
  truncated: boolean;
}

export interface QueryWatchOptions {
  intervalMs?: number;
  pauseWhenHidden?: boolean;
  refreshOnFocus?: boolean;
}

export interface QueryWatchEvent<T extends Record<string, unknown>> {
  status: "loading" | "ready" | "error";
  result?: QueryResult<T>;
  error?: Error;
}

export interface QueryWatcher {
  refresh(): Promise<void>;
  close(): void;
}

function unavailable(): Error {
  return new Error(
    "Dashboard data Runtime is not available in this Preview yet. Use clearly labeled fixture data or an honest empty state.",
  );
}

function post(type: "ready" | "error", details: Record<string, unknown>): void {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    { source: "mda-dashboard-runtime", schemaVersion: 1, type, ...details },
    "*",
  );
}

export const dashboard = {
  async query<
    T extends Record<string, unknown> = Record<string, unknown>,
  >(): Promise<QueryResult<T>> {
    throw unavailable();
  },

  watch<T extends Record<string, unknown> = Record<string, unknown>>(
    _queryId: string,
    _parameters: Record<string, unknown> | (() => Record<string, unknown>),
    _options: QueryWatchOptions,
    listener: (event: QueryWatchEvent<T>) => void,
  ): QueryWatcher {
    let closed = false;
    const refresh = async () => {
      if (!closed) listener({ status: "error", error: unavailable() });
    };
    queueMicrotask(() => void refresh());
    return {
      refresh,
      close() {
        closed = true;
      },
    };
  },

  async getContext(): Promise<DashboardContext> {
    const dark =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      locale: typeof navigator === "undefined" ? "en" : navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      theme: dark ? "dark" : "light",
      mode: "preview",
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
