# Technology Selection and System Architecture

## 1. Purpose

This document selects the implementation technologies and defines the system architecture for MDA.

The system is written in TypeScript and runs on Bun. Pi remains the Coding Agent core. The architecture protects data and infrastructure boundaries without constraining the dashboard components generated under `src/**`.

Core principles:

1. Use TypeScript end to end.
2. Use Bun as the runtime, package manager, script runner, and test runner.
3. Keep the Control Plane separate from generated-code execution.
4. Keep data credentials outside Agent sandboxes and dashboard artifacts.
5. Let the Coding Agent fully control dashboard source and presentation.
6. Start with one deployable system plus an isolated Agent execution path, not a collection of speculative microservices.
7. Prefer Bun and platform-native capabilities before adding dependencies.

## 2. Selected Technology Stack

| Area | Selection | Reason |
|---|---|---|
| Language | TypeScript with strict mode | Shared types across browser, server, Agent Tools, and Runtime SDK |
| Runtime | Bun | Fast TypeScript execution, native HTTP, SQL, S3, subprocess, and test support |
| Package manager | Bun workspaces and `bun.lock` | One tool for installation, scripts, and workspace dependency management |
| Management UI | React + Vite + TypeScript | Mature browser ecosystem and consistent dashboard template tooling |
| CLI | Bun-compiled TypeScript executable named `mda` | Full scriptable access to the same Control Plane API as the web UI |
| HTTP server | `Bun.serve` | Native routing, Web APIs, streaming responses, and no required server framework |
| API style | REST/JSON + SSE | Simple commands over HTTP and one-way Agent event streaming |
| Runtime validation | TypeBox + JSON Schema | Reuses the schema style required by Pi Tools and supports machine-readable contracts |
| Metadata database | PostgreSQL | Authoritative transactions, constraints, durable jobs, events, and auditing |
| Redis | Redis Streams, notifications, rate counters, and bounded cache | Fast Agent dispatch and live event wake-ups while PostgreSQL remains authoritative |
| Database client | Bun's built-in SQL client | Pooling and parameterized SQL without an ORM or generated client |
| Artifact storage | S3-compatible Object Storage through Bun's S3 client | Immutable source snapshots, sessions, previews, and published bundles |
| Local object storage | MinIO | Local S3 compatibility without changing application code |
| Coding Agent | `@earendil-works/pi-coding-agent` SDK | Full AgentSession, Tools, Skills, events, compaction, and session support |
| Data Source module | Standalone Bun service | Decoupled CRUD, connector, query, health, and execution ownership |
| JDBC interoperability | Isolated JVM JDBC Runner | JDBC is a Java API and cannot run directly inside Bun |
| Unit/integration tests | `bun test` | Built into the runtime |
| Browser tests | Playwright | Real-browser verification for preview, iframe, Runtime SDK, and publishing flows |
| Formatting/linting | Biome | One fast formatter and linter for TypeScript, JSON, and CSS |
| Type checking | TypeScript compiler | `tsc --noEmit` remains the source of truth for static type correctness |
| Authentication | External OIDC provider + JWT/JWKS validation | Avoids building password storage and account recovery |
| Isolation | Docker-compatible containers initially | Real process, filesystem, and network isolation for generated code |

## 3. Bun Baseline

The implementation baseline is Bun `1.3.13` or newer within the same compatible release line. The exact runtime version must be pinned in development and deployment images rather than relying on whatever version happens to be installed.

Bun is used for:

- Installing workspace dependencies.
- Running TypeScript directly.
- Serving HTTP and SSE.
- Accessing PostgreSQL.
- Accessing S3-compatible storage.
- Running subprocesses in the Agent Runner.
- Running tests.
- Building the management UI and generated dashboards through Vite.
- Running and compiling the `mda` CLI.

Standard commands:

```bash
bun install
bun run dev
bun run typecheck
bun run lint
bun test
bun run test:e2e
bun run build
```

Do not maintain parallel npm, pnpm, or Yarn workflows. The committed `bun.lock` is the reproducible dependency source.

