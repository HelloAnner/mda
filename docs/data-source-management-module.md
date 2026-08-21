# Data Source Management Module

## 1. Decision

MDA provides Data Source management as a standalone module and deployable service.

The module supports:

- Listing Data Sources.
- Creating Data Sources.
- Showing and describing a Data Source.
- Renaming a Data Source.
- Editing connection and request configuration.
- Testing configuration before activation.
- Enabling and disabling access.
- Soft deletion and controlled purge.
- Schema refresh and health inspection.
- HTTP-based data retrieval.
- JDBC-based SQL data retrieval.
- Agent-authored, immutable Query Revisions.
- Live runtime execution and automatic refresh support.

Core principle:

> The Data Source module owns connections, queries, and safe data execution. It does not own dashboards or presentation.

All UI components, controls, layouts, and visual behavior remain under the Coding Agent's control.

## 2. Standalone Module Boundary

The module is deployed as the independent `mda-datasource` image from:

```text
apps/data-source-service/
```

Its Docker Compose placement, networks, PostgreSQL ownership, Redis use, and JDBC sidecar are defined in `docs/docker-compose-deployment-architecture.md`. Its aggregate, transaction, event, and code-module boundaries are defined in `docs/domain-driven-design-structure.md`.

It owns:

- Data Source metadata.
- Connector configuration revisions.
- Secret references.
- Source Schema Revisions.
- Query Definitions and Query Revisions.
- Connector health.
- Query execution.
- Runtime policy.
- Source audit records.
- Durable source events.

It does not own:

- Dashboard source code.
- Dashboard Revisions.
- Publications.
- Share Links.
- Pi Sessions or Agent Jobs.
- Dashboard components.
- Preview rendering.
- User-facing page layout.

The Control Plane communicates with the Data Source Service through versioned internal HTTP contracts. It never imports the service's database or connector implementation.

## 3. JDBC and the TypeScript/Bun Boundary

JDBC is a Java API and requires a JVM. Bun cannot truthfully implement or load arbitrary JDBC drivers directly.

MDA therefore uses this boundary:

```text
TypeScript/Bun Data Source Service
  → versioned internal connector protocol
  → isolated JVM JDBC Runner
  → allowlisted JDBC driver
  → database
```

The core MDA application, management logic, API, and connector orchestration remain TypeScript/Bun. The JDBC Runner is an isolated connector runtime required only for JDBC interoperability.

If a deployment requires a strict no-JVM policy, it must use Bun-native database wire-protocol connectors and must not advertise those connectors as JDBC.

The JDBC Runner must not be embedded in the Control Plane or Agent Runner.

## 4. Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Clients                                                      │
│ Web UI / mda CLI / Agent Tools                               │
└───────────────────────┬──────────────────────────────────────┘
                        │ Control Plane API
┌───────────────────────▼──────────────────────────────────────┐
│ Control Plane                                                │
│ Auth, tenant context, Dashboard and Query Binding validation │
└───────────────────────┬──────────────────────────────────────┘
                        │ signed internal HTTP
┌───────────────────────▼──────────────────────────────────────┐
│ Bun Data Source Service                                      │
│ CRUD, schema, queries, policy, execution, audit, events      │
└──────────────┬───────────────────────────┬───────────────────┘
               │                           │
       HTTP Connector Client          JDBC Connector Client
               │                           │ internal protocol
               │                    ┌──────▼───────────────┐
               │                    │ Isolated JVM Runner  │
               │                    │ JDBC driver/pool     │
               │                    └──────┬───────────────┘
               │                           │
         Remote HTTP API               SQL Database
