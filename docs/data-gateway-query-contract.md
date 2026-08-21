# Data Gateway and Data Source Contract

## 1. Goal

This contract defines how the platform describes data sources and safely makes their data available to Agent-generated dashboards. The Data Gateway is the runtime execution surface of the standalone Data Source Service defined in `docs/data-source-management-module.md`.

Core principle:

> The Data Gateway describes and serves data. The Coding Agent controls the dashboard.

The platform does not define dashboard components, controls, chart types, layouts, or interaction patterns. A Skill may guide the Coding Agent toward an attractive and usable result, but the generated source code remains fully controlled by the Coding Agent.

## 2. Separation of Responsibilities

### 2.1 Data Gateway

The Data Gateway is responsible only for:

- Registering and connecting to data sources.
- Describing available schemas and fields.
- Executing authorized read-only exploration queries.
- Saving Agent-authored queries as immutable revisions.
- Executing published queries with validated parameters.
- Serving current source data to one-time and automatically refreshed runtime queries.
- Enforcing credentials, permissions, refresh rates, timeouts, and result limits.
- Returning structured data, freshness metadata, and structured errors.
- Auditing data access.

### 2.2 Coding Agent

The Coding Agent controls:

- Every file under `src/**`.
- Component selection and implementation.
- Page layout and responsive behavior.
- Charts, tables, cards, controls, and navigation.
- Filters and how their values map to query parameters.
- Loading, empty, and error states.
- Data transformation in the browser.
- Cross-filtering, drill-downs, animations, and interactions.
- The SQL or other read-only query definitions used by the dashboard.

### 2.3 Dashboard Aesthetics Skill

The dashboard Skill may instruct the Coding Agent to produce:

- Clear information hierarchy.
- Consistent spacing and typography.
- Responsive layouts.
- Accessible colors and controls.
- Appropriate loading, empty, and failure states.
- Suitable visualizations for the available data.

These are design instructions, not a component schema. The Skill must not require a fixed grid, chart library, component tree, or visual DSL.

## 3. Explicit Non-Goals

The Data Gateway does not provide or define:

- Chart components.
- Table components.
- Filter components.
- Form controls.
- Dashboard grids.
- Component Props.
- Page templates.
- Visualization recommendations in its API response.
- A low-code dashboard schema.
- A component registry that the Agent must use.

The Data Gateway must never return fields such as `recommendedChart`, `componentType`, `gridPosition`, or `controlType`. It describes data, not presentation.

## 4. Data Source Model

A data source is a server-side connection that belongs to a tenant and is available only to explicitly authorized dashboards and users.

```ts
interface DataSource {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  kind: "http" | "jdbc";
  status: "draft" | "active" | "disabled" | "deleted";
  health: "unknown" | "healthy" | "degraded" | "unreachable";
  schemaRevision: number;
}
```

The first implementation supports HTTP JSON sources and JDBC sources. JDBC runs through the isolated JVM connector boundary defined in `docs/data-source-management-module.md`.

Credentials are not part of this object. They remain in the server-side credential store and are never returned to the Agent, dashboard source, browser, or Manifest.

## 5. Data Source Description

The Agent needs an accurate description of the data source so it can decide what to build. The description is factual and contains no UI instructions.

```ts
interface DataSourceDescription {
  id: string;
  name: string;
  description?: string;
  kind: "http" | "jdbc";
  schemaRevision: number;
  runtime: DataSourceRuntimeCapabilities;
  entities: DataEntity[];
}

interface DataSourceRuntimeCapabilities {
  live: boolean;
  modes: Array<"query" | "poll">;
  minRefreshIntervalMs: number;
}

interface DataEntity {
  name: string;
  description?: string;
  fields: DataField[];
  relationships: DataRelationship[];
}

interface DataField {
  name: string;
  type: DataType;
  nullable: boolean;
  description?: string;
}

type DataType =
  | "string"
  | "integer"
  | "number"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "json";

interface DataRelationship {
  fromField: string;
  toEntity: string;
  toField: string;
  cardinality?: "one" | "many";
}
```

The description may include database comments maintained by the data owner. It must not include credentials, hidden schemas, unauthorized tables, or UI recommendations.

Sample values are not included by default. The Agent may request samples through an authorized exploration query when needed.

## 6. Data Source Discovery

The Agent-facing operations are:

```text
list_data_sources
  List data sources available to the current tenant, user, and dashboard.

describe_data_source
  Return the authorized schema description for one data source.

query_data_source
  Run a temporary, read-only exploration query authored by the Agent.

register_query
  Save a tested Agent-authored query as an immutable query revision.

test_query
  Execute a registered query revision with example parameters.
```

These operations expose data capabilities without prescribing what the dashboard must render.

## 7. Design-Time Exploration

The Coding Agent may define a bounded HTTP request or read-only JDBC SQL operation to understand the source and validate an idea before creating a published query.

```ts
interface ExploreQueryRequest {
  sourceId: string;
  operation: HttpOperation | JdbcSqlOperation;
  parameters?: Record<string, QueryParameterValue>;
}
```

All exploration operations must:

- Use typed, bound parameters instead of string interpolation.
- Have a finite timeout.
- Have finite row and response-size limits.
- Be scoped to the authorized source configuration.
- Be recorded in the audit log.

JDBC exploration additionally uses a read-only account and transaction, accepts one SQL statement, and rejects DDL and DML. HTTP exploration uses an approved host, method, path, headers, and response extractor and is protected against SSRF.

The Data Source Service validates safety but does not author or optimize the operation on behalf of the Coding Agent.

## 8. Registered Query Model

A published dashboard never sends raw SQL. The Coding Agent first registers its tested query.

```ts
interface QueryDefinition {
  id: string;
  revision: number;
  tenantId: string;
  sourceId: string;
  sourceConfigRevision: number;
  name: string;
  description?: string;
  operation: HttpOperation | JdbcSqlOperation;
  parameters: QueryParameterDefinition[];
  result: QueryResultSchema;
  runtimePolicy: QueryRuntimePolicy;
  status: "validated" | "active" | "retired";
}

interface QueryParameterDefinition {
  name: string;
  type: QueryParameterType;
  required: boolean;
  description?: string;
}

type QueryParameterType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "date"
  | "datetime";

interface QueryResultSchema {
  columns: QueryResultColumn[];
}

interface QueryResultColumn {
  name: string;
  type: DataType;
  nullable: boolean;
}

interface QueryRuntimePolicy {
  live: boolean;
  supportsPolling: boolean;
  minRefreshIntervalMs: number;
  defaultCacheTtlMs: number;
  maxExecutionTimeMs: number;
  maxRows: number;
  maxResponseBytes: number;
}
```

The Coding Agent owns the HTTP or JDBC query operation, name, description, and public parameters. The standalone Data Source Service owns validation, authorization, execution limits, credentials, and revision persistence.

The result schema is inferred from a successful validation query when possible. It describes returned data and does not imply a visualization.

## 9. Query Revisions

Registered query revisions are immutable.

```text
Agent changes query
  → validate new statement
  → create new revision
  → test new revision
  → bind dashboard revision to new query revision
```

Editing a query never changes the behavior of an already published dashboard. Existing Published Revisions remain bound to the query revisions they were validated against.

The dashboard Manifest should declare the logical query name and pinned revision:

```json
{
  "queries": [
    {
      "id": "monthly-sales",
      "revision": 3,
      "parameters": {
        "startDate": "date",
        "endDate": "date"
      }
    }
  ]
}
```

The dashboard source continues to use the logical name:

```ts
const result = await dashboard.query("monthly-sales", {
  startDate,
  endDate
});
```

The Runtime resolves the logical name through the current dashboard revision's validated binding.

## 10. Runtime Query Contract

The generated dashboard calls the stable Runtime API for a one-time query or creates a polling watcher:

```ts
const result = await dashboard.query<T>(queryId, parameters);

const watcher = dashboard.watch<T>(
  queryId,
  () => parameters,
  { intervalMs: 30_000, pauseWhenHidden: true },
  handleQueryEvent
);
```

The complete watcher behavior is defined in `docs/live-data-and-refresh-contract.md`.

Conceptual gateway request:

```ts
interface RuntimeQueryRequest {
  dashboardRevisionId: string;
  queryId: string;
  parameters: Record<string, QueryParameterValue>;
  freshness: "allow-cache" | "live";
  refreshReason: "initial" | "interval" | "focus" | "manual" | "parameters";
}

type QueryParameterValue = string | number | boolean | null;
```

The browser does not submit:

- SQL.
- A data-source ID.
- A query revision chosen by the viewer.
- Tenant or user identifiers.
- Database credentials.

The server derives the dashboard, query revision, tenant, viewer, and permission context from trusted publication metadata and authentication state.

## 11. Runtime Result Contract

The gateway returns ordinary structured data that `src/` can use freely.

```ts
interface QueryResult<T extends Record<string, unknown> = Record<string, unknown>> {
  rows: T[];
  meta: {
    columns: QueryResultColumn[];
    rowCount: number;
    truncated: boolean;
    durationMs: number;
    fetchedAt: string;
    sourceUpdatedAt?: string;
    cache: {
      hit: boolean;
      storedAt?: string;
      expiresAt?: string;
    };
  };
}
```

Example:

```json
{
  "rows": [
    {
      "month": "2026-01-01",
      "revenue": 125000
    }
  ],
  "meta": {
    "columns": [
      { "name": "month", "type": "date", "nullable": false },
      { "name": "revenue", "type": "number", "nullable": false }
    ],
    "rowCount": 1,
    "truncated": false,
    "durationMs": 24,
    "fetchedAt": "2026-08-21T12:00:00Z",
    "sourceUpdatedAt": "2026-08-21T11:59:52Z",
    "cache": {
      "hit": false
    }
  }
}
```

Serialization rules:

- Dates use ISO 8601 strings.
- Datetimes use ISO 8601 strings with timezone information.
- Decimal values use strings when conversion to a JavaScript number could lose precision.
- SQL `NULL` becomes JSON `null`.
- Column order follows the query result.

The Agent decides whether the result becomes a chart, table, KPI, custom Canvas rendering, filter source, or any other interface. `sourceUpdatedAt` is omitted when the source cannot provide it accurately.

## 12. Parameters and Controls

The gateway defines query parameter names and data types only. It does not define controls.

For example, this parameter definition:

```json
{
  "name": "startDate",
  "type": "date",
  "required": true
}
```

may be represented by the Coding Agent as:

- A date input.
- A date-range picker.
- A preset such as "Last 30 days".
- A URL parameter.
- A hidden default.
- A custom timeline interaction.

That decision belongs entirely to the Coding Agent and `src/`.

Parameter values must be bound by the Data Source Service. They must never be interpolated into SQL, URLs, headers, or bodies by the browser or Agent-generated runtime code.

## 13. Trusted Context Parameters

Tenant, viewer, and authorization values are not public query parameters.

The gateway may inject trusted context parameters such as:

```text
current_tenant_id
current_user_id
current_user_roles
share_principal_id
```

These values come from authenticated server context. The browser cannot provide or override them.

This enables row-level access without adding tenant selectors or permission controls to the generated dashboard.

## 14. Authorization

Every operation must validate:

1. The authenticated principal belongs to the tenant.
2. The principal may access the data source.
3. The dashboard may use the registered query.
4. The published dashboard revision is bound to the requested query revision.
5. The viewer may execute the query in the current sharing mode.
6. Trusted row-level context is applied when required.

Authenticated Publications use live data by default. Anonymous sharing may use only:

- Queries explicitly approved for public live execution; or
- An explicitly selected and clearly labeled snapshot.

An anonymous viewer never inherits the creator's credentials or permissions. Snapshot mode is an alternative, not the default definition of a published Dashboard.

## 15. Reliability and Limits

Every data source connector must support:

- Connection testing during registration.
- A health status that does not expose credentials.
- Schema refresh with a new `schemaRevision`.
- Query cancellation when the request is aborted.
- A finite connection timeout.
- A finite statement timeout.
- A finite row limit.
- A finite response-size limit.
- An enforced minimum refresh interval.
- Authorization on every automatic or manual refresh.
- No overlapping execution for one runtime watcher.
- Structured freshness and error responses.

Limits are platform policy and may vary by environment. They must not be controlled by browser input or Agent-generated source.

When a result is truncated, the response must set `meta.truncated` to `true`. The Coding Agent should respond by aggregating or narrowing the query rather than assuming the data is complete.

Runtime caching, when enabled, must use a finite TTL and a cache key that includes tenant, viewer authorization scope, Query Revision, normalized parameters, and trusted row-level context. Refresh requests cannot bypass server policy.

## 16. Error Contract

Errors are structured so the Coding Agent can diagnose and fix data access without guessing.