## 4. Pi SDK Compatibility Boundary

The primary integration runs the Pi SDK directly inside a Bun Agent Runner:

```ts
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
```

The current reviewed baseline is:

```text
Bun: 1.3.13
@earendil-works/pi-coding-agent: 0.84.2
```

The package imports successfully under this Bun baseline. Direct SDK execution must still have a CI smoke test that creates a controlled session, registers a Tool, processes a prompt with a test model or fixture, receives events, and disposes the session.

Pi must be pinned to an exact version. A dependency update is accepted only after the smoke test, Tool tests, session-resume test, and one full dashboard generation test pass.

The Agent Runner must use an explicit `ResourceLoader`. It must not discover user-provided `.pi/extensions`, Skills, prompts, or Context Files from generated workspaces.

## 5. Deliberately Small Dependency Set

Use dependencies where they remove real risk or substantial boilerplate:

- React for management UI rendering.
- Vite for browser builds and generated dashboard builds.
- TypeBox for shared runtime schemas and Pi Tool definitions.
- Pi SDK for Agent behavior.
- A well-maintained JOSE implementation for JWT and JWKS validation.
- Playwright for browser-level security and integration tests.
- Biome for formatting and linting.

Do not add these initially:

- An ORM.
- Kafka or another additional message broker.
- Kubernetes-specific libraries.
- A dependency-injection container.
- A server framework around `Bun.serve`.
- GraphQL.
- A frontend global-state framework.
- A monorepo orchestrator such as Nx or Turborepo.
- A component DSL or visual page builder.

PostgreSQL, Redis, Bun workspaces, native Fetch/Web Streams, and small domain modules cover the initial requirements.

## 6. Logical Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Clients                                                      │
│ Browser: Management UI / Viewer Host / Preview shell         │
│ mda CLI: commands / chat / events / diagnostics / export     │
└───────────────────────┬──────────────────────────────────────┘
                        │ HTTPS: REST + SSE
┌───────────────────────▼──────────────────────────────────────┐
│ Bun Control Plane                                            │
│ Auth, dashboards, Agent jobs, Query Bindings, publish/share  │
└───────────┬────────────────┬─────────────────┬───────────────┘
            │                │                 │ signed internal HTTP
      PostgreSQL      Object Storage           │
                                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Standalone Bun Data Source Service                           │
│ CRUD, schema, HTTP/JDBC connectors, queries, health, audit   │
└──────────────┬───────────────────────────┬───────────────────┘
               │                           │
         Remote HTTP APIs          Isolated JVM JDBC Runner
                                           │
                                      SQL databases