```

The browser and generated Dashboard never call connectors directly.

## 5. Decoupling Rules

### 5.1 No Shared Tables

The Control Plane and Data Source Service may use the same PostgreSQL cluster initially, but they must use separately owned databases or schemas.

Rules:

- The Control Plane never reads or writes Data Source Service tables.
- The Data Source Service never reads or writes Control Plane tables.
- No cross-module database foreign keys.
- Each module owns its migrations.
- Cross-module identifiers are validated through APIs.

### 5.2 Shared Contracts Only

Modules may share TypeBox request, response, event, and error schemas through:

```text
packages/contracts/
```

They must not share:

- Database clients.
- SQL functions.
- Secret access implementations.
- Connector instances.
- Domain service classes.
- Mutable in-process state.

### 5.3 API Communication

All synchronous communication uses versioned HTTP APIs.

All mutating requests support:

- Idempotency keys.
- Optimistic version checks.
- Request IDs.
- Tenant context.
- Service authentication.
- Structured errors.

### 5.4 Durable Events

The Data Source Service publishes durable events through its own PostgreSQL outbox and internal cursor API, with Redis used for wake-up notifications and cache invalidation. Redis is not event history, and no additional broker is required initially.

The Control Plane may consume events for display, cache invalidation, and dependency warnings, but correctness must not depend on receiving a Redis notification instantly.

## 6. Connector Interface

Multiple connector implementations justify one explicit interface:

```ts
interface DataSourceConnector<TConfig> {
  type: "http" | "jdbc";

  validateConfig(config: unknown): TConfig;

  testConnection(
    config: TConfig,
    secrets: ResolvedSecrets,
    signal: AbortSignal,
  ): Promise<ConnectionTestResult>;

  describe(
    config: TConfig,
    secrets: ResolvedSecrets,
    signal: AbortSignal,
  ): Promise<ConnectorSchema>;

  execute(
    config: TConfig,
    secrets: ResolvedSecrets,
    operation: ConnectorOperation,
    parameters: QueryParameters,
    policy: ExecutionPolicy,
    signal: AbortSignal,
  ): Promise<ConnectorResult>;

  close?(): Promise<void>;
}
```

The Connector interface returns data and metadata only. It never returns component or visualization recommendations.

## 7. Data Source Model

```ts
type DataSourceType = "http" | "jdbc";

type DataSourceStatus =
  | "draft"
  | "active"
  | "disabled"
  | "deleted";

type DataSourceHealth =
  | "unknown"
  | "healthy"
  | "degraded"
  | "unreachable";

