# Domain-Driven Design Structure

## 1. Goal

This document defines the detailed Domain-Driven Design structure for MDA.

MDA uses pragmatic DDD:

- Bounded Contexts protect domain ownership.
- Aggregates define transactional consistency boundaries.
- Application handlers orchestrate use cases.
- Domain functions enforce lifecycle invariants.
- Adapters own HTTP, PostgreSQL, Redis, Object Storage, Pi, HTTP connector, and JDBC details.
- Versioned contracts are the only cross-process shared code.

MDA does not add a class, repository interface, factory, or service layer for every table. TypeScript modules and pure functions are preferred until a real boundary requires an interface.

## 2. Strategic Domain Design

### 2.1 Subdomains

| Subdomain | Type | Purpose |
|---|---|---|
| Dashboard Authoring | Core | Preserve unrestricted Coding Agent ownership of dashboard source while managing checkpoints and immutable revisions |
| Agent Work | Core | Run resumable Pi conversations and generation jobs safely |
| Publication and Sharing | Core | Validate, publish, and distribute immutable dashboard artifacts |
| Data Access | Core | Manage HTTP/JDBC sources and immutable registered queries without prescribing presentation |
| Runtime Delivery | Supporting | Authorize a published or preview dashboard and execute its pinned live queries |
| Tenant Access | Supporting | Resolve tenant membership, roles, and permissions from authenticated identity |
| Artifact Storage | Generic | Persist source snapshots, Pi sessions, previews, and published bundles |
| Job Delivery | Generic | Deliver Agent Job notifications through Redis while PostgreSQL remains authoritative |

PostgreSQL, Redis, MinIO/S3, OIDC, Pi SDK, and the JDBC Runner are infrastructure or external systems. They are not domain contexts.

The Management Web, Viewer Host, and `mda` CLI are inbound adapters. Generated dashboard source is a managed artifact, not part of the platform's domain model.

### 2.2 Bounded Contexts

| Bounded Context | Deployable owner | Aggregate roots | Authoritative data |
|---|---|---|---|
| Tenant Access | `mda-main` | `Tenant`, `Membership` | Tenants, users, memberships, permissions |
| Dashboard Authoring | `mda-main` | `Dashboard`, `DraftCheckpoint`, `DashboardRevision` | Dashboard metadata, source revision history, Query Bindings |
| Agent Work | `mda-main`; execution adapter in `mda-agent` | `AgentSession`, `AgentJob` | Conversation continuity, leases, job state, durable Agent events |
| Distribution | `mda-main` | `Publication`, `ShareLink` | Immutable releases and access links |
| Runtime Delivery | `mda-main` | None | Authorization decisions, binding resolution, execution grants |
| Data Access | `mda-datasource` | `DataSource`, `RegisteredQuery` | Source configurations, schema, health, Query Revisions, execution audit |

A Bounded Context is not automatically a service. The first five contexts live in `mda-main` because they share one deployment and closely coordinated workflows. Data Access is a separate service because it owns credentials, connectors, persistence, and a separate network boundary.

### 2.3 Context Map

```text
External OIDC
    │ identity claims
    ▼
Tenant Access ────────────────┐
    │ authenticated principal │
    ▼                         ▼
Dashboard Authoring ────→ Agent Work ────→ mda-agent / Pi SDK
    │ immutable Revision       │              │
    │                          │              └─ source/build artifacts
    ▼                          │
Distribution ←────────────────┘
    │ Publication + pinned bindings
    ▼
Runtime Delivery ── signed execution grant ──→ Data Access
                                                    │
                                      ┌─────────────┴─────────────┐
                                      ▼                           ▼
                               remote HTTP API             JDBC Runner
                                                                  │
                                                             SQL database
```

Relationship rules:

- Tenant Access supplies authenticated principal and tenant context; downstream contexts never trust tenant IDs from request bodies.
- Dashboard Authoring owns Dashboard Query Bindings as part of immutable Dashboard Revisions.
- Data Access owns Data Sources and Query Revisions. Dashboard Authoring stores only their stable external IDs and revision numbers.
- Distribution validates external Query references synchronously before creating a Publication.
- Runtime Delivery translates a valid Publication or Preview request into a short-lived signed execution grant.
- Agent Work coordinates execution but does not own dashboard revisions, publications, or registered queries.
- `mda-agent` calls versioned APIs. It never imports domain code or database adapters from `mda-main` or `mda-datasource`.
- Cross-service consistency uses local transactions, synchronous validation, and outboxes. MDA does not use distributed transactions.

## 3. Ubiquitous Language

| Term | Definition |
|---|---|
| Dashboard | Stable project identity and metadata for one generated dashboard |
| Draft Checkpoint | Recoverable mutable-work snapshot; not a user-visible immutable revision |
| Dashboard Revision | Immutable source, Manifest, template/runtime versions, and Query Bindings |
| Query Binding | Logical query name mapped to one immutable external Query Revision |
| Agent Session | Durable conversation continuity across one or more Agent Jobs |
| Agent Job | One leased unit of Pi work against one Dashboard and Session |
| Agent Event | Append-only, ordered observation emitted while a Job runs |
| Publication | Immutable validated build of one Dashboard Revision |
| Share Link | Revocable access policy pointing to one Publication |
| Data Source | Stable administrative identity for one HTTP or JDBC connection |
| Config Revision | Versioned connector configuration and secret references whose payload is immutable after creation |
| Schema Revision | Immutable description of an observed source schema |
| Registered Query | Stable Query identity with immutable executable Query Revisions |
| Query Revision | Validated HTTP or JDBC operation, parameters, result schema, and runtime policy |
| Execution Grant | Short-lived signed authorization to execute one pinned Query Revision |
| Connector | Data Access adapter that validates, describes, tests, and executes one source type |
| Artifact | Immutable object stored outside PostgreSQL and addressed by key and digest |

Naming rules:

- `Revision` always means immutable domain history.
- `Version` is an optimistic-concurrency number on mutable aggregate state.
- `Checkpoint` is recoverable draft state and may be replaced.
- `Health` is an observation, not an administrative lifecycle state.
- `Disabled` and `deleted` are explicit administrative states.
- `Unavailable` describes health and must not be used as a Data Source lifecycle state.

