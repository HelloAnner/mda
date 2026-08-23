import type {
  CreateRegisteredQueryRequest,
  DataSource,
  HttpQueryOperation,
  JdbcQueryOperation,
  QueryResult,
  RegisteredQuery,
} from "@mda/contracts";
import { Braces, Play, Plus, Search, ShieldCheck, Table2 } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  FormDialog,
  JsonView,
  Skeleton,
  StatusPill,
  useToast,
} from "../components/Ui.tsx";
import type { ApiClient } from "../lib/api.ts";
import { formatDuration, relativeTime, shortId } from "../lib/format.ts";

interface QueryDraft {
  sourceId: string;
  name: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  rowsPointer: string;
  queryMap: string;
  body: string;
  sql: string;
  parameters: string;
  samples: string;
  public: boolean;
  minRefreshIntervalMs: string;
}

const emptyDraft: QueryDraft = {
  sourceId: "",
  name: "",
  description: "",
  method: "GET",
  path: "/",
  rowsPointer: "",
  queryMap: "{}",
  body: "{}",
  sql: "SELECT 1 AS value",
  parameters: "[]",
  samples: "{}",
  public: false,
  minRefreshIntervalMs: "5000",
};

type QueryValue = string | number | boolean | null;

function parseRecord(value: string, label: string): Record<string, QueryValue> {
  const parsed: unknown = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return parsed as Record<string, QueryValue>;
}

function parseParameters(value: string): RegisteredQuery["parameters"] {
  const parsed: unknown = JSON.parse(value || "[]");
  if (!Array.isArray(parsed)) throw new Error("参数定义必须是 JSON 数组");
  return parsed as RegisteredQuery["parameters"];
}

