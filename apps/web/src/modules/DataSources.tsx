import type {
  CreateDataSourceRequest,
  DataEntity,
  DataSource,
  DataSourceDescription,
  HttpDataSourceConfig,
  JdbcDataSourceConfig,
  UpdateDataSourceRequest,
} from "@mda/contracts";
import {
  Activity,
  Cable,
  CheckCircle2,
  Database,
  FileJson2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Button,
  ConfirmDialog,
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
import { relativeTime, shortId } from "../lib/format.ts";

interface SourceDraft {
  name: string;
  description: string;
  kind: "http" | "jdbc";
  baseUrl: string;
  allowPrivateNetwork: boolean;
  authType: "none" | "bearer";
  bearerSecretRef: string;
  jdbcUrl: string;
  usernameRef: string;
  passwordRef: string;
  timeoutMs: string;
  statementTimeoutMs: string;
  maxRows: string;
  maxResponseBytes: string;
  entities: string;
}

const emptyDraft: SourceDraft = {
  name: "",
  description: "",
  kind: "http",
  baseUrl: "",
  allowPrivateNetwork: false,
  authType: "none",
  bearerSecretRef: "",
  jdbcUrl: "jdbc:postgresql://",
  usernameRef: "",
  passwordRef: "",
  timeoutMs: "5000",
  statementTimeoutMs: "30000",
  maxRows: "1000",
  maxResponseBytes: "1048576",
  entities: "[]",
};

function numberField(value: string, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function parseEntities(value: string): DataEntity[] {
  const parsed: unknown = JSON.parse(value || "[]");
  if (!Array.isArray(parsed)) throw new Error("实体定义必须是 JSON 数组");
  return parsed as DataEntity[];
}

function configFromDraft(
  draft: SourceDraft,
): HttpDataSourceConfig | JdbcDataSourceConfig {
  if (draft.kind === "http") {
    return {
      baseUrl: draft.baseUrl.trim(),
      ...(draft.allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
      auth:
        draft.authType === "bearer"
          ? { type: "bearer", secretRef: draft.bearerSecretRef.trim() }
          : { type: "none" },
      timeoutMs: numberField(draft.timeoutMs, 5_000),
      maxResponseBytes: numberField(draft.maxResponseBytes, 1_048_576),
    };
  }
  return {
    driverId: "postgresql",
    jdbcUrl: draft.jdbcUrl.trim(),
    usernameRef: draft.usernameRef.trim(),
    passwordRef: draft.passwordRef.trim(),
    connectionTimeoutMs: numberField(draft.timeoutMs, 5_000),
    statementTimeoutMs: numberField(draft.statementTimeoutMs, 30_000),
    maxRows: numberField(draft.maxRows, 1_000),
  };
}

function SourceFormFields({
  draft,
  setDraft,
  includeIdentity = true,
}: {
  draft: SourceDraft;
  setDraft(value: SourceDraft): void;
  includeIdentity?: boolean;
}) {
  const update = <K extends keyof SourceDraft>(key: K, value: SourceDraft[K]) =>
    setDraft({ ...draft, [key]: value });
  return (
    <>
      {includeIdentity && (
        <div className="form-grid two-columns">
          <Field label="名称" required>
            <input
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
              required
              maxLength={200}
            />
          </Field>
          <Field label="类型" required>
            <select
              value={draft.kind}
              onChange={(event) =>
                update("kind", event.target.value as SourceDraft["kind"])
              }
            >
              <option value="http">HTTP JSON</option>
              <option value="jdbc">JDBC · PostgreSQL</option>
            </select>
          </Field>
        </div>
      )}
      <Field label="说明">
        <textarea
          value={draft.description}
          onChange={(event) => update("description", event.target.value)}
          rows={2}
          maxLength={2_000}
        />
      </Field>
      {draft.kind === "http" ? (
        <>
          <Field
            label="Base URL"
            required
            hint="默认要求 HTTPS；内网测试需显式允许私有网络。"
          >
            <input
              type="url"
              value={draft.baseUrl}
              onChange={(event) => update("baseUrl", event.target.value)}
              placeholder="https://api.example.com/"
              required
            />
          </Field>
          <div className="form-grid two-columns">
            <Field label="认证方式">
              <select
                value={draft.authType}
                onChange={(event) =>
                  update(
                    "authType",
                    event.target.value as SourceDraft["authType"],
                  )
                }
              >
                <option value="none">无认证</option>
                <option value="bearer">Bearer Secret Ref</option>
              </select>
            </Field>
            {draft.authType === "bearer" ? (
              <Field label="Secret Ref" required>
                <input
                  value={draft.bearerSecretRef}
                  onChange={(event) =>
                    update("bearerSecretRef", event.target.value)
                  }
                  placeholder="http_api_token"
                  required
                />
              </Field>
            ) : (
              <div />
            )}
          </div>
          <Field label="网络策略">
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.allowPrivateNetwork}
                onChange={(event) =>
                  update("allowPrivateNetwork", event.target.checked)
                }
              />
              允许访问私有网络
            </label>
          </Field>
          <div className="form-grid two-columns">
            <Field label="超时（ms）">
              <input
                type="number"
                min="100"
                max="30000"
                value={draft.timeoutMs}
                onChange={(event) => update("timeoutMs", event.target.value)}
              />
            </Field>
            <Field label="响应上限（bytes）">
              <input
                type="number"
                min="1024"
                max="10485760"
                value={draft.maxResponseBytes}
                onChange={(event) =>
                  update("maxResponseBytes", event.target.value)
                }
              />
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field
            label="JDBC URL"
            required
            hint="仅支持 allowlist 中的 PostgreSQL JDBC 驱动。"
          >
            <input
              value={draft.jdbcUrl}
              onChange={(event) => update("jdbcUrl", event.target.value)}
              required
            />
          </Field>
          <div className="form-grid two-columns">
            <Field label="Username Secret Ref" required>
              <input
                value={draft.usernameRef}
                onChange={(event) => update("usernameRef", event.target.value)}
                required
              />
            </Field>
            <Field label="Password Secret Ref" required>
              <input
                value={draft.passwordRef}
                onChange={(event) => update("passwordRef", event.target.value)}
                required
              />
            </Field>
          </div>
          <div className="form-grid three-columns">
            <Field label="连接超时（ms）">
              <input
                type="number"
                min="100"
                max="30000"
                value={draft.timeoutMs}
                onChange={(event) => update("timeoutMs", event.target.value)}
              />
            </Field>
            <Field label="查询超时（ms）">
              <input
                type="number"
                min="100"
                max="60000"
                value={draft.statementTimeoutMs}
                onChange={(event) =>
                  update("statementTimeoutMs", event.target.value)
                }
              />
            </Field>
            <Field label="最大行数">
              <input
                type="number"
                min="1"
                max="10000"
                value={draft.maxRows}
                onChange={(event) => update("maxRows", event.target.value)}
              />
            </Field>
          </div>
        </>
      )}
      <Field
        label="声明实体（JSON）"
        hint="HTTP 源可以在这里提供字段说明；JDBC 刷新时会读取数据库结构。"
      >
        <textarea
          className="code-input"
          value={draft.entities}
          onChange={(event) => update("entities", event.target.value)}
          rows={6}
          spellCheck={false}
        />
      </Field>
    </>
  );
}

export function DataSourcesModule({ api }: { api: ApiClient }) {
  const { notify } = useToast();
  const [sources, setSources] = useState<DataSource[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [description, setDescription] = useState<DataSourceDescription>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [result, setResult] = useState<unknown>();
  const [confirmAction, setConfirmAction] = useState<
    "disable" | "delete" | "restore"
  >();
  const [draft, setDraft] = useState<SourceDraft>(emptyDraft);
  const [rename, setRename] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selected = sources.find((source) => source.id === selectedId);
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle
      ? sources.filter((source) =>
          `${source.name} ${source.kind} ${source.status}`
            .toLocaleLowerCase()
            .includes(needle),
        )
      : sources;
  }, [search, sources]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api.dataSources();
      setSources(items);
      setSelectedId((current) =>
        current && items.some((source) => source.id === current)
          ? current
          : items[0]?.id,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "无法读取数据源",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [api, notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDescription(undefined);
      return;
    }
    let disposed = false;
    setDetailLoading(true);
    void api
      .describeDataSource(selectedId)
      .then((value) => {
        if (!disposed) setDescription(value);
      })
      .catch(() => {
        if (!disposed) setDescription(undefined);
      })
      .finally(() => {
        if (!disposed) setDetailLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [api, selectedId]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const input: CreateDataSourceRequest = {
        name: draft.name.trim(),
        ...(draft.description.trim()
          ? { description: draft.description.trim() }
          : {}),
        kind: draft.kind,
        config: configFromDraft(draft),
        entities: parseEntities(draft.entities),
      } as CreateDataSourceRequest;
      const source = await api.createDataSource(input);
      setCreateOpen(false);
      setDraft(emptyDraft);
      await refresh();
      setSelectedId(source.id);
      notify("数据源草稿已创建", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "数据源创建失败",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReplacement(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    try {
      const input: UpdateDataSourceRequest = {
        description: draft.description.trim(),
        config: configFromDraft(draft),
        entities: parseEntities(draft.entities),
        expectedVersion: selected.version,
      } as UpdateDataSourceRequest;
      await api.updateDataSource(selected.id, input);
      setReplaceOpen(false);
      await refresh();
      notify("新的连接配置已保存为待测试版本", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "配置更新失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    try {
      await api.renameDataSource(selected.id, rename, selected.version);
      setRenameOpen(false);
      await refresh();
      notify("数据源名称已更新", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "重命名失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function action(label: string, operation: () => Promise<unknown>) {
    setSubmitting(true);
    try {
      const value = await operation();
      setResult(value);
      await refresh();
      if (selectedId) {
        try {
          setDescription(await api.describeDataSource(selectedId));
        } catch {
          setDescription(undefined);
        }
      }
      notify(`${label}已完成`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : `${label}失败`, "error");
    } finally {
      setSubmitting(false);
      setConfirmAction(undefined);
    }
  }

  return (
    <main className="management-page">
      <header className="management-header">
        <div>
          <span className="module-icon">
            <Database size={18} />
          </span>
          <div>
            <h1>数据源</h1>
            <p>管理安全的服务端连接、结构与健康状态。</p>
          </div>
        </div>
        <Button
          tone="primary"
          onClick={() => {
            setDraft(emptyDraft);
            setCreateOpen(true);
          }}
        >
          <Plus size={14} /> 新建数据源
        </Button>
      </header>
      <div className="management-layout">
        <section className="management-list-panel">
          <label className="management-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索数据源"
            />
          </label>
          <div className="management-list">
            {loading ? (
              ["one", "two", "three", "four", "five"].map((item) => (
                <div className="management-row skeleton-row" key={item}>
                  <Skeleton />
                  <Skeleton />
                </div>
              ))
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<Cable size={20} />}
                title={sources.length ? "没有匹配的数据源" : "还没有数据源"}
                description={
                  sources.length
                    ? undefined
                    : "创建 HTTP 或 JDBC 连接后，Agent 才能安全读取真实数据。"
                }
                compact
              />
            ) : (
              visible.map((source) => (
                <button
                  type="button"
                  className={`management-row${source.id === selectedId ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(source.id)}
                  key={source.id}
                >
                  <span className="source-kind-icon">
                    {source.kind === "jdbc" ? (
                      <Database size={15} />
                    ) : (
                      <Cable size={15} />
                    )}
                  </span>
                  <span>
                    <strong>{source.name}</strong>
                    <small>
                      {source.kind.toUpperCase()} · {shortId(source.id)}
                    </small>
                  </span>
                  <StatusPill
                    value={
                      source.status === "active" ? source.health : source.status
                    }
                  />
                </button>
              ))
            )}
          </div>
        </section>

        <section className="management-detail-panel">
          {!selected ? (
            <EmptyState
              title="选择一个数据源"
              description="连接详情、Schema 和操作会显示在这里。"
            />
          ) : (
            <>
              <div className="detail-hero">
                <span className="detail-hero-icon">
                  {selected.kind === "jdbc" ? (
                    <Database size={21} />
                  ) : (
                    <Cable size={21} />
                  )}
                </span>
                <div>
                  <div className="detail-title-line">
                    <h2>{selected.name}</h2>
                    <StatusPill value={selected.status} />
                    <StatusPill value={selected.health} />
                  </div>
                  <p>{selected.description || "暂无说明"}</p>
                </div>
                <div className="detail-actions">
                  <Button
                    size="compact"
                    onClick={() =>
                      void action("连接测试", () =>
                        api.testDataSource(selected.id),
                      )
                    }
                    loading={submitting}
                  >
                    <Activity size={13} /> 测试
                  </Button>
                  {selected.status !== "deleted" &&
                    (selected.status === "draft" ||
                      selected.health === "healthy") && (
                      <Button
                        size="compact"
                        tone="primary"
                        onClick={() =>
                          void action("配置激活", () =>
                            api.sourceAction(selected.id, "activate"),
                          )
                        }
                      >
                        <CheckCircle2 size={13} />{" "}
                        {selected.status === "active" ? "激活版本" : "激活"}
                      </Button>
                    )}
                  {selected.status === "disabled" && (
                    <Button
                      size="compact"
                      onClick={() =>
                        void action("启用", () =>
                          api.sourceAction(selected.id, "enable"),
                        )
                      }
                    >
                      <Power size={13} /> 启用
                    </Button>
                  )}
                  {selected.status === "active" && (
                    <Button
                      size="compact"
                      onClick={() => setConfirmAction("disable")}
                    >
                      <PowerOff size={13} /> 停用
                    </Button>
                  )}
                  {selected.status === "deleted" ? (
                    <Button
                      size="compact"
                      onClick={() => setConfirmAction("restore")}
                    >
                      <Undo2 size={13} /> 恢复
                    </Button>
                  ) : (
                    <Button
                      size="compact"
                      tone="ghost"
                      onClick={() => setConfirmAction("delete")}
                    >
                      <Trash2 size={13} /> 删除
                    </Button>
                  )}
                </div>
              </div>

              <div className="detail-stat-grid">
                <div>
                  <small>配置版本</small>
                  <strong>v{selected.configRevision}</strong>
                </div>
                <div>
                  <small>Schema 版本</small>
                  <strong>
                    {selected.schemaRevision
                      ? `v${selected.schemaRevision}`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <small>资源版本</small>
                  <strong>v{selected.version}</strong>
                </div>
                <div>
                  <small>最近更新</small>
                  <strong>{relativeTime(selected.updatedAt)}</strong>
                </div>
              </div>

              <div className="detail-section-head">
                <div>
                  <h3>连接与结构</h3>
                  <p>凭据只以 Secret Ref 留在数据源服务中。</p>
                </div>
                <div>
                  <Button
                    size="compact"
                    onClick={() => {
                      setRename(selected.name);
                      setRenameOpen(true);
                    }}
                  >
                    <Pencil size={13} /> 重命名
                  </Button>
                  <Button
                    size="compact"
                    onClick={() => {
                      setDraft({
                        ...emptyDraft,
                        kind: selected.kind,
                        name: selected.name,
                        description: selected.description ?? "",
                        entities: JSON.stringify(
                          description?.entities ?? [],
                          null,
                          2,
                        ),
                      });
                      setReplaceOpen(true);
                    }}
                  >
                    <RotateCw size={13} /> 更新连接
                  </Button>
                  <Button
                    size="compact"
                    onClick={() =>
                      void action("Schema 刷新", () =>
                        api.refreshSourceSchema(selected.id),
                      )
                    }
                  >
                    <RefreshCw size={13} /> 刷新 Schema
                  </Button>
                </div>
              </div>

              {detailLoading ? (
                <div className="schema-skeleton">
                  <Skeleton />
                  <Skeleton />
                  <Skeleton />
                </div>
              ) : description?.entities.length ? (
                <div className="entity-list">
                  {description.entities.map((entity) => (
                    <article className="entity-card" key={entity.name}>
                      <header>
                        <FileJson2 size={15} />
                        <strong>{entity.name}</strong>
                        <span>{entity.fields.length} 个字段</span>
                      </header>
                      {entity.description && <p>{entity.description}</p>}
                      <div className="field-table">
                        {entity.fields.map((field) => (
                          <div key={field.name}>
                            <code>{field.name}</code>
                            <span>{field.type}</span>
                            <small>{field.nullable ? "可空" : "必填"}</small>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="暂无结构信息"
                  description="激活并刷新 Schema 后，字段会显示在这里。"
                  compact
                />
              )}
            </>
          )}
        </section>
      </div>

      <FormDialog
        open={createOpen}
        title="新建数据源"
        description="连接先以草稿保存，通过测试后再激活。"
        submitLabel="创建草稿"
        submitting={submitting}
        onClose={() => setCreateOpen(false)}
        onSubmit={submitCreate}
        width={680}
      >
        <SourceFormFields draft={draft} setDraft={setDraft} />
      </FormDialog>
      <FormDialog
        open={replaceOpen}
        title="更新连接配置"
        description="新配置不会覆盖当前工作版本，直到测试并激活。"
        submitLabel="保存待测试版本"
        submitting={submitting}
        onClose={() => setReplaceOpen(false)}
        onSubmit={submitReplacement}
        width={680}
      >
        <SourceFormFields
          draft={draft}
          setDraft={setDraft}
          includeIdentity={false}
        />
      </FormDialog>
      <FormDialog
        open={renameOpen}
        title="重命名数据源"
        submitLabel="更新名称"
        submitting={submitting}
        onClose={() => setRenameOpen(false)}
        onSubmit={submitRename}
      >
        <Field label="名称" required>
          <input
            value={rename}
            onChange={(event) => setRename(event.target.value)}
            required
          />
        </Field>
      </FormDialog>
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={
          confirmAction === "delete"
            ? "删除数据源"
            : confirmAction === "disable"
              ? "停用数据源"
              : "恢复数据源"
        }
        description={
          confirmAction === "delete"
            ? "删除为软删除；新查询会被阻止，审计记录会保留。"
            : confirmAction === "disable"
              ? "停用后，Agent 与已发布看板不能执行新的查询。"
              : "恢复后数据源保持停用，需要再次检查并启用。"
        }
        confirmLabel={
          confirmAction === "delete"
            ? "删除"
            : confirmAction === "disable"
              ? "停用"
              : "恢复"
        }
        danger={confirmAction !== "restore"}
        submitting={submitting}
        onClose={() => setConfirmAction(undefined)}
        onConfirm={() => {
          if (selected && confirmAction)
            void action(
              confirmAction === "delete"
                ? "删除"
                : confirmAction === "disable"
                  ? "停用"
                  : "恢复",
              () => api.sourceAction(selected.id, confirmAction),
            );
        }}
      />
      <Dialog
        open={result !== undefined}
        title="操作结果"
        onClose={() => setResult(undefined)}
        footer={<Button onClick={() => setResult(undefined)}>关闭</Button>}
      >
        <JsonView value={result} />
      </Dialog>
    </main>
  );
}