## 4. Tactical Design Rules

### 4.1 Functional Domain Model

Use plain TypeScript data and pure transition functions:

```ts
interface AgentJob {
  id: AgentJobId;
  state: "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled";
  lease?: {
    owner: string;
    token: number;
    expiresAt: string;
  };
  version: number;
}

function claimJob(
  job: AgentJob,
  owner: string,
  now: Date,
  leaseMs: number,
): AgentJob;
```

A transition either returns valid new state and domain events or returns a stable domain error. It does not perform SQL, HTTP, Redis, Object Storage, or Pi calls.

Use classes only when they make an invariant materially clearer. Do not wrap every scalar in a runtime class.

### 4.2 Value Objects

Use validated structures or branded scalar types for values with domain meaning:

```ts
type DashboardId = string & { readonly __brand: "DashboardId" };
type QueryRevisionNumber = number & { readonly __brand: "QueryRevisionNumber" };
type ContentDigest = string & { readonly __brand: "ContentDigest" };

interface QueryRevisionRef {
  sourceId: string;
  queryId: string;
  revision: number;
}
```

Important Value Objects:

- Tenant-scoped normalized name.
- Artifact reference: object key, digest, size, media type.
- Query Revision reference.
- Dashboard Query Binding.
- Runtime policy.
- Lease: owner, fencing token, expiry.
- Idempotency key.
- Trusted execution context.
- Execution grant claims.
- Connector operation.
- Secret reference.

Validate transport shapes with TypeBox at the boundary. Convert them into domain values before invoking domain functions.

### 4.3 Aggregate Rules

- One command changes one aggregate unless the data is intentionally one consistency boundary.
- Creating a Checkpoint or Revision and advancing its Dashboard pointer is the deliberate same-context exception; both records commit atomically.
- One PostgreSQL transaction persists the aggregate, its audit record when required, and its outbox messages.
- Immutable histories may use multiple tables without loading every historical row into memory.
- Aggregate boundaries are consistency boundaries, not serialization boundaries or mandatory object graphs.
- Database constraints enforce uniqueness, ownership, immutability, and referential invariants within one service.
- External references are never protected with cross-service foreign keys.

### 4.4 Domain, Application, and Adapter Responsibilities

| Layer | Owns | Must not own |
|---|---|---|
| Domain | State transitions, invariants, domain errors, domain events | SQL, HTTP, Redis, filesystem, secrets, Pi SDK |
| Application | Authorization preconditions, transaction orchestration, ports, idempotency, cross-context workflow | Connector internals, UI rendering, direct request parsing |
| Inbound adapters | HTTP/SSE/worker protocol parsing, TypeBox validation, response mapping | Lifecycle rules |
| Outbound adapters | PostgreSQL, Redis, S3, OIDC, Data Source HTTP, Pi SDK, JDBC protocol | Domain policy decisions |

A handler may call concrete PostgreSQL functions directly because PostgreSQL is a selected platform dependency. Add a port only where implementations genuinely vary or a process/security boundary exists.

Required ports are limited to real boundaries:

```text
ArtifactStore
DataSourceClient
JobNotifier
AgentControlClient
SecretResolver
DataSourceConnector
JdbcRunnerClient
ModelProvider/Pi SDK boundary
```

Do not add generic `Repository<T>`, `BaseService`, `EntityFactory`, or in-process command-bus abstractions.

## 5. Tenant Access Context

### 5.1 `Tenant` Aggregate

Owns:

- Tenant ID.
- Display name.
- Administrative status.
- Version and timestamps.

Commands:

- Create tenant.
- Rename tenant.
- Disable or enable tenant.

Invariants:

- A disabled tenant cannot create new Jobs, Sources, Revisions, or Publications.
- Tenant identity is immutable.
- Tenant name normalization is consistent.

### 5.2 `Membership` Aggregate

Membership is an independent root keyed by tenant and user. It is not loaded as a collection inside `Tenant`.

Owns:

- Tenant and user IDs.
- Roles or permission set.
- Status.
- Version.

Commands:

- Add member.
- Change roles.
- Remove member.

Invariants:

- The referenced tenant must be active.
- Duplicate active membership is rejected by a unique database constraint.
- A user cannot grant permissions they do not hold.

OIDC users are external identities mapped locally by issuer and subject. Passwords and OIDC session state do not belong in this context.

### 5.3 Access Context Output

The context returns a trusted value to other `mda-main` contexts:

```ts
interface PrincipalContext {
  tenantId: string;
  userId: string;
  roles: string[];
  permissions: string[];
  authenticationExpiresAt: string;
}
```

This value comes from validated authentication and membership lookup. Public request bodies never construct it.

## 6. Dashboard Authoring Context

### 6.1 `Dashboard` Aggregate

Owns mutable project metadata and current pointers:

- Dashboard ID and tenant ID.
- Name and description.
- Current Draft Checkpoint ID.
- Latest saved Revision ID.
- Version and timestamps.

Commands:

- Create Dashboard.
- Rename or update metadata.
- Set current checkpoint.
- Advance latest saved Revision pointer.

Invariants:

- Name is unique within a tenant after normalization.
- Checkpoint and Revision pointers must belong to the same Dashboard.
- Optimistic version prevents lost metadata updates.
- Dashboard identity never changes when renamed.

Dashboard does not contain source files in PostgreSQL. It references immutable Object Storage artifacts.

### 6.2 `DraftCheckpoint` Aggregate

Owns one recoverable source snapshot:

- Checkpoint ID.
- Dashboard and originating Session IDs.
- Optional base Revision ID.
- Source artifact reference and digest.
- Manifest digest.
- Query Binding candidate set.
- Template and Runtime versions.
- Creation reason and timestamp.

Commands:

- Record checkpoint.
- Promote checkpoint to Revision.
- Expire superseded operational checkpoint after retention.

Invariants:

- Artifact digest must match uploaded content.
- Every Query Binding logical name is unique within the checkpoint.
- Manifest query declarations and binding logical names agree.
- The base Revision, if supplied, belongs to the Dashboard.
- Promotion is idempotent for the same checkpoint and idempotency key.

Checkpoint creation may replace the Dashboard's current pointer, but the checkpoint record itself is immutable after completion.

### 6.3 `DashboardRevision` Aggregate

Owns immutable authored state:

- Revision ID and Dashboard ID.
- Parent Revision ID.
- Source artifact and digest.
- Manifest and digest.
- Query Bindings.
- Template and Runtime versions.
- Author, Session, save message, and timestamp.

`DashboardQueryBinding` is a Value Object inside the Revision consistency boundary:

```ts
interface DashboardQueryBinding {
  logicalName: string;
  sourceId: string;
  queryId: string;
  queryRevision: number;
  parameters: Record<string, string>;
}
```

Invariants:

- A Revision cannot be updated after creation.
- Parent Revision belongs to the same Dashboard.
- Source, Manifest, and Query Binding digests are recorded together.
- Logical query names are unique.
- Bindings match Manifest parameter names and types.
- External Query Revision existence is checked through Data Access before save or publication according to the use case.

The database may store bindings in `dashboard_query_bindings`, but their owner is `DashboardRevision`; they are not an independent aggregate.

### 6.4 Authoring Domain Events

```text
dashboard.created
dashboard.metadata-updated
dashboard.checkpoint-recorded
dashboard.revision-saved
```

Only events needed outside the local transaction enter the outbox. Internal facts that no consumer needs remain ordinary return values.

## 7. Agent Work Context

### 7.1 `AgentSession` Aggregate

Owns conversation continuity:

- Session ID, tenant ID, and Dashboard ID.
- Pi session identifier.
- Latest Session JSONL artifact reference.
- Latest checkpoint or base Revision.
- Session status.
- Version and timestamps.

Commands:

- Open Session.
- Record settled Pi Session artifact.
- Change base Revision.
- Close Session.

Invariants:

- One Session belongs to exactly one Dashboard and tenant.
- A resumed Session uses a checkpoint or Revision from that Dashboard.
- Session artifact pointers advance only after successful Object Storage upload.
- Closing a Session blocks new Jobs.

### 7.2 `AgentJob` Aggregate

Owns authoritative work state:

- Job ID, tenant ID, Dashboard ID, and Session ID.
- Purpose and prompt reference.
- Base Revision or checkpoint reference.
- State and attempt count.
- Lease owner, fencing token, and expiry.
- Cancellation request time.
- Sanitized terminal result or error.
- Version and timestamps.

State machine:

```text
queued → leased → running → succeeded
   │        │         ├────→ failed
   │        │         └────→ cancelled
   │        └──────────────→ queued      lease recovery
   └───────────────────────→ cancelled
```

Commands:

- Enqueue Job.
- Claim Job.
- Start Job.
- Renew lease.
- Request cancellation.
- Recover expired lease.
- Complete Job.
- Fail Job.
- Confirm cancellation.

Invariants:

- Only a queued Job may be claimed.
- Only the current lease owner with the current fencing token may start, append authoritative events, renew, or settle the Job.
- Lease renewal cannot shorten the lease.
- Terminal states are final.
- A cancelled or failed Job cannot create a Publication.
- A stale Agent cannot overwrite a recovered Job's result.
- The same submission idempotency key returns the existing Job.

The fencing token is incremented on every claim. All Agent write APIs use a conditional update on Job ID, owner, token, and non-terminal state.

### 7.3 Agent Events

`AgentEvent` is append-only Job history, not an independently mutable aggregate.

Rules:

- Sequence is monotonic within a Job.
- Event append and any related Job transition occur in one transaction.
- Events contain sanitized Tool and model output.
- Tiny text deltas may be coalesced before persistence.
- Redis publishes only a wake-up after PostgreSQL commit.
- SSE replay reads PostgreSQL by sequence and does not rely on Redis history.

### 7.4 `mda-agent` Boundary

`mda-agent` is an execution adapter, not an owner of authoritative aggregates.

It owns only temporary process state:

- Redis consumer state.
- One job-scoped workspace.
- Pi `AgentSession` process.
- Build subprocesses.
- Short-lived Job credential.

It performs this application flow:

```text
receive Redis entry
  → claim Job through Main API
  → restore source and Pi Session artifacts
  → start Job with lease token
  → run Pi and approved Tools
  → append events and renew lease
  → upload artifacts
  → settle Job conditionally
  → acknowledge Redis entry
  → erase workspace
```

Redis delivery never grants authority to run a Job. A successful PostgreSQL-backed claim does.

## 8. Distribution Context

### 8.1 `Publication` Aggregate

A Publication is created only after successful validation and build. It is immutable.

Owns:

- Publication ID, tenant ID, and Dashboard ID.
- Dashboard Revision ID.
- Immutable Query Binding snapshot.
- Manifest, template, and Runtime versions.
- Build artifact reference and digest.
- Validation result.
- Publisher and timestamp.

Invariants:

- Revision belongs to the Dashboard and tenant.
- Revision source and Manifest digests match the build input.
- Every Query Binding resolves to the same validated external Query Revision recorded in the Revision.
- Build and browser smoke validation succeeded.
- Artifact digest matches uploaded content.
- One idempotency key cannot create multiple Publications.
- A Publication cannot be edited or repointed.

The build runs in `mda-agent`; `mda-main` validates the signed Job output and creates the Publication transactionally. Main never executes generated code.

### 8.2 `ShareLink` Aggregate

Owns:

- Share Link ID and opaque token digest.
- Publication ID.
- Access mode: authenticated, approved public-live, or snapshot.
- Expiry and revocation state.
- Version and timestamps.

Commands:

- Create link.
- Revoke link.
- Change expiry before revocation.

Invariants:

- The target Publication is immutable and belongs to the tenant.
- Public-live mode is allowed only when every pinned Query Revision is explicitly approved for that mode.
- Raw share tokens are returned once and never stored.
- Revocation is final.
- Expired or revoked links cannot authorize Runtime Delivery.

### 8.3 Distribution Events