```ts
interface DataGatewayError {
  code:
    | "SOURCE_NOT_FOUND"
    | "SOURCE_DISABLED"
    | "SOURCE_DELETED"
    | "SOURCE_UNAVAILABLE"
    | "CONNECTOR_UNAVAILABLE"
    | "FORBIDDEN"
    | "QUERY_INVALID"
    | "QUERY_NOT_FOUND"
    | "QUERY_REVISION_MISMATCH"
    | "PARAMETER_INVALID"
    | "TIMEOUT"
    | "RESULT_LIMIT_EXCEEDED"
    | "EXECUTION_FAILED";
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

Error details must be sanitized. They must not expose credentials, connection strings, hidden schema names, or full internal stack traces.

## 17. Audit Contract

The gateway records:

- Tenant and principal.
- Dashboard and dashboard revision.
- Data source ID.
- Query ID and revision.
- Design-time or runtime execution mode.
- Start time and duration.
- Success or sanitized error code.
- Returned row count and truncation status.

Parameter values should be omitted or redacted when they may contain sensitive data.

Audit records describe data access only. They do not inspect or classify dashboard components.

## 18. Data Source and Query Lifecycles

Data source lifecycle:

```text
active → disabled
   │
   └→ unavailable → active
```

- **active**: New queries may be explored, registered, and executed.
- **disabled**: Access is intentionally blocked by an administrator.
- **unavailable**: The connector is temporarily unhealthy.

Query lifecycle:

```text
validated → active → retired
```

- **validated**: The statement and result schema passed validation.
- **active**: New dashboard revisions may bind to it.
- **retired**: New bindings are blocked; existing published bindings follow the platform retention policy.

No lifecycle state controls dashboard components or presentation.

## 19. First-Version Scope

The first version includes:

- HTTP JSON Data Sources with bounded GET and approved read-only POST operations.
- JDBC Data Sources with parameterized read-only SQL through an isolated JVM Runner.
- Agent-authored exploration queries.
- Agent-authored registered queries.
- Immutable query revisions.
- Typed parameters.
- Tabular JSON results.
- Authenticated live runtime execution.
- Polling-based automatic refresh through the Dashboard Runtime.
- Minimum refresh intervals, cancellation, and freshness metadata.
- Explicitly approved public-live queries or clearly labeled snapshots for anonymous sharing.
- Structured errors and audit records.

The first version does not include:

- Cross-source joins.
- Arbitrary browser SQL.
- Write-back queries.
- Automatic chart or component selection in the Data Gateway.
- A semantic modeling DSL.
- A visual query builder.
- Automatic query optimization.
- Spreadsheet or file connectors.
- User-uploaded JDBC driver JARs.

## 20. Acceptance Criteria

The contract is satisfied when:

1. The Agent can list and accurately describe authorized HTTP and JDBC sources.
2. Source descriptions contain data facts and no UI component instructions.
3. The Agent can explore the source with safe read-only SQL.
4. The Agent can register and test its own query.
5. Publishing pins an immutable query revision.
6. A published dashboard executes only its authorized query bindings.
7. A published dashboard receives current source data without invoking Pi or rebuilding its frontend bundle.
8. Automatic refresh repeats authorization and respects the enforced minimum interval.
9. The browser receives no SQL or data-source credentials.
10. Query parameters are validated and bound safely.
11. Tenant and viewer context cannot be overridden by the browser.
12. Source failures return structured, sanitized errors and preserve freshness context.
13. `src/` may render the same result using any components or interactions.
14. Changing a filter, chart, layout, or component requires only Coding Agent changes to `src/`, not changes to the Data Gateway contract.
15. A dashboard aesthetics Skill may guide quality without imposing a component schema.

## 21. Next Design

The standalone Data Source management, connector, CRUD, and module boundary is defined in `docs/data-source-management-module.md`.

The Pi Agent Tool Contract implements:

- `list_data_sources`.
- `describe_data_source`.
- `query_data_source`.
- `register_query`.
- `test_query`.
- `validate_dashboard`.
- `build_preview`.
- `publish_dashboard`.

Those Tools must expose the capabilities defined here without taking control of dashboard components away from the Coding Agent. Runtime saving and refresh behavior is defined in `docs/live-data-and-refresh-contract.md`; automatic refresh never invokes an Agent Tool.