function resultValue(value: unknown): string {
  if (value === null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function QueriesModule({ api }: { api: ApiClient }) {
  const { notify } = useToast();
  const [queries, setQueries] = useState<RegisteredQuery[]>([]);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [executeOpen, setExecuteOpen] = useState(false);
  const [draft, setDraft] = useState<QueryDraft>(emptyDraft);
  const [parameters, setParameters] = useState("{}");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QueryResult>();
  const [rawOpen, setRawOpen] = useState(false);

  const selected = queries.find((query) => query.id === selectedId);
  const selectedSource = sources.find((source) => source.id === draft.sourceId);
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return queries.filter(
      (query) =>
        (!sourceFilter || query.sourceId === sourceFilter) &&
        (!needle ||
          `${query.name} ${query.id}`.toLocaleLowerCase().includes(needle)),
    );
  }, [queries, search, sourceFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [queryItems, sourceItems] = await Promise.all([
        api.queries(),
        api.dataSources(),
      ]);
      setQueries(queryItems);
      setSources(sourceItems);
      setSelectedId((current) =>
        current && queryItems.some((query) => query.id === current)
          ? current
          : queryItems[0]?.id,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法读取查询", "error");
    } finally {
      setLoading(false);
    }
  }, [api, notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate() {
    const source = sources.find((item) => item.status === "active");
    setDraft({ ...emptyDraft, sourceId: source?.id ?? "" });
    setCreateOpen(true);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const source = sources.find((item) => item.id === draft.sourceId);
    if (!source) return;
    setSubmitting(true);
    try {
      const operation: HttpQueryOperation | JdbcQueryOperation =
        source.kind === "http"
          ? {
              method: draft.method,
              path: draft.path.trim(),
              query: parseRecord(draft.queryMap, "Query 映射") as Record<
                string,
                string
              >,
              ...(draft.method === "POST"
                ? { body: JSON.parse(draft.body || "{}") as unknown }
                : {}),
              rowsPointer: draft.rowsPointer.trim(),
              readOnly: true,
            }
          : {
              sql: draft.sql.trim(),
              readOnly: true,
            };
      const input: CreateRegisteredQueryRequest = {
        sourceId: source.id,
        name: draft.name.trim(),
        ...(draft.description.trim()
          ? { description: draft.description.trim() }
          : {}),
        operation,
        parameters: parseParameters(draft.parameters),
        sampleParameters: parseRecord(draft.samples, "示例参数"),
        public: draft.public,
        minRefreshIntervalMs: Number(draft.minRefreshIntervalMs),
      } as CreateRegisteredQueryRequest;
      const query = await api.registerQuery(input);
      setCreateOpen(false);
      await refresh();
      setSelectedId(query.id);
      notify("查询已经验证并注册", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "查询注册失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  function openExecute() {
    if (!selected) return;
    const defaults = Object.fromEntries(
      selected.parameters.map((parameter) => [
        parameter.name,
        parameter.type === "boolean"
          ? false
          : parameter.type === "integer" || parameter.type === "number"
            ? 0
            : "",
      ]),
    );
    setParameters(JSON.stringify(defaults, null, 2));
    setResult(undefined);
    setExecuteOpen(true);
  }

  async function execute(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    try {
      const value = await api.executeQuery(selected.id, {
        revision: selected.revision,
        parameters: parseRecord(parameters, "执行参数"),
      });
      setResult(value);
      notify(`查询返回 ${value.meta.rowCount} 行`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "查询执行失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="management-page">
      <header className="management-header">
        <div>
          <span className="module-icon">
            <Braces size={18} />
          </span>
          <div>
            <h1>注册查询</h1>
            <p>版本化、只读、可由看板安全复用的数据契约。</p>
          </div>
        </div>
        <Button
          tone="primary"
          onClick={openCreate}
          disabled={!sources.some((source) => source.status === "active")}
        >
          <Plus size={14} /> 注册查询
        </Button>
      </header>
      <div className="query-toolbar">
        <label className="management-search">
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索查询"
          />
        </label>
        <select
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value)}
        >
          <option value="">全部数据源</option>
          {sources.map((source) => (
            <option value={source.id} key={source.id}>
              {source.name}
            </option>
          ))}
        </select>
        <span>{visible.length} 个查询</span>
      </div>
      <div className="query-layout">
        <section className="query-grid">
          {loading ? (
            ["one", "two", "three", "four", "five", "six"].map((item) => (
              <article className="query-card" key={item}>
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </article>
            ))
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Table2 size={21} />}
              title={queries.length ? "没有匹配的查询" : "还没有注册查询"}
              description={
                queries.length
                  ? undefined
                  : "先启用数据源，再注册一个经过真实执行验证的只读查询。"
              }
            />
          ) : (
            visible.map((query) => {
              const source = sources.find((item) => item.id === query.sourceId);
              return (
                <button
                  type="button"
                  className={`query-card${query.id === selectedId ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(query.id)}
                  key={query.id}
                >
                  <header>
                    <span>
                      <Braces size={15} />
                    </span>
                    <StatusPill value={query.status} />
                  </header>
                  <h2>{query.name}</h2>
                  <p>
                    {query.description ||
                      ("sql" in query.operation
                        ? query.operation.sql
                        : `${query.operation.method} ${query.operation.path}`)}
                  </p>
                  <footer>
                    <span>{source?.name ?? shortId(query.sourceId)}</span>
                    <small>
                      r{query.revision} · {query.columns.length} 列
                    </small>
                  </footer>
                </button>
              );
            })
          )}
        </section>
        <aside className="query-detail">
          {!selected ? (
            <EmptyState title="选择一个查询" compact />
          ) : (
            <>
              <header>
                <div>
                  <span className="detail-hero-icon">
                    <Braces size={18} />
                  </span>
                  <div>
                    <h2>{selected.name}</h2>
                    <small>
                      {shortId(selected.id)} ·{" "}
                      {relativeTime(selected.createdAt)}
                    </small>
                  </div>
                </div>
                <Button tone="primary" size="compact" onClick={openExecute}>
                  <Play size={13} /> 执行
                </Button>
              </header>
              <div className="query-policy">
                <ShieldCheck size={15} />
                <span>
                  <strong>只读执行</strong>
                  <small>
                    {selected.public
                      ? "允许公开发布使用"
                      : "仅授权用户与 Agent"}{" "}
                    · 最短刷新 {formatDuration(selected.minRefreshIntervalMs)}
                  </small>
                </span>
              </div>
              <section>
                <h3>操作</h3>
                <pre className="operation-preview">
                  <code>
                    {"sql" in selected.operation
                      ? selected.operation.sql
                      : `${selected.operation.method} ${selected.operation.path}\nrows → ${selected.operation.rowsPointer || "/"}`}
                  </code>
                </pre>
              </section>
              <section>
                <h3>参数</h3>
                {selected.parameters.length ? (
                  <div className="definition-list">
                    {selected.parameters.map((parameter) => (
                      <div key={parameter.name}>
                        <code>{parameter.name}</code>
                        <span>{parameter.type}</span>
                        <small>{parameter.required ? "必填" : "可选"}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy">无参数</p>
                )}
              </section>
              <section>
                <h3>结果列</h3>
                <div className="definition-list">
                  {selected.columns.map((column) => (
                    <div key={column.name}>
                      <code>{column.name}</code>
                      <span>{column.type}</span>
                      <small>{column.nullable ? "可空" : "非空"}</small>
                    </div>
                  ))}
                </div>
              </section>
              <Button
                size="compact"
                tone="ghost"
                onClick={() => setRawOpen(true)}
              >
                查看完整契约
              </Button>
            </>
          )}
        </aside>
      </div>

      <FormDialog
        open={createOpen}
        title="注册只读查询"
        description="保存前会在服务端用示例参数执行并推断结果列。"
        submitLabel="验证并注册"
        submitting={submitting}
        onClose={() => setCreateOpen(false)}
        onSubmit={create}
        width={720}
      >
        <div className="form-grid two-columns">
          <Field label="数据源" required>
            <select
              value={draft.sourceId}
              onChange={(event) =>
                setDraft({ ...draft, sourceId: event.target.value })
              }
              required
            >
              <option value="">选择数据源</option>
              {sources
                .filter((source) => source.status === "active")
                .map((source) => (
                  <option value={source.id} key={source.id}>
                    {source.name} · {source.kind.toUpperCase()}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="名称" required>
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              required
            />
          </Field>
        </div>
        <Field label="说明">
          <input
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </Field>
        {selectedSource?.kind === "jdbc" ? (
          <Field label="只读 SQL" required>
            <textarea
              className="code-input"
              value={draft.sql}
              onChange={(event) =>
                setDraft({ ...draft, sql: event.target.value })
              }
              rows={8}
              required
              spellCheck={false}
            />
          </Field>
        ) : (
          <>
            <div className="form-grid query-operation-grid">
              <Field label="方法">
                <select
                  value={draft.method}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      method: event.target.value as QueryDraft["method"],
                    })
                  }
                >
                  <option>GET</option>
                  <option>POST</option>
                </select>
              </Field>
              <Field label="相对路径" required>
                <input
                  value={draft.path}
                  onChange={(event) =>
                    setDraft({ ...draft, path: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label="Rows Pointer">
                <input
                  value={draft.rowsPointer}
                  onChange={(event) =>
                    setDraft({ ...draft, rowsPointer: event.target.value })
                  }
                  placeholder="/data/items"
                />
              </Field>
            </div>
            <div className="form-grid two-columns">
              <Field label="URL 参数映射（JSON）">
                <textarea
                  className="code-input"
                  value={draft.queryMap}
                  onChange={(event) =>
                    setDraft({ ...draft, queryMap: event.target.value })
                  }
                  rows={4}
                  spellCheck={false}
                />
              </Field>
              {draft.method === "POST" ? (
                <Field label="固定 JSON Body">
                  <textarea
                    className="code-input"
                    value={draft.body}
                    onChange={(event) =>
                      setDraft({ ...draft, body: event.target.value })
                    }
                    rows={4}
                    spellCheck={false}
                  />
                </Field>
              ) : (
                <div />
              )}
            </div>
          </>
        )}
        <div className="form-grid two-columns">
          <Field
            label="参数定义（JSON）"
            hint='例如 [{"name":"region","type":"string","required":true}]'
          >
            <textarea
              className="code-input"
              value={draft.parameters}
              onChange={(event) =>
                setDraft({ ...draft, parameters: event.target.value })
              }
              rows={5}
              spellCheck={false}
            />
          </Field>
          <Field label="示例参数（JSON）" hint="注册时用于真实执行。">
            <textarea
              className="code-input"
              value={draft.samples}
              onChange={(event) =>
                setDraft({ ...draft, samples: event.target.value })
              }
              rows={5}
              spellCheck={false}
            />
          </Field>
        </div>
        <div className="form-grid two-columns">
          <Field label="最短刷新间隔（ms）">
            <input
              type="number"
              min="1000"
              max="3600000"
              value={draft.minRefreshIntervalMs}
              onChange={(event) =>
                setDraft({ ...draft, minRefreshIntervalMs: event.target.value })
              }
            />
          </Field>
          <Field label="公开策略">
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.public}
                onChange={(event) =>
                  setDraft({ ...draft, public: event.target.checked })
                }
              />{" "}
              允许公开分享页执行
            </label>
          </Field>
        </div>
      </FormDialog>

      <Dialog
        open={executeOpen}
        title={`执行 ${selected?.name ?? "查询"}`}
        description="执行使用当前不可变 Query Revision。"
        onClose={() => setExecuteOpen(false)}
        width={result ? 880 : 520}
      >
        <form className="dialog-form" onSubmit={execute}>
          {!result ? (
            <Field label="参数（JSON）">
              <textarea
                className="code-input"
                value={parameters}
                onChange={(event) => setParameters(event.target.value)}
                rows={8}
                spellCheck={false}
              />
            </Field>
          ) : (
            <div className="query-result">
              <div className="result-meta">
                <span>{result.meta.rowCount} 行</span>
                <span>{formatDuration(result.meta.durationMs)}</span>
                <span>{result.meta.cache.hit ? "缓存命中" : "实时获取"}</span>
                {result.meta.truncated && <span>已截断</span>}
              </div>
              <div className="result-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {result.meta.columns.map((column) => (
                        <th key={column.name}>{column.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 100).map((row) => (
                      <tr key={JSON.stringify(row)}>
                        {result.meta.columns.map((column) => (
                          <td key={column.name}>
                            {resultValue(row[column.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="dialog-inline-footer">
            <Button
              onClick={() =>
                result ? setResult(undefined) : setExecuteOpen(false)
              }
            >
              {result ? "修改参数" : "取消"}
            </Button>
            {!result && (
              <Button type="submit" tone="primary" loading={submitting}>
                <Play size={13} /> 执行查询
              </Button>
            )}
          </div>
        </form>
      </Dialog>
      <Dialog
        open={rawOpen}
        title="完整查询契约"
        onClose={() => setRawOpen(false)}
        footer={<Button onClick={() => setRawOpen(false)}>关闭</Button>}
        width={680}
      >
        <JsonView value={selected} />
      </Dialog>
    </main>
  );
}