```text
publication.created
share-link.created
share-link.revoked
```

A Publication event contains artifact references and stable IDs, never source credentials or share tokens.

## 9. Runtime Delivery Context

Runtime Delivery is a stateless domain/application service. It has no aggregate because each execution decision is derived from authoritative Publication, binding, principal, and Data Access state.

### 9.1 Runtime Execution Policy

Input:

- Authenticated principal or validated Share Link.
- Publication or Preview Revision identity.
- Logical Query ID.
- Public parameter values.
- Freshness and refresh reason.

Decision sequence:

1. Resolve tenant from trusted publication or preview context.
2. Authorize principal or Share Link.
3. Load the immutable Dashboard Query Binding.
4. Validate parameter names and public types.
5. Derive trusted tenant, viewer, role, and share context.
6. Enforce minimum interval, concurrency, and rate policy.
7. Sign a short-lived execution grant for the exact Query Revision.
8. Call Data Access.
9. Return presentation-neutral rows, metadata, freshness, and structured errors.
10. Record sanitized audit and metrics.

The browser never chooses tenant, Data Source, Query Revision, or trusted context.

### 9.2 Execution Grant Value Object

```ts
interface ExecutionGrantClaims {
  issuer: "mda-main";
  audience: "mda-datasource";
  tenantId: string;
  principalScopeId: string;
  dashboardId: string;
  publicationId?: string;
  dashboardRevisionId: string;
  sourceId: string;
  queryId: string;
  queryRevision: number;
  trustedContext: Record<string, string | string[]>;
  requestId: string;
  expiresAt: string;
}
```

The signature and expiry are verified by Data Access. The grant contains no Data Source credential.

### 9.3 Cache Identity

A Query Result cache key includes:

```text
tenant
principal authorization scope
Publication or Preview Revision
Query ID and Query Revision
active Source Config Revision
normalized public parameters
trusted-context digest
freshness policy version
```

The cache is an optimization. It is not aggregate state and cannot authorize access. Authorization is repeated before every cache read.

## 10. Data Access Context

Data Access is independently deployed and owns two aggregate families: Data Source and Registered Query.

### 10.1 `DataSource` Aggregate

Owns:

- Data Source ID and tenant ID.
- Stable type: HTTP or JDBC.
- Name and description.
- Administrative lifecycle state.
- Active Config Revision pointer.
- Current Schema Revision pointer.
- Version and timestamps.
- Soft-delete metadata.

Lifecycle:

```text
create
  ▼
draft ── activate tested config ──→ active ⇄ disabled
                                      │          │
                                      └────┬─────┘
                                           ▼
                                        deleted
                                           │
                                      restore during retention
                                           ▼
                                       disabled
```

Health is recorded separately as `unknown`, `healthy`, `degraded`, or `unreachable` and does not change this lifecycle automatically.

Commands:

- Create Source.
- Rename Source.
- Edit metadata.
- Add draft Config Revision.
- Record successful or failed config test.
- Activate Config Revision.
- Enable or disable Source.
- Soft-delete or restore Source.
- Set latest Schema Revision.
- Rotate secret reference by creating a new Config Revision.

Invariants:

- ID and connector type are immutable.
- Name is unique within one tenant after normalization.
- Active execution requires an active, successfully tested Config Revision.
- Config activation atomically changes the pointer; it never edits the previous revision.
- Disabled and deleted Sources reject new exploration and execution.
- Delete does not erase immutable Query history during retention.
- Restore never silently reactivates execution; it returns to disabled.
- Optimistic version protects metadata and lifecycle transitions.

Config and Schema Revision payloads are immutable child histories owned by the Data Source consistency boundary. Test, activation, and retirement metadata may advance without changing the recorded connector or schema payload. A command may lock only the source root and target revision; it does not load all historical revisions.

### 10.2 Config Revision Entity

Owns:

- Data Source ID and revision number.
- Redacted connector configuration.
- Secret references.
- Creation actor and timestamp.
- Latest bounded test result and timestamp.
- Activation timestamp when selected.

Invariants:

- Revision numbers increase per Source.
- Secret values are never persisted.
- A failed or stale test cannot satisfy activation policy.
- Connector configuration is immutable after creation.

### 10.3 Schema Revision Entity

Owns one immutable connector-neutral description:

- Origin: JDBC metadata, OpenAPI, administrator JSON Schema, sample inference, or validated result.
- Tables, operations, fields, relationships, and types where known.
- Confidence and limitations.
- Source Config Revision used for discovery.
- Timestamp and digest.

Schema metadata never includes chart, control, component, or layout recommendations.

### 10.4 Health Projection

`data_source_health` is an operational projection, not an aggregate root.

- Connector checks append or replace the latest observation.
- Read models join the latest observation to Data Source administrative state.
- Health updates do not increment the Data Source version unless lifecycle state changes.
- Health events are emitted only when the normalized status changes.

### 10.5 `RegisteredQuery` Aggregate

Owns:

- Query ID, tenant ID, and Data Source ID.
- Stable name and description.
- Active Query Revision pointer.
- Aggregate status and version.
- Immutable Query Revision history.

Query Revision lifecycle:

```text
validated → active → retired
```

Commands:

- Register validated Query Revision.
- Add a new revision after an operation changes.
- Activate a revision.
- Retire a revision.

Invariants:

- Query and Data Source belong to the same tenant.
- Operation kind matches the immutable Data Source type.
- The Source Config Revision recorded as validation provenance exists and was tested.
- Runtime execution resolves the Source's currently active Config Revision so secret rotation and compatible connection changes do not require Dashboard republishing.
- Operation is read-only and bounded.
- Parameters are named, typed, and safely bound.
- Successful validation records result schema and runtime policy.
- Query Revision operation, parameters, result schema, and runtime policy are immutable; binding eligibility may advance from validated to active to retired.
- New Dashboard bindings may target active revisions only.
- Retirement blocks new bindings; retained published bindings follow explicit retention policy.
- Query execution never resolves a secret outside Data Access.

### 10.6 Query Execution Domain Service

Execution does not mutate `RegisteredQuery`; it is a domain service over validated state and connector ports.