┌──────────────────────────────────────────────────────────────┐
│ Independent mda-agent image + Pi SDK                         │
│ Redis Job consumer; Tools call versioned internal APIs        │
└──────────────────────────────────────────────────────────────┘
```

The Data Source Service is a standalone module with its own persistence, migrations, connectors, events, and audit records. Other modules communicate with it only through versioned contracts. Its detailed boundary is defined in `docs/data-source-management-module.md`.

## 7. Deployable Units

### 7.1 Management Web

A React/Vite single-page application that provides:

- Dashboard list and metadata editing.
- Chat with the Coding Agent.
- Streaming Agent and Tool events.
- Data-source administration.
- Source and revision browsing.
- Preview iframe host.
- Validation and publishing controls.
- Share-link administration.

The production management build is a static frontend artifact and may be served by the Control Plane or a CDN. Published Dashboard bundles are also immutable frontend artifacts, but their authorized data remains live through the Data Gateway. No frontend artifact contains database, model, or data-source credentials.

### 7.2 mda CLI

A Bun-compiled TypeScript client that provides complete, scriptable access to the same Control Plane operations as the web UI, including continuous conversations, raw event streams, Tool and error inspection, simulations, and artifact export.

The CLI contains presentation and client concerns only. It does not connect directly to Pi, PostgreSQL, Object Storage, or data sources. Its complete command and interaction contract is defined in `docs/mda-cli-design.md`.

### 7.3 Control Plane

A Bun service built on `Bun.serve` that owns:

- Authentication and tenant context.
- Dashboard, Revision, Publication, and Share Link lifecycles.
- Dashboard Query Bindings that reference external Query Revisions.
- User-facing Data Source management orchestration through the standalone service.
- Agent job creation, cancellation, and status.
- SSE event replay.
- Object-storage metadata and signed artifact access.
- Audit records.

The Control Plane never executes generated dashboard code, resolves Data Source credentials, or gives those credentials to the Agent Runner.

### 7.4 Data Source Service

A standalone Bun service that owns Data Source CRUD, configuration and Schema Revisions, HTTP connectors, JDBC connector orchestration, Query Revisions, live execution, health, events, and audit records.

JDBC operations are delegated through a protected internal protocol to an isolated JVM JDBC Runner with allowlisted drivers. The service's full management and connector contract is defined in `docs/data-source-management-module.md`.

### 7.5 Independent Agent Image

`mda-agent` is an independent Bun image containing:

- Pi SDK.
- Redis Stream Job consumer.
- The approved dashboard template and dependencies.
- Platform-maintained Skills and custom Tools.
- One logical workspace and Pi history per active MDA Session.
- Build and validation commands.

Each Agent container runs a bounded pool of in-process workers. Every worker handles one Job at a time and renews its authoritative lease through the Control Plane, allowing three containers with eight workers each to run up to 24 conversations concurrently. Session-specific workspaces and Pi histories prevent accidental overlap; they are logical separation, not a hostile-code sandbox. The Agent has no Control Plane database or Data Source credential and no Docker socket.

### 7.6 PostgreSQL

PostgreSQL stores transactional metadata, job state, and durable event cursors. The Control Plane and Data Source Service own separate databases or schemas and never access each other's tables. PostgreSQL does not store large source archives or built bundles.

### 7.7 Redis

Redis provides Agent Job Streams, event wake-up notifications, bounded rate counters, and optional authorization-scoped Query Result caching. PostgreSQL remains the system of record, and outboxes reconstruct Redis delivery after data loss.

### 7.8 Object Storage

S3-compatible storage contains:

- Dashboard source snapshots.
- `public/` assets.
- Pi Session JSONL files.
- Preview bundles.
- Published immutable bundles.
- Optional anonymous-share snapshots.

Artifacts are immutable once published. Database rows point to content-addressed or revision-addressed object keys.

## 8. Monorepo Layout

Use Bun workspaces without an additional monorepo framework:

```text
mda/
├── apps/
│   ├── web/                  # React management UI and viewer host
│   ├── cli/                  # Bun CLI executable named mda
│   ├── control-plane/        # Bun HTTP API, SSE, Dashboard orchestration
│   ├── data-source-service/  # CRUD, HTTP/JDBC connectors, Query execution
│   └── agent/                # Independent mda-agent image and Pi SDK worker
├── connectors/
│   └── jdbc-runner/          # Isolated JVM JDBC interoperability runtime
├── packages/
│   ├── contracts/            # TypeBox schemas and shared API types
│   ├── dashboard-runtime/    # iframe/runtime API used by generated src
│   └── dashboard-template/   # Fixed build shell; Agent owns src
├── skills/
│   └── dashboard-aesthetics/ # Design guidance, no component restrictions
├── migrations/
│   ├── control-plane/        # Main-owned ordered PostgreSQL migrations
│   └── data-source/          # Data Source-owned ordered PostgreSQL migrations
├── docs/
└── package.json
```

Do not create a package for every domain concept. Keep dashboard, publication, and job logic as modules inside the Control Plane. Data Source and Query execution are separate because they own credentials, connectors, persistence, and an independently secured runtime boundary.

## 9. Architecture Control Rules

These rules prevent architecture drift without limiting generated dashboard code.

### 9.1 Dependency Direction

```text
HTTP routes / worker adapters
  → application handlers
      → pure domain functions
      → database, storage, and process-boundary adapters