interface DataSource {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  type: DataSourceType;
  status: DataSourceStatus;
  health: DataSourceHealth;
  activeConfigRevision?: number;
  schemaRevision?: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
```

Rules:

- `id` is immutable.
- `name` is unique within one tenant after normalization.
- Renaming never changes `id` or breaks Query Bindings.
- Connection configuration is revisioned.
- Health is separate from administrative status.
- Deletion is soft during the retention window.

## 8. Configuration Revisions

Connection edits must not replace a working configuration before the new configuration is tested.

```text
active config revision
  → create draft config revision
  → validate
  → test connection
  → optionally refresh schema
  → atomically activate
```

```ts
interface DataSourceConfigRevision {
  sourceId: string;
  revision: number;
  type: DataSourceType;
  config: HttpSourceConfig | JdbcSourceConfig;
  secretRefs: Record<string, string>;
  state: "draft" | "tested" | "active" | "rejected";
  createdBy: string;
  createdAt: string;
  activatedAt?: string;
}
```

A failed edit leaves the previous active revision unchanged.

Metadata-only changes such as name and description do not require connector retesting.

## 9. Management Operations

### 9.1 List

```http
GET /v1/data-sources
```

Filters:

```text
type
status
health
search
createdAfter
updatedAfter
limit
cursor
```

List results never include credentials or full secret references.

### 9.2 Create

```http
POST /v1/data-sources
```

Create accepts metadata, connector type, connector configuration, and secret references.

The initial state is `draft`. Creation does not activate an untested connection.

### 9.3 Show

```http
GET /v1/data-sources/{sourceId}
```

Returns:

- Metadata.
- Administrative status.
- Health summary.
- Active configuration revision with secrets redacted.
- Schema Revision summary.
- Runtime capabilities.
- Query count and dependency summary when authorized.

### 9.4 Rename

```http
POST /v1/data-sources/{sourceId}/rename
```

```json
{
  "name": "Production Sales"
}
```

Rename is metadata-only and preserves stable IDs, Query Revisions, Dashboard Bindings, and audit history.

### 9.5 Edit

```http
PATCH /v1/data-sources/{sourceId}
```

Metadata edits may update name and description.

Connection edits create a new draft configuration revision. They do not mutate the active revision in place.

The request includes the expected current `version` to prevent accidental lost updates.

### 9.6 Test

```http
POST /v1/data-sources/{sourceId}/config-revisions/{revision}/test
```

Testing verifies:

- Secret references resolve.
- Endpoint or database is reachable.
- Authentication succeeds.
- Read-only behavior is available.
- Basic bounded query or request succeeds.
- Connector policy can be enforced.

Testing returns sanitized diagnostics.

### 9.7 Activate

```http
POST /v1/data-sources/{sourceId}/config-revisions/{revision}/activate
```

Activation requires a successful recent test. Activation is atomic and invalidates affected connection pools and safe caches.

### 9.8 Enable and Disable

```http
POST /v1/data-sources/{sourceId}/enable
POST /v1/data-sources/{sourceId}/disable
```

Disabling blocks new exploration and runtime execution without deleting metadata or Query Revisions.

### 9.9 Delete

```http
DELETE /v1/data-sources/{sourceId}
```

Delete is soft by default:

- Status becomes `deleted`.
- New execution is blocked.
- Credentials are no longer resolved.
- Metadata remains during retention.
- Existing Publications fail with a structured `SOURCE_DELETED` error.

The Control Plane checks Dashboard and Publication dependencies before requesting deletion. The Data Source Service also rejects deletion while it owns active Query dependencies that policy requires it to retain.

### 9.10 Restore and Purge

```http
POST   /v1/data-sources/{sourceId}/restore
DELETE /v1/data-sources/{sourceId}/purge
```

Restore is permitted during the retention period if required secrets still exist. A restored source returns to `disabled`; an administrator must explicitly enable it after verification.

Purge is an administrator-only operation after retention and dependency checks. It permanently removes connector metadata and schedules secret cleanup according to secret-manager policy.

### 9.11 Refresh Schema

```http
POST /v1/data-sources/{sourceId}/schema/refresh
```

A successful refresh creates an immutable Schema Revision. Published queries continue using stable source and field names; incompatible schema changes surface through health and validation diagnostics.

## 10. HTTP Data Source

### 10.1 Configuration

```ts
interface HttpSourceConfig {
  baseUrl: string;
  allowedMethods: Array<"GET" | "POST">;
  defaultHeaders?: Record<string, string>;
  auth:
    | { type: "none" }
    | { type: "bearer"; secretRef: string }
    | { type: "basic"; usernameRef: string; passwordRef: string }
    | { type: "api-key"; name: string; location: "header" | "query"; secretRef: string }
    | { type: "oauth-client-credentials"; tokenUrl: string; clientIdRef: string; clientSecretRef: string };
  timeoutMs: number;
  maxResponseBytes: number;
  allowedContentTypes: string[];
}
```

The service stores secret references, not resolved secret values.

### 10.2 Registered HTTP Operation

```ts
interface HttpOperation {
  type: "http";
  method: "GET" | "POST";
  path: string;
  query?: Record<string, ParameterTemplate>;
  headers?: Record<string, ParameterTemplate>;
  body?: unknown;
  response: {
    format: "json";
    rowsPointer: string;
  };
}
```

`rowsPointer` uses JSON Pointer rather than arbitrary executable extraction code.

The host is fixed by the Data Source configuration. A Query parameter cannot replace the host or protocol.

### 10.3 HTTP Parameters

Parameters may be inserted only into declared path, query, header, or body positions through typed templates.

They must not:

- Select a different host.
- Add arbitrary headers.
- Override authentication.
- Disable TLS validation.
- Change timeout or result limits.

### 10.4 HTTP Safety

The HTTP connector must:

- Require HTTPS by default.
- Validate DNS results and defend against DNS rebinding.
- Block loopback, link-local, cloud metadata, and private network ranges unless explicitly allowed by an administrator.
- Follow only a bounded number of redirects.
- Revalidate every redirect destination.
- Enforce method, content-type, timeout, and response-size policies.
- Redact authorization and configured secret headers from logs.
- Reject executable response formats.
- Parse JSON with bounded memory.

### 10.5 POST Requests

POST is allowed because many analytics and search APIs use POST for read-only requests. Registering a POST operation requires an explicit declaration that it is read-only.

The service cannot prove remote semantics from the HTTP method alone. Administrators must approve endpoints that could mutate data.

### 10.6 Pagination

The first version may support bounded page-number or cursor pagination declared in the registered operation.

Pagination must have:

- Maximum page count.
- Maximum total rows.
- Maximum total response bytes.
- Cancellation.

The connector does not crawl an unbounded API.

## 11. JDBC Data Source

### 11.1 Configuration

```ts
interface JdbcSourceConfig {
  driverId: string;
  jdbcUrl: string;
  usernameRef?: string;
  passwordRef?: string;
  defaultCatalog?: string;
  defaultSchema?: string;
  properties?: Record<string, string>;
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
  maxPoolSize: number;
}
```

`driverId` references an allowlisted driver artifact. It is not an arbitrary JAR URL.

### 11.2 Driver Registry

The JDBC Driver Registry contains:

- Driver ID.
- Database family.
- Driver version.
- Artifact checksum.
- Supported JDBC URL prefixes.
- Driver class.
- Known compatibility notes.
- Approval status.

Driver artifacts are pinned and scanned before deployment. Users cannot upload arbitrary JAR files in the first version.

### 11.3 JDBC Runner Protocol

The Bun service sends a bounded internal request to the JDBC Runner:

```ts
interface JdbcExecuteRequest {
  sourceId: string;
  configRevision: number;
  driverId: string;
  jdbcUrl: string;
  credentials: ResolvedJdbcCredentials;
  sql: string;
  parameters: JdbcParameter[];
  policy: ExecutionPolicy;
}
```

The protocol is available only on an internal network or local sidecar channel. It uses mutual service authentication and never exposes credentials to the Control Plane, browser, CLI, or Agent.

### 11.4 SQL Operation

```ts
interface JdbcSqlOperation {
  type: "jdbc-sql";
  sql: string;
  parameters: QueryParameterDefinition[];
}
```

The Coding Agent or authorized editor designs the SQL. The Data Source Service validates, registers, versions, and executes it.

### 11.5 SQL Safety

The JDBC Runner must:

- Use `Connection.setReadOnly(true)` where supported.
- Use a read-only database account.
- Use a read-only transaction where supported.
- Accept one statement only.
- Reject DDL and DML.
- Use `PreparedStatement` parameters.
- Set query timeout.
- Set maximum rows.
- Bound fetched bytes.
- Cancel the statement when the request is aborted.
- Close Result Sets, Statements, and Connections reliably.
- Redact JDBC URLs and properties that contain secrets.

Read-only database permissions remain the authoritative boundary. SQL parsing is defense in depth, not the sole protection.

### 11.6 Result Conversion

JDBC results are converted into the common tabular result contract.

Rules:

- SQL `NULL` becomes JSON `null`.
- Dates and timestamps become ISO 8601 strings.
- Precision-sensitive decimal values become strings.
- Binary values are rejected or encoded only under explicit policy.
- Column labels, types, and nullability are returned as metadata.

### 11.7 Connection Pooling

The JDBC Runner maintains bounded pools by Data Source and active Config Revision.

A pool is closed when:

- A new configuration revision activates.
- The Data Source is disabled or deleted.
- Credentials rotate.
- The driver becomes unhealthy.
- The Runner shuts down.

Pools must not be shared across tenants or incompatible credential scopes.

## 12. Connector Operations and Query Revisions

Registered queries use a connector-specific operation union:

```ts
type ConnectorOperation = HttpOperation | JdbcSqlOperation;

interface QueryRevision {
  id: string;
  revision: number;
  tenantId: string;
  sourceId: string;
  sourceConfigRevision: number;
  name: string;
  description?: string;
  operation: ConnectorOperation;
  parameters: QueryParameterDefinition[];
  result: QueryResultSchema;
  runtimePolicy: QueryRuntimePolicy;
  status: "validated" | "active" | "retired";
  createdAt: string;
}
```

The Query Revision stores no resolved secret. `sourceConfigRevision` records the configuration used to validate it; runtime execution resolves the Data Source's currently active Config Revision. This allows compatible connection updates and secret rotation without republishing Dashboards. Config activation invalidates affected pools and Query Result caches; incompatible source changes return structured Query errors until a new Query Revision is validated.

Runtime Dashboard Bindings reference:

```text
Query ID
Query Revision
logical name
```

The Data Source Service owns Query Revisions. The Control Plane owns Dashboard Query Bindings.

## 13. Schema Description

### 13.1 JDBC Schema

The JDBC connector may describe:

- Catalogs.
- Schemas.
- Tables and views.
- Columns and JDBC types.
- Nullability.
- Primary keys.
- Foreign-key relationships.
- Database comments when available.

Only authorized catalogs and schemas are returned.

### 13.2 HTTP Schema

HTTP sources do not always expose formal schemas. The description may come from:

- An administrator-provided JSON Schema.
- An imported OpenAPI operation.
- A bounded sample response.
- A previously validated Query Result Schema.

Sample inference is descriptive and may be incomplete. The schema records its origin and confidence.

### 13.3 Presentation Neutrality

Descriptions may include field meaning and type. They must not include:

```text
recommendedChart
componentType
controlType
gridPosition
layout
```

## 14. Secret Management

The Data Source Service is the only MDA application service allowed to resolve Data Source secret references.

Rules:

- Secrets are stored in an external secret manager in production.
- PostgreSQL stores only references.
- Secret values never appear in API responses.
- Secret values never appear in Agent Tool results.
- Secret values never appear in logs, events, exports, or audits.
- Credential rotation creates or activates a new Config Revision.
- Secret access is audited.
- Resolved secrets remain in memory only for the minimum required duration.

The JDBC Runner receives credentials through its protected internal channel and must not persist them.

## 15. Runtime Execution

Runtime flow:

```text
Generated Dashboard
  → Dashboard Runtime
  → Viewer Host
  → Control Plane validates Publication and Query Binding
  → signed execution grant
  → Data Source Service
  → active Query Revision
  → HTTP or JDBC connector
  → current source data
```

The signed execution grant contains:

- Tenant ID.
- Dashboard and Publication IDs.
- Query ID and pinned revision.
- Authorization scope identifier.
- Trusted row-level context.
- Expiry.
- Request ID.

It does not contain Data Source credentials.

The Data Source Service verifies the grant and applies its own source, query, status, rate, and execution policies.

## 16. Agent Tool Integration

A claimed Agent Job includes a credential-free Data Source context with service availability and authorized source summaries. This lets the Session system prompt distinguish “no sources configured” from a temporary outage before the Agent chooses a Tool. Full schema descriptions and exploration results remain on-demand rather than inflating every prompt.

Moss never receives Data Source management operations. It may use authorized read-only discovery, schema description, and bounded exploration results to generate a dashboard, and may register a Dashboard Query through its dedicated contract; it cannot create, edit, delete, test, activate, enable, disable, or configure a Data Source.

Agent Tools are adapters over the Data Source Service API:

```text
list_data_sources
describe_data_source
query_data_source
register_query
test_query
```

They do not:

- Connect directly to a database.
- Execute arbitrary HTTP from the Agent sandbox.
- Resolve Data Source credentials.
- Import connector implementations.
- Read Data Source Service tables.

`query_data_source` accepts a connector-specific exploration operation:

- HTTP request operation for an HTTP source.
- SQL operation for a JDBC source.

The Tool result uses the common rows, columns, freshness, truncation, and error contract.

## 17. Management API

Public management operations are exposed by the Control Plane and forwarded through internal service APIs after user authorization.

Canonical Control Plane routes:

```text
GET    /api/data-sources
POST   /api/data-sources
GET    /api/data-sources/{id}
PATCH  /api/data-sources/{id}
POST   /api/data-sources/{id}/rename
POST   /api/data-sources/{id}/test
POST   /api/data-sources/{id}/activate
POST   /api/data-sources/{id}/enable
POST   /api/data-sources/{id}/disable
DELETE /api/data-sources/{id}
POST   /api/data-sources/{id}/restore
POST   /api/data-sources/{id}/schema/refresh
GET    /api/data-sources/{id}/schema
GET    /api/data-sources/{id}/health
```

The Control Plane remains the user-facing authorization boundary. The Data Source Service API is private.

## 18. CLI Mapping

The `mda` CLI exposes:

```bash
mda source list
mda source add http --name customer-api
mda source add jdbc --name warehouse
mda source show warehouse
mda source describe warehouse
mda source rename warehouse analytics-warehouse
mda source update analytics-warehouse --config config.json
mda source rotate-secret analytics-warehouse --secret-ref secret://warehouse/v2
mda source test analytics-warehouse
mda source refresh analytics-warehouse
mda source enable analytics-warehouse
mda source disable analytics-warehouse
mda source delete analytics-warehouse
```

Destructive non-interactive commands require `--yes`.

## 19. Events

Durable event types:

```text
data-source.created
data-source.renamed
data-source.updated
data-source.config-tested
data-source.config-activated
data-source.enabled
data-source.disabled
data-source.deleted
data-source.restored
data-source.schema-refreshed
data-source.health-changed
query.created
query.activated
query.retired
```

Event envelope:

```ts
interface DataSourceEvent {
  id: string;
  sequence: number;
  tenantId: string;
  type: string;
  sourceId?: string;
  queryId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}
```

Events contain no credentials or sensitive parameter values.

## 20. Persistence Ownership

The Data Source Service owns:

```text
data_sources
data_source_config_revisions
data_source_schema_revisions
data_source_health
query_definitions
query_revisions
source_idempotency_keys
source_events
source_outbox
source_audit_events
```

The Control Plane owns only external references such as:

```text
dashboard_query_bindings
```

A binding stores Data Source and Query IDs but has no cross-service database foreign key. Publication validation confirms those references through the Data Source Service API.

## 21. Authorization

Suggested permissions:

```text
data-source.list
data-source.read
data-source.create
data-source.update
data-source.rename
data-source.test
data-source.enable
data-source.disable
data-source.delete
data-source.secret-rotate
query.explore
query.create
query.activate
query.execute
```

The Control Plane authorizes the user operation. The Data Source Service independently validates the signed tenant and permission context for defense in depth.

Runtime query execution uses a narrower execution grant rather than management permissions.

## 22. Health

Health is observed, not manually edited.

Checks include:

- Connector process availability.
- Secret resolution.
- DNS and network reachability.
- Authentication.
- Bounded test request or query.
- Connection-pool saturation.
- Recent timeout and error rate.

Health changes do not automatically delete or rename a source.

The service exposes sanitized status:

```ts
interface DataSourceHealthView {
  status: DataSourceHealth;
  checkedAt: string;
  latencyMs?: number;
  code?: string;
  message?: string;
}
```

## 23. Errors

Stable error codes include:

```text
DATA_SOURCE_NOT_FOUND
DATA_SOURCE_NAME_CONFLICT
DATA_SOURCE_DISABLED
DATA_SOURCE_DELETED
DATA_SOURCE_UNAVAILABLE
CONFIG_INVALID
CONFIG_VERSION_CONFLICT
CONNECTION_FAILED
CONNECTION_NOT_READ_ONLY
SECRET_NOT_FOUND
SECRET_ACCESS_DENIED
HTTP_DESTINATION_BLOCKED
HTTP_RESPONSE_INVALID
JDBC_DRIVER_NOT_ALLOWED
JDBC_RUNNER_UNAVAILABLE
SQL_INVALID
QUERY_NOT_FOUND
QUERY_REVISION_MISMATCH
PARAMETER_INVALID
TIMEOUT
RESULT_LIMIT_EXCEEDED
DEPENDENCY_CONFLICT
FORBIDDEN
```

Errors are sanitized before leaving the service. They never expose passwords, tokens, JDBC credentials, secret headers, or internal stack traces.

## 24. Audit

Audit records include:

- Tenant and actor.
- Source and Query identifiers.
- Management action or execution type.
- Config Revision number without secret values.
- Request ID.
- Timestamp and duration.
- Success or sanitized error code.
- Runtime row count, bytes, cache status, and truncation when applicable.

Source configuration changes record before/after metadata with secret values removed.

## 25. Testing

### 25.1 Contract Tests

Every connector must pass the same contract suite:

- Config validation.
- Connection test.
- Description.
- Typed parameter execution.
- Timeout.
- Cancellation.
- Row and byte limits.
- Error sanitization.
- Health transition.

### 25.2 HTTP Connector Tests

Test:

- GET and read-only POST.
- Authentication methods.
- JSON Pointer extraction.
- Redirect limits.
- DNS rebinding protection.
- Private and metadata destination blocking.
- Response-size limits.
- Pagination bounds.
- Secret-header redaction.

### 25.3 JDBC Connector Tests

Test against allowlisted databases as supported:

- Driver loading.
- Connection test.
- Read-only transaction.
- PreparedStatement parameters.
- DDL and DML rejection.
- Statement timeout and cancellation.
- Result type conversion.
- Pool replacement after Config Revision activation.
- Driver and credential redaction.

### 25.4 Management Tests

Test:

- Create, list, show, rename, and edit.
- Optimistic version conflict.
- Failed configuration preserving the active revision.
- Enable and disable.
- Dependency-aware soft delete.
- Restore and purge policy.
- Schema Revision creation.
- Tenant isolation.
- Durable events.

### 25.5 Module Decoupling Tests

CI verifies:

- Control Plane code does not import Data Source Service internals.
- Services do not access each other's database schema.
- Shared packages contain schemas only.
- Internal APIs validate contract versions.
- Service credentials cannot call user-facing APIs.

## 26. First-Version Scope

The first version includes:

- Standalone Bun Data Source Service.
- HTTP JSON connector with GET and explicitly read-only POST.
- JDBC connector through an isolated JVM Runner.
- A small allowlisted JDBC driver set.
- Create, list, show, rename, edit, test, activate, enable, disable, soft delete, restore, and schema refresh.
- Config Revisions and optimistic locking.
- Secret references and rotation.
- Agent-authored HTTP and JDBC Query Revisions.
- Live runtime execution and polling support.
- Durable events and audit records.

The first version does not include:

- User-uploaded JDBC driver JARs.
- Arbitrary executable HTTP response transforms.
- Write-back HTTP or SQL operations.
- Cross-source joins.
- A connector marketplace.
- Kafka or another required broker.
- Direct browser or Agent-sandbox connector access.

## 27. Acceptance Criteria

The module is acceptable when:

1. Data Sources can be created, listed, shown, renamed, edited, enabled, disabled, and deleted through web and `mda` CLI APIs.
2. Renaming preserves stable IDs and all Query and Dashboard references.
3. A failed connection edit cannot replace the working active configuration.
4. HTTP Sources can retrieve bounded JSON data through registered read-only operations.
5. JDBC Sources can execute Agent-authored parameterized read-only SQL through an isolated JVM Runner.
6. Credentials never reach the Control Plane, browser, CLI, generated source, or Agent sandbox.
7. The Data Source Service owns its tables, migrations, connectors, events, and audit records.
8. Other modules use only versioned contracts and never access its tables.
9. The Control Plane validates Dashboard Bindings through the service API.
10. Runtime execution returns current source data and supports the live refresh contract.
11. Source descriptions and results contain no component or presentation instructions.
12. Soft deletion blocks execution and preserves audit history during retention.
13. Every connector passes the shared contract suite.
14. Core MDA application code remains TypeScript/Bun, with the JVM isolated to the JDBC connector boundary required by JDBC itself.