Flow:

```text
verify signed grant
  → load exact Query Revision
  → load Source and its active Config Revision
  → verify lifecycle and policy
  → validate and bind public parameters
  → inject trusted parameters
  → resolve secrets
  → execute HTTP or JDBC connector
  → normalize and bound result
  → write audit
  → return result
```

The execution transaction does not remain open during remote I/O. State is read and validated first; the final audit write is a separate short transaction. Immutable Query operation and loaded Config payloads make that safe. Config activation invalidates affected pools and Query Result cache entries.

### 10.7 Connector Boundary

The existing `DataSourceConnector` interface is the domain-facing port because HTTP and JDBC are real independent implementations.

Adapters:

```text
connectors/http/
  validates destination and request templates
  binds path/query/header/body parameters
  enforces SSRF policy and response limits

connectors/jdbc/
  maps connector-neutral request to JDBC Runner protocol
  enforces one read-only parameterized statement
  normalizes JDBC values into the common result contract
```

The JVM Runner is an outbound adapter. It owns driver loading and connection pools, not Data Source lifecycle or Query policy.

### 10.8 Data Access Events

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

Events are sanitized integration facts. Secret references are omitted unless an internal consumer explicitly needs a non-sensitive identifier.

## 11. Commands, Queries, and Transactions

MDA separates command handlers from read queries without introducing a CQRS framework.

### 11.1 Command Handler Shape

```ts
async function handleSaveRevision(
  command: SaveRevisionCommand,
  deps: SaveRevisionDeps,
): Promise<SaveRevisionResult> {
  // authorize and load
  // call pure domain transition
  // persist aggregate + audit + outbox in one transaction
  // perform no unbounded remote operation inside the transaction
}
```

Command rules:

- Validate transport shape before entering the handler.
- Authorize before loading sensitive state.
- Use expected version for mutable aggregates.
- Use idempotency keys for externally retried creation commands.
- Keep transactions short.
- Insert outbox rows in the same transaction as authoritative state.
- Map domain errors to stable contract errors at the adapter.

### 11.2 Query Handler Shape

Queries may read projection-oriented SQL directly:

```text
HTTP route
  → authorize tenant and permission
  → execute tenant-scoped SQL projection
  → map to response schema
```

Read models do not need to reconstruct aggregates. They must not become a back door for commands or cross-context table access.

### 11.3 Critical Transaction Boundaries

| Use case | Local atomic transaction | Outside transaction |
|---|---|---|
| Create Agent Job | Job, idempotency record, `agent.job-queued` outbox | Redis Stream delivery |
| Claim Job | Conditional lease owner/token/state update | Workspace restore and Pi startup |
| Append terminal Agent event | Event, terminal Job state, outbox wake-up | Redis notification, artifact cleanup |
| Save Dashboard Revision | Immutable Revision, bindings, Dashboard pointer, audit | Prior artifact upload and external Query validation |
| Publish Dashboard | Immutable Publication, idempotency record, audit, outbox | Agent build and Object Storage upload happen first |
| Activate Source Config | Source pointer/version, activation audit, outbox | Connection test happens first; pool invalidation happens after commit |
| Register Query Revision | Query revision, active pointer if requested, audit, outbox | Connector validation query happens first |
| Execute live Query | No long transaction during connector call | Short reads before execution and short audit write after execution |

## 12. Cross-Context Workflows

### 12.1 Agent Edit and Save

```text
Client submits message
  → Tenant Access resolves Principal
  → Agent Work creates Job + outbox
  → Redis delivers Job ID
  → mda-agent claims Job
  → Pi edits unrestricted src/** and public/**
  → Agent Tools call Data Access through versioned APIs
  → Agent uploads checkpoint artifact
  → Dashboard Authoring records Draft Checkpoint
  → Agent Work settles Job and Session
  → explicit save promotes checkpoint to Dashboard Revision
```

No Data Access transaction participates in the Dashboard save transaction. Query references are immutable external identities validated before the local save.

### 12.2 Publish

```text
Client requests publish with idempotency key
  → authorize Dashboard
  → load immutable Dashboard Revision
  → validate each Query Revision through Data Access
  → enqueue publish/build Agent Job
  → mda-agent restores exact Revision and builds
  → upload immutable bundle and validation result
  → conditionally settle successful Job
  → create immutable Publication in Main transaction
```

If Data Access is unavailable, validation fails with a retryable error. MDA does not publish against an unverified external reference.

If Publication creation fails after artifact upload, the artifact remains unreferenced and is removed later by retention cleanup. The build is safe to retry under the same idempotency key.

### 12.3 Runtime Live Query

```text
Viewer requests logical query
  → Runtime Delivery authorizes Publication/Preview
  → resolve immutable binding
  → issue exact short-lived grant
  → Data Access validates grant and Query/Source state
  → connector reads current data
  → Runtime Delivery returns normalized result
```

The frontend artifact and Query Revision remain immutable while source rows may change on every execution.

### 12.4 Data Source Rename

```text
rename Source in Data Access transaction
  → stable Source ID remains unchanged
  → emit data-source.renamed
  → Main may refresh display projections
```

No Dashboard Revision, Query Revision, or Publication changes because all bindings use stable IDs.

### 12.5 Data Source Disable or Delete

Data Access immediately blocks new execution based on authoritative Source state. Existing Publications remain immutable and return `SOURCE_DISABLED` or `SOURCE_DELETED` at runtime. Main may consume the integration event to display dependency warnings, but correctness does not depend on event delivery.

## 13. Domain and Integration Events

### 13.1 Event Envelope

```ts
interface IntegrationEvent<TType extends string, TData> {
  id: string;
  type: TType;
  schemaVersion: number;
  tenantId: string;
  aggregateId: string;
  aggregateVersion?: number;
  occurredAt: string;
  requestId: string;
  causationId?: string;
  correlationId?: string;
  data: TData;
}
```

Rules:

- Event IDs are globally unique.
- Event type and schema version are explicit.
- Payloads are backward compatible within a version.
- Events contain stable IDs and sanitized facts, not database row dumps.
- Secret values, model credentials, raw share tokens, and sensitive query parameters are forbidden.
- Consumers deduplicate by event ID.