```

- HTTP routes parse and validate transport input, then establish tenant context.
- Application handlers authorize, orchestrate transactions, and call domain functions and adapters.
- Domain functions implement lifecycle invariants without infrastructure dependencies.
- Database functions contain SQL; storage functions contain S3 operations.
- Agent Tools call versioned internal APIs; they do not import Control Plane or Data Source Service database or connector code.

Do not add abstract interfaces with one implementation merely to imitate Clean Architecture. Introduce an interface only at a real process, storage, provider, or test boundary.

### 9.2 Shared Contracts

`packages/contracts` is the only package shared by the browser, CLI, Control Plane, Data Source Service, and Agent code. It contains:

- TypeBox request and response schemas.
- Dashboard Manifest schema.
- Data-source description schema.
- Query parameter and result schemas.
- Agent event schema.
- Runtime message schema.
- Stable error codes.

It contains no database client, filesystem access, business logic, secrets, or UI components.

### 9.3 Generated Source Boundary

The Coding Agent owns `src/**` and `public/**` in a dashboard workspace.

The platform owns:

- Build scripts.
- Dependency allowlist.
- Runtime SDK injection.
- Manifest validation.
- Sandbox and network policy.
- Published artifact handling.

The platform does not parse the component tree, choose controls, prescribe chart types, or rewrite generated source. The aesthetics Skill supplies guidance only.

### 9.4 No Direct Cross-Boundary Access

- Browser code never connects to PostgreSQL or Object Storage with permanent credentials.
- Generated dashboards never call data sources directly.
- Agent Runners never read Control Plane or Data Source credentials.
- The Control Plane never executes generated code or connects directly to managed Data Sources.
- The Data Source Service never reads Control Plane tables or Dashboard source.
- Public viewer requests never invoke Pi.

## 10. Domain Module Structure

Use pragmatic Domain-Driven Design inside each deployable:

```text
apps/control-plane/src/
├── server.ts
├── contexts/
│   ├── access/
│   ├── dashboards/
│   ├── agent-work/
│   ├── distribution/
│   └── runtime-delivery/
├── adapters/
└── shared/

apps/data-source-service/src/
├── server.ts
├── contexts/data-access/
├── connectors/
├── adapters/
└── shared/
```

Each context starts with small domain, command, query, PostgreSQL, and route modules as needed. Split files only when actual size or ownership makes the result clearer. Do not begin with repositories, services, factories, and controllers for every table.

The complete Context Map, aggregate boundaries, transaction rules, events, and target file structure are defined in `docs/domain-driven-design-structure.md`.

## 11. Metadata Model

The initial PostgreSQL model contains these core records:

```text
tenants
users
memberships

dashboards
draft_checkpoints
dashboard_revisions
publications
share_links

dashboard_query_bindings

agent_sessions
agent_jobs
agent_events

control_idempotency_keys
control_outbox
audit_events
```

Important ownership rules:

- Every tenant-owned row contains `tenant_id`.
- Every Dashboard Revision is immutable after validation begins.
- Every Publication points to one immutable Dashboard Revision.
- Every published Query Binding references one immutable Query Revision owned and validated by the Data Source Service API.
- Every Agent Job belongs to one Dashboard and one Agent Session.
- Agent Events are append-only and ordered within a Job.
- The Control Plane stores no Data Source secrets; the Data Source Service stores secret references rather than plaintext credentials.

The Data Source Service separately owns Data Sources, Config Revisions, Schema Revisions, Query Definitions, Query Revisions, health, source events, and source audits.

Use PostgreSQL foreign keys, unique constraints, and checks for invariants that the database can enforce. Do not duplicate those guarantees only in TypeScript.

## 12. Agent Job Dispatch and Lease

### 12.1 Job State

```text
queued → leased → running → succeeded
                    ├──────→ failed
                    └──────→ cancelled
```

A Job record includes:

- Job ID.
- Tenant, dashboard, and session IDs.
- User prompt reference.
- Base Dashboard Revision.
- State and attempt count.
- Lease owner and lease expiry.
- Cancellation timestamp.
- Created, started, and finished timestamps.
- Sanitized terminal error.

### 12.2 Dispatch and Claim

The Control Plane creates each Job and an outbox record in one PostgreSQL transaction. An internal dispatcher appends the Job ID to a Redis Stream after commit.

An `mda-agent` consumer receives the stream entry and calls the Control Plane to claim the Job. The Control Plane acquires a time-limited PostgreSQL lease. The Agent renews the lease by heartbeat and acknowledges the Redis entry only after terminal state is durable.

A crashed Agent does not permanently own a Job. Expired leases and Redis pending entries allow bounded recovery. PostgreSQL state and idempotency prevent a stale or duplicate Agent from publishing.

### 12.3 Idempotency

Creating an Agent Job accepts an idempotency key. Repeated browser submissions with the same key return the existing Job instead of starting duplicate Agent runs.

Publishing also requires an idempotency key because browser retries must not create multiple Publications.

### 12.4 Cancellation

Cancellation sets a durable flag in PostgreSQL and publishes a Redis wake-up. The active `mda-agent` verifies cancellation through the Control Plane, calls `session.abort()`, and terminates active subprocesses.

A cancelled Job cannot publish an artifact.

## 13. Agent Event Streaming

Use SSE rather than WebSocket initially:

```text
POST /api/dashboards/:id/messages → creates Agent Job
GET  /api/agent-jobs/:id/events   → SSE event stream
POST /api/agent-jobs/:id/cancel   → cancellation
```

Reasons for SSE:

- Agent events flow primarily from server to browser.
- User prompts and cancellation already fit ordinary HTTP requests.
- Native `ReadableStream` support is sufficient.
- Browser reconnection and `Last-Event-ID` are standardized.

`agent_events` is the durable event log. Each event has a monotonically increasing sequence within its Job.

The SSE endpoint:

1. Validates tenant and Job access.
2. Replays events after `Last-Event-ID`.
3. Waits for additional events.
4. Sends periodic keepalive comments.
5. Ends after the terminal event.

The Agent should coalesce very small text deltas before persistence to avoid one PostgreSQL row per token. Final messages and Tool state transitions remain authoritative.

Agent events are persisted in PostgreSQL before a lightweight Redis wake-up notification is published. SSE reconnect always replays durable events from PostgreSQL; Redis is latency optimization, not event history.

## 14. Pi Agent Runner

### 14.1 Session Creation

The Runner creates one `AgentSession` with:

- A job-specific `cwd`.
- A job-specific session directory.
- Explicit model selection.
- Explicit `ResourceLoader`.
- Platform-maintained aesthetics Skill.
- Platform-maintained custom Tools.
- An explicit Tool allowlist.
- Controlled settings for retry and compaction.

The default host `~/.pi/agent` must not be mounted into the Runner.

### 14.2 Tool Set

Initial custom Tools:

```text
list_data_sources
describe_data_source
query_data_source
register_query
test_query
validate_dashboard
build_preview
publish_dashboard
```

File access is restricted to the dashboard workspace. Raw `bash` is available only inside the isolated Runner and must have network and filesystem restrictions. Prefer purpose-built build and validation Tools for repeatable operations.

### 14.3 Event Mapping

Pi events are translated into stable platform events:

```text
agent.started
assistant.delta
assistant.completed
tool.started
tool.updated
tool.completed
build.started
build.completed
preview.ready
revision.saved
agent.failed
agent.completed
```

The browser consumes platform events rather than depending directly on Pi's internal event types. The Runner still stores the original Pi Session JSONL for resume and debugging.

### 14.4 Session Persistence

When an Agent settles:

1. Flush the Session JSONL.
2. Upload it to Object Storage.
3. Record its object key and Pi session ID.
4. Save a recoverable Draft Checkpoint when files changed.
5. Promote the checkpoint to an immutable Dashboard Revision only on explicit save or publish preparation.
6. Dispose the `AgentSession`.
7. Exit the Runner.

A resumed Job restores the previous source snapshot and Session before prompting.

## 15. Dashboard Build Architecture

The dashboard template uses TypeScript and Vite and is installed with Bun.

The build contract is:

```bash
bun run build
```

The Agent controls `src/**` and may use any component structure or browser rendering technique supported by the approved dependencies.

The template provides only:

- Vite entry and build configuration.
- TypeScript configuration.
- Dashboard Runtime SDK.
- Approved dependencies.
- Basic reset styles if useful.
- Build and validation scripts.

The template does not provide a required component tree or layout DSL.

The aesthetics Skill guides visual quality. It does not override the Agent's component choices.

## 16. Preview Architecture

```text
Agent edits source
  → build_preview Tool
  → bun run build
  → upload immutable preview bundle
  → return preview revision URL
  → management UI refreshes isolated iframe
```

The preview iframe runs on a separate origin. The host and iframe communicate through the Dashboard Runtime message protocol.

The iframe receives no permanent token. For data queries:

1. The iframe sends a Runtime query message to the host.
2. The host validates the iframe origin and message schema.
3. The host calls the Control Plane with the editor's authenticated session.
4. The Control Plane validates the Preview Revision and Query Binding.
5. The result returns through the host to the iframe.

The preview origin uses a strict CSP and allows network access only where the Runtime implementation requires it. Preview queries use live data by default; changing source rows appears on the next query or watcher refresh without rebuilding the Preview bundle.

## 17. Publishing Architecture

Publishing is an immutable operation:

```text
Draft source snapshot
  → validate Manifest and Query Bindings
  → clean Bun install from lockfile/template
  → bun run build
  → browser smoke test
  → upload immutable artifact
  → create Publication transactionally
```

Publishing never builds from an unrecorded mutable workspace. It builds from a saved Dashboard Revision.

A Publication records:

- Dashboard Revision.
- Template and Runtime versions.
- Manifest digest.
- Query Revision bindings.
- Build artifact key and digest.
- Publisher and timestamp.
- Validation result.

A share link points to a Publication, not to the current Draft. The Publication pins code and Query Revisions, but each authorized runtime execution reads current source data. Data refresh never creates a new Publication.

## 18. Runtime Data Architecture

The Data Gateway remains presentation-neutral:

```text
Generated src
  → dashboard.query() or dashboard.watch()
  → Viewer Host
  → Control Plane Runtime endpoint
  → authorization and pinned Query Revision
  → read-only live data source
  → rows, freshness metadata, and structured errors
```

`dashboard.query()` performs a one-time request. `dashboard.watch()` provides polling-based automatic refresh with cancellation, no-overlap behavior, visibility pause, focus refresh, and bounded retry.

The Control Plane enforces minimum refresh intervals, query concurrency, timeout, result size, and cache isolation. Authorization is repeated for every manual or automatic refresh.

It returns data, column metadata, freshness, cache and truncation state, and structured errors. It never returns component, chart, control, or layout instructions.

The Coding Agent decides which data refreshes, the requested interval, how every result is presented, and how loading, refreshing, stale, and failure states behave. The complete contract is defined in `docs/live-data-and-refresh-contract.md`.

## 19. Authentication and Tenant Isolation

Use an external OIDC provider. The Control Plane validates signed tokens through the provider's JWKS endpoint and derives:

- User identity.
- Tenant membership.
- Roles.
- Session expiry.

Every public API operation establishes tenant context before reading or writing tenant data.

Use PostgreSQL constraints and tenant-scoped SQL for all metadata. PostgreSQL Row-Level Security may be added as defense in depth once the tenant transaction context is implemented consistently; application authorization remains mandatory.

Internal Agent Runner calls use short-lived, job-scoped credentials that allow only:

- Reading authorized data-source descriptions.
- Running design-time queries for the assigned dashboard.
- Registering queries for the assigned dashboard.
- Writing events for the assigned Job.
- Saving artifacts for the assigned Dashboard Revision.

## 20. Secrets

Store only secret references in PostgreSQL.

Production secrets belong in the deployment platform's secret manager. Local development uses ignored environment files or local secret storage.

Secret categories:

- OIDC configuration.
- Model provider credentials.
- Data-source credentials.
- Object-storage credentials.
- Internal signing keys.

Generated source, Pi prompts, Tool results, Agent events, build logs, and published artifacts must never contain these values.

## 21. Configuration

Configuration is loaded once at process startup and validated with TypeBox.

Required categories:

```text
HTTP bind address and public origins
PostgreSQL URL
Object-storage endpoint and bucket
OIDC issuer and audience
Internal service signing configuration
Agent model and Pi settings
Workspace and execution limits
Preview and published origins
```

Invalid configuration fails startup. Do not defer missing configuration errors until the first request.

## 22. Observability

Start with structured JSON logs written to stdout.

Every log record should include relevant identifiers:

```text
requestId
tenantId
userId
dashboardId
revisionId
jobId
sessionId
queryId
```

Never log credentials, raw authorization headers, or unredacted sensitive query parameters.

Initial metrics:

- HTTP request count and latency.
- Active and queued Agent Jobs.
- Agent Job duration and failure count.
- Model token usage and cost.
- Build duration and failure count.
- Query duration, timeout count, and row count.
- Automatic refresh count, throttling, retry, and cache-hit ratio.
- SSE connection count.

Add a full OpenTelemetry pipeline only when there is an actual collector and operational need. Structured logs and database audit records are sufficient for the first deployment.

## 23. Error Handling

Every API error uses a stable machine-readable code and a safe human-readable message.

```ts
interface ApiError {
  code: string;
  message: string;
  requestId: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

Rules:

- Validation errors return field-level details.
- Permission errors do not reveal resource existence across tenants.
- Agent and build failures preserve detailed diagnostics for the authorized editor.
- Public viewers receive sanitized errors.
- Database and source stack traces remain server-side.
- Retried commands use idempotency keys.

## 24. Testing Strategy

### 24.1 Unit Tests

Use `bun test` for:

- Contract validation.
- Dashboard and Query lifecycle transitions.
- Authorization decisions.
- Runtime message validation.
- Event mapping.
- Error sanitization.

### 24.2 Integration Tests

Use disposable PostgreSQL, Redis, MinIO, HTTP fixture, and JDBC Runner instances for:

- Independently owned SQL migrations and constraints.
- Redis Stream dispatch, PostgreSQL leases, and crash recovery.
- Durable event ordering, Redis wake-ups, and SSE replay.
- HTTP and JDBC Source management, descriptions, and read-only queries.
- Revision snapshots and publication artifacts.

### 24.3 Pi SDK Compatibility Test

The pinned Bun and Pi versions must pass:

- SDK import.
- Session creation and disposal.
- Custom Tool registration and execution.
- Event streaming.
- Abort handling.
- Session persistence and resume.
- One dashboard build through the Agent Runner.

### 24.4 Browser Tests

Use Playwright for:

- OIDC-authenticated management flow using a test issuer or fixture.
- Chat event rendering and SSE reconnection.
- Preview iframe isolation.
- Runtime query and watcher bridge.
- Source-row updates appearing without Preview or Publication rebuilds.
- Visibility pause, focus refresh, and access revocation between refreshes.
- Dashboard build rendering.
- Publishing and fixed-revision share links.
- CSP and prohibited-network checks.

## 25. Local Development

Docker Compose is the canonical full-stack deployment and integration environment:

```text
mda-main
mda-agent
mda-datasource
mda-jdbc-runner
PostgreSQL
Redis
MinIO
optional local OIDC test provider
```

Developers may run TypeScript applications with Bun on the host for faster inner-loop iteration:

```bash
bun install
bun run db:migrate
bun run dev
```

The Agent Runner should still execute in its container during integration tests because host execution does not validate the real security boundary.

Provide one seed command that creates:

- A development tenant and user mapping.
- One sample HTTP Data Source and one JDBC test Data Source.
- A small sales schema and fixture HTTP API.
- One empty dashboard.

## 26. Production Deployment

Initial production topology:

```text
mda-main management image
mda-agent independent Coding Agent image
mda-datasource standalone Data Source image
mda-jdbc-runner isolated JDBC image
PostgreSQL
Redis
S3-compatible Object Storage
External OIDC provider
```

Docker Compose is the first deployment controller. It can scale Agent workers on one host with `docker compose up -d --scale agent=N`.

Scale independently only where needed:

- Main replicas for HTTP and SSE load when an external load balancer is added.
- Agent replicas for generation workloads.
- Data Source Service for connector and query load.
- PostgreSQL, Redis, and Object Storage through managed scaling.

The complete network, secret, image, queue, and failure design is defined in `docs/docker-compose-deployment-architecture.md`.

## 27. Implementation Order

### Phase 1: Foundation

1. Create Bun workspace and strict TypeScript configuration.
2. Add `contracts`, Control Plane, Web, CLI, Data Source Service, and Agent workspaces.
3. Add independently owned PostgreSQL migrations and Bun SQL access.
4. Add Redis Streams and transactional outbox dispatch.
5. Add S3-compatible artifact storage.
6. Add Docker Compose, separate Main and Agent images, and shared error/configuration schemas.

### Phase 2: Agent Vertical Slice

1. Create a dashboard and Agent Job.
2. Run Pi SDK inside the independent `mda-agent` image.
3. Dispatch through Redis Streams and persist events in PostgreSQL before SSE notification.
4. Generate source from the fixed template.
5. Build a preview with Bun and Vite.
6. Render the preview in the isolated iframe.

### Phase 3: Data Vertical Slice

1. Create and manage one HTTP Source and one JDBC Source through the standalone service.
2. Implement connector-neutral source description.
3. Add Agent exploration and query registration Tools.
4. Bind a Query Revision to a Dashboard Revision.
5. Execute it through `dashboard.query()`.
6. Add polling-based `dashboard.watch()` and verify source-row changes appear without rebuilding.

### Phase 4: Publish and Share

1. Save immutable Dashboard Revisions.
2. Validate from a clean snapshot.
3. Publish immutable build artifacts.
4. Add authenticated share links.
5. Add authenticated live sharing, explicitly approved public-live queries, and clearly labeled optional snapshots.

### Phase 5: Hardening

1. Complete sandbox filesystem and network policy.
2. Add cancellation and lease recovery tests.
3. Add credential-redaction tests.
4. Add browser security tests.
5. Add backup and restore procedures.

## 28. Architecture Acceptance Criteria

The architecture is acceptable when:

1. All core application and management code is TypeScript executed or built with Bun; the JVM is isolated to the JDBC interoperability image required by JDBC.
2. The direct Pi SDK path passes under the pinned Bun version.
3. The public Control Plane cannot execute generated code.
4. Each Agent Job runs in an isolated environment with one workspace.
5. The Agent cannot access data-source credentials.
6. Generated dashboards cannot query data sources directly.
7. Published viewers never invoke Pi.
8. Agent events survive browser reconnects.
9. Dashboard and Query Revisions are immutable once published.
10. The standalone Data Source Service describes data without describing components and owns HTTP/JDBC connector execution.
11. The aesthetics Skill guides appearance without defining a component schema.
12. The Coding Agent retains full control over `src/**` and `public/**`.
13. The system uses PostgreSQL as authority and Redis for Streams, notifications, bounded coordination, and optional cache without requiring Kafka, Kubernetes, an ORM, or a low-code DSL.
14. The `mda` CLI reaches feature parity through the same Control Plane API and stable event contracts used by the web client.
15. Published Dashboards refresh current authorized data without invoking Pi, rebuilding, or creating source Revisions.
16. `mda-main` and `mda-agent` are separate images with separate credentials, networks, and responsibilities.
17. Docker Compose starts the complete PostgreSQL, Redis, Object Storage, Data Source, Main, JDBC, and Agent topology.
18. Control Plane and Data Source Service own separate persistence and communicate only through versioned contracts.
19. Every authoritative record has one Bounded Context owner, and domain transitions have no infrastructure dependencies.