### 13.2 Outbox Flow

```text
command transaction
  → update aggregate
  → insert audit record
  → insert outbox event
commit
  → dispatcher publishes Redis notification/Stream entry
  → mark outbox delivery attempt
```

PostgreSQL remains authoritative. Redis loss causes redelivery from the outbox or bounded PostgreSQL polling; it does not lose domain state. Outbox events are integration records, not an event-sourced aggregate store.

Use at-least-once delivery. Consumers must be idempotent. Do not promise exactly-once delivery.

### 13.3 No Generic Internal Event Bus

Within one process, application handlers may call another context's exported application facade directly. Add asynchronous integration only when latency, reliability, or deployable ownership requires it.

## 14. Persistence Ownership

### 14.1 Main Database

| Tables | Owner |
|---|---|
| `tenants`, `users`, `memberships` | Tenant Access |
| `dashboards`, `draft_checkpoints`, `dashboard_revisions`, `dashboard_query_bindings` | Dashboard Authoring |
| `agent_sessions`, `agent_jobs`, `agent_events` | Agent Work |
| `publications`, `share_links` | Distribution |
| `control_outbox`, `audit_events`, idempotency records | Owning Main context through shared infrastructure |

Runtime Delivery reads through owning context query functions or stable read views. It does not mutate these tables directly.

### 14.2 Data Access Database

| Tables | Owner |
|---|---|
| `data_sources`, `data_source_config_revisions`, `data_source_schema_revisions` | Data Source aggregate |
| `data_source_health` | Health projection |
| `query_definitions`, `query_revisions` | Registered Query aggregate |
| `source_events`, `source_outbox`, `source_audit_events`, idempotency records | Data Access infrastructure |

Rules:

- Main and Data Access use separate database roles and schemas or databases.
- No cross-service foreign keys, views, triggers, or joins.
- Every tenant-owned row has `tenant_id`.
- Aggregate updates use expected version or equivalent conditional state predicates.
- Immutable revision tables reject updates with privileges and application policy; database triggers may be added only if operational mistakes justify them.
- Unique and check constraints enforce invariants PostgreSQL can express.

### 14.3 Object Storage

Object Storage keys are partitioned by tenant and aggregate identity:

```text
tenants/{tenantId}/dashboards/{dashboardId}/checkpoints/{checkpointId}/source.tar.zst
tenants/{tenantId}/dashboards/{dashboardId}/revisions/{revisionId}/source.tar.zst
tenants/{tenantId}/sessions/{sessionId}/{sessionVersion}.jsonl
tenants/{tenantId}/previews/{previewId}/...
tenants/{tenantId}/publications/{publicationId}/...
```

The domain stores object key, digest, byte size, and media type. A database commit never assumes an upload succeeded; upload and digest verification happen first.

## 15. Contract Boundaries

`packages/contracts` is a transport Shared Kernel, not a shared domain model.

```text
packages/contracts/src/
├── public/
│   └── v1/                   # Browser and CLI REST/SSE schemas
├── internal/
│   ├── agent/v1/            # Main ↔ mda-agent
│   └── data-access/v1/      # Main/Agent Tools ↔ mda-datasource
├── runtime/
│   └── v1/                   # Viewer Host ↔ dashboard iframe
├── events/
│   └── v1/                   # Integration event envelopes and payloads
├── errors.ts                 # Stable public and internal error codes
└── index.ts                  # Explicit exports only
```

Contract rules:

- Schemas use TypeBox and produce runtime validation plus TypeScript types.
- Domain modules map contract DTOs into domain values; they do not use DTOs as mutable aggregate state.
- Contracts contain no SQL, connector implementation, secret resolver, domain transition, or UI component.
- Breaking changes create a new route or contract version.
- Internal routes are authenticated even when reachable only on a private Compose network.
- Package exports prevent clients from importing unpublished internal files.

## 16. Code Structure

### 16.1 Monorepo

```text
mda/
├── apps/
│   ├── web/                         # Management Web and Viewer Host adapters
│   ├── cli/                         # Public Control Plane API adapter
│   ├── control-plane/               # mda-main domain/application/adapters
│   ├── data-source-service/         # mda-datasource domain/application/adapters
│   └── agent/                       # mda-agent execution worker
├── connectors/
│   └── jdbc-runner/                 # JVM adapter for JDBC interoperability
├── packages/
│   ├── contracts/                   # Versioned transport Shared Kernel
│   ├── dashboard-runtime/           # Generated-page runtime adapter
│   └── dashboard-template/          # Platform-owned build shell
├── skills/
│   └── dashboard-aesthetics/
├── migrations/
│   ├── control-plane/
│   └── data-source/
└── docs/
```

### 16.2 Control Plane

```text
apps/control-plane/src/
├── server.ts
├── config.ts
├── contexts/
│   ├── access/
│   │   ├── domain.ts                # Tenant and Membership transitions
│   │   ├── commands.ts
│   │   ├── queries.ts
│   │   ├── postgres.ts
│   │   └── routes.ts
│   ├── dashboards/
│   │   ├── domain.ts                # Dashboard, Checkpoint, Revision invariants
│   │   ├── commands.ts
│   │   ├── queries.ts
│   │   ├── postgres.ts
│   │   ├── artifacts.ts             # ArtifactStore orchestration
│   │   └── routes.ts
│   ├── agent-work/
│   │   ├── domain.ts                # Session, Job, lease transitions
│   │   ├── commands.ts
│   │   ├── queries.ts
│   │   ├── postgres.ts
│   │   ├── events.ts                # Append/replay mapping
│   │   ├── dispatch.ts              # Outbox to Redis Stream
│   │   ├── internal-routes.ts       # claim/heartbeat/event/settle
│   │   └── public-routes.ts         # submit/cancel/SSE
│   ├── distribution/
│   │   ├── domain.ts                # Publication and Share Link invariants
│   │   ├── commands.ts
│   │   ├── queries.ts
│   │   ├── postgres.ts
│   │   └── routes.ts
│   └── runtime-delivery/
│       ├── execute.ts               # authorize, bind, grant, call Data Access
│       ├── grants.ts
│       ├── cache.ts
│       └── routes.ts
├── adapters/
│   ├── oidc.ts
│   ├── object-storage.ts
│   ├── redis.ts
│   ├── data-access-client.ts
│   └── data-access-routes.ts        # Authorized public management proxy
└── shared/
    ├── auth.ts
    ├── db.ts
    ├── errors.ts
    ├── http.ts
    ├── idempotency.ts
    ├── outbox.ts
    └── observability.ts
```

Start each context with these few files. Split `commands.ts`, `queries.ts`, or `postgres.ts` only when file size or ownership makes the split clearer. Do not scaffold one file per use case before code exists.

### 16.3 Data Source Service

```text
apps/data-source-service/src/
├── server.ts
├── config.ts
├── contexts/
│   └── data-access/
│       ├── sources/
│       │   ├── domain.ts            # DataSource and revision invariants
│       │   ├── commands.ts
│       │   ├── queries.ts
│       │   ├── postgres.ts
│       │   └── routes.ts
│       ├── registered-queries/
│       │   ├── domain.ts
│       │   ├── commands.ts
│       │   ├── queries.ts
│       │   └── postgres.ts
│       ├── execution/
│       │   ├── execute.ts
│       │   ├── grants.ts
│       │   ├── parameters.ts
│       │   ├── result.ts
│       │   └── cache.ts
│       ├── health.ts
│       ├── events.ts
│       └── internal-routes.ts
├── connectors/
│   ├── connector.ts                 # Real multi-implementation port
│   ├── http.ts
│   └── jdbc.ts
├── adapters/
│   ├── jdbc-runner-client.ts
│   ├── secret-resolver.ts
│   └── redis.ts
└── shared/
    ├── auth.ts
    ├── db.ts
    ├── errors.ts
    ├── idempotency.ts
    ├── outbox.ts
    └── observability.ts
```

Source and Registered Query modules are within one Data Access Bounded Context. They may call explicit exported application functions but must not reach into each other's SQL files.

### 16.4 Agent Worker

The Agent Worker is application and adapter code rather than an authoritative DDD model:

```text
apps/agent/src/
├── worker.ts                         # Redis consume loop; one Job at a time
├── run-job.ts                        # Restore, run, checkpoint, settle
├── lease.ts                          # Heartbeat and abort on lost lease
├── pi/
│   ├── session.ts
│   ├── events.ts
│   ├── resource-loader.ts
│   └── tools.ts
├── workspace/
│   ├── restore.ts
│   ├── validate.ts
│   ├── build.ts
│   └── cleanup.ts
└── clients/
    ├── control-plane.ts
    ├── data-access.ts
    └── object-storage.ts
```

Do not duplicate `AgentJob` transition logic here. Main accepts or rejects worker requests using authoritative state and fencing token.

### 16.5 Web and CLI

Web and CLI organize by user capability and consume public contracts:

```text
apps/web/src/features/
  dashboards/
  sessions/
  data-sources/
  publications/
  sharing/

apps/cli/src/commands/
  dashboard.ts
  session.ts
  source.ts
  publish.ts
  share.ts
```

They contain no domain aggregates, SQL, source connectors, or Pi SDK calls.

## 17. Dependency Rules

Allowed dependencies:

```text
route/worker adapter
  → application handler
  → domain module

application handler
  → concrete local PostgreSQL module
  → declared external port

outbound adapter
  → external SDK/protocol

all process boundaries
  → packages/contracts only
```

Forbidden dependencies:

```text
web or CLI → server domain internals
mda-agent → Main/Data Access domain or SQL modules
mda-main → Data Access SQL, secret resolver, or connectors
mda-datasource → Main SQL or Dashboard source
JDBC Runner → Dashboard, Query Binding, or authorization domains
domain.ts → Bun server, SQL, Redis, S3, Pi, Fetch, filesystem
one context's postgres.ts → another context's tables
```

Enforce with:

- Workspace package exports.
- TypeScript project references or path rules.
- Separate database roles and migrations.
- A small `bun test` import-boundary check; do not add a new architecture framework initially.

## 18. Validation, Errors, and Idempotency

### 18.1 Validation Order

```text
transport schema
  → authentication
  → tenant/permission authorization
  → domain value conversion
  → aggregate invariant
  → persistence constraint
  → response schema
```

Trust-boundary validation is never skipped. Domain validation must not depend on UI validation.

### 18.2 Error Families

```text
validation       malformed shape or invalid value
authentication   missing or expired identity/service credential
authorization    principal lacks permission
not-found        tenant-scoped aggregate is absent
conflict         name/version/idempotency or lifecycle conflict
policy           source/query/runtime policy blocks operation
unavailable      connector or infrastructure is temporarily unavailable
internal         sanitized unexpected failure
```

Domain modules return stable symbolic errors. Adapters map them to HTTP status, CLI exit code, SSE terminal event, or Runtime error without exposing SQL, secrets, credentials, or internal stack traces.

### 18.3 Optimistic Concurrency

Mutable aggregates carry a version. Updates use:

```sql
UPDATE ...
SET ..., version = version + 1
WHERE id = $id AND tenant_id = $tenantId AND version = $expectedVersion
```

Zero affected rows becomes `VERSION_CONFLICT` or a tenant-scoped not-found result after a safe check.

Leased Jobs additionally require lease owner and fencing token predicates.

### 18.4 Idempotency

Persist idempotency by tenant, operation, and key for:

- Agent Job creation.
- Revision promotion.
- Publication creation.
- Data Source creation when called by retrying clients.
- Query registration.
- Other externally retried create operations.

The stored record includes request digest and result identity. Reusing a key with a different request digest is a conflict.

## 19. Testing Structure

### 19.1 Domain Tests

Pure tests cover state transitions and invariants without mocks:

```text
Dashboard Revision immutability and binding uniqueness
Agent Job transition matrix and stale fencing token rejection
Publication digest and binding validation
Share Link revocation and public-live rules
Data Source activation, disable, delete, and restore
Config Revision activation test freshness
Registered Query revision immutability and operation/source compatibility
```

### 19.2 Application Tests

Use real domain functions with small fake external ports only where a real process boundary exists:

```text
artifact upload before Revision transaction
Data Access validation before publication
outbox insertion with command state
idempotent retry returns existing result
lost Agent lease aborts execution
Runtime grant uses trusted context instead of browser values
```

Do not mock PostgreSQL query text extensively. Use integration tests for persistence behavior.

### 19.3 Integration Tests

Run disposable PostgreSQL, Redis, MinIO, HTTP fixture, and JDBC Runner services for:

- Constraints, optimistic versions, transaction rollback, and outbox atomicity.
- Redis redelivery and PostgreSQL lease recovery.
- Object digest verification and unreferenced-artifact cleanup.
- Internal contract authentication and versioning.
- HTTP SSRF policy and bounded responses.
- JDBC read-only, timeout, parameter binding, and value normalization.
- Separate database role ownership.

### 19.4 Contract Tests

Provider and consumer tests validate the same TypeBox schemas from `packages/contracts`:

- Public Control Plane REST and SSE.
- Main-to-Agent claim, heartbeat, event, and settlement.
- Main-to-Data Access management and execution.
- Agent Tool-to-Data Access exploration and Query registration.
- Viewer Host-to-iframe Runtime messages.
- Versioned integration events.

### 19.5 End-to-End Domain Journeys

Minimum journeys:

1. Create Dashboard, run Agent Job, record checkpoint, and save Revision.
2. Create and activate HTTP Source, register Query, publish, and observe live refresh.
3. Create and activate JDBC Source through Runner, then execute a pinned Query.
4. Rename Source without breaking Query or Dashboard bindings.
5. Disable and delete Source and observe structured runtime failures.
6. Crash Agent after claim, recover lease, and reject stale settlement.
7. Lose Redis data and reconstruct queued work from PostgreSQL outbox.
8. Reconnect SSE and replay Agent events from PostgreSQL sequence.

## 20. Implementation Order

Implement vertical slices rather than all layers of all contexts at once.

### Phase 1: Boundaries

1. Create workspace package exports and versioned TypeBox contracts.
2. Create separate Main and Data Access migrations and database roles.
3. Add shared transaction, error, idempotency, and outbox primitives inside each service.
4. Add the import-boundary test.

### Phase 2: Authoring and Agent Slice

1. Dashboard and Draft Checkpoint transitions.
2. Agent Job lease/fencing transitions.
3. Main internal Agent API and Redis outbox dispatch.
4. Agent Worker restore/run/checkpoint/settle path.
5. Explicit Dashboard Revision save.

### Phase 3: Data Access Slice

1. Data Source and Config Revision transitions.
2. HTTP Connector and health projection.
3. Registered Query and runtime execution.
4. JDBC client and isolated Runner.
5. Main Data Access client and signed execution grants.

### Phase 4: Distribution Slice

1. Revision and Query Binding validation.
2. Agent-based deterministic build.
3. Immutable Publication creation.
4. Share Link aggregate.
5. Published Runtime Delivery and live refresh.

### Phase 5: Hardening

1. Lease recovery, outbox replay, and idempotency tests.
2. Secret, tenant, and contract boundary tests.
3. Retention cleanup for checkpoints, sessions, and unreferenced artifacts.
4. Metrics and audit correlation across contexts.

## 21. Rejected Structures

Do not use:

- One global `domain/`, `services/`, `repositories/`, and `controllers/` tree shared by all concepts.
- A generic repository abstraction over Bun SQL.
- An entity class for every database row.
- A command bus or event-sourcing framework for ordinary function calls.
- Redis as aggregate storage or event authority.
- Shared database tables or cross-service foreign keys.
- Data Source DTOs as Main-owned domain entities.
- Agent Worker-local state as authoritative Job state.
- A `Dashboard` aggregate that loads all Revisions, Publications, Sessions, and Events.
- A `DataSource` aggregate that loads all schema and query history for each command.
- Distributed transactions between Main, Data Access, Object Storage, and Agent.
- Domain abstractions for dashboard components, layouts, charts, controls, or generated `src/**`.

## 22. Acceptance Criteria

The DDD structure is satisfied when:

1. Every authoritative record has exactly one Bounded Context owner.
2. Main and Data Access use separate persistence ownership and versioned HTTP contracts.
3. Only transport schemas are shared across process boundaries.
4. Domain transitions run without SQL, Redis, Object Storage, Pi, HTTP, or JDBC dependencies.
5. Mutable aggregates use optimistic concurrency; Agent Jobs also use fencing tokens.
6. Dashboard Revisions and Publications are immutable, and Query, Config, and Schema Revision payloads cannot be edited in place.
7. Cross-service workflows use local transactions and outboxes without distributed transactions.
8. Redis loss cannot lose authoritative Jobs or events.
9. The Agent Worker cannot bypass Main's Job state or Data Access's source policy.
10. Runtime Delivery derives tenant, viewer, Query Revision, and trusted context on the server.
11. Data Source health remains separate from administrative lifecycle.
12. Source rename preserves all stable references.
13. Source disable or delete blocks execution without mutating Publications.
14. Query and Source descriptions remain presentation-neutral.
15. Generated dashboard source remains outside the platform domain model and fully Agent-controlled under `src/**` and `public/**`.
16. The code layout can begin with small modules and split only when actual size or ownership requires it.

## 23. Related Documents

- `docs/technology-selection-and-architecture.md`: technology, deployment units, and runtime architecture.
- `docs/docker-compose-deployment-architecture.md`: image, PostgreSQL, Redis, network, and secret boundaries.
- `docs/data-source-management-module.md`: Data Access management and connector contract.
- `docs/data-gateway-query-contract.md`: Query registration and runtime result contract.
- `docs/dashboard-artifact-contract.md`: generated source, Manifest, build, and artifact boundary.
- `docs/live-data-and-refresh-contract.md`: checkpoint, Revision, Publication, and live refresh behavior.
- `docs/mda-cli-design.md`: CLI adapter and command surface.
