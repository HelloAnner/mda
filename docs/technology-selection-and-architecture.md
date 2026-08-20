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
| Metadata database | PostgreSQL | Transactions, constraints, JSONB, job leasing, auditing, and mature operations |
| Database client | Bun's built-in SQL client | Pooling and parameterized SQL without an ORM or generated client |
| Artifact storage | S3-compatible Object Storage through Bun's S3 client | Immutable source snapshots, sessions, previews, and published bundles |
| Local object storage | MinIO | Local S3 compatibility without changing application code |
| Coding Agent | `@earendil-works/pi-coding-agent` SDK | Full AgentSession, Tools, Skills, events, compaction, and session support |
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
- Redis.
- Kafka or another message broker.
- Kubernetes-specific libraries.
- A dependency-injection container.
- A server framework around `Bun.serve`.
- GraphQL.
- A frontend global-state framework.
- A monorepo orchestrator such as Nx or Turborepo.
- A component DSL or visual page builder.

PostgreSQL, Bun workspaces, native Fetch/Web Streams, and small domain modules cover the initial requirements.

## 6. Logical Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Clients                                                      │
│                                                              │
│ Browser: Management UI / Viewer Host / Preview shell         │
│ mda CLI: commands / chat / events / diagnostics / export     │
└───────────────────────┬──────────────────────────────────────┘
                        │ HTTPS: REST + SSE
┌───────────────────────▼──────────────────────────────────────┐
│ Bun Control Plane                                            │
│                                                              │
│ Auth            Dashboard lifecycle       Agent job API      │
│ Data Gateway    Query registry             Publish/share      │
│ SSE replay      Runtime message bridge     Audit              │
└───────────────┬───────────────────┬───────────────────────────┘
                │                   │
          PostgreSQL          S3-compatible storage
                │                   │
                │             source/session/build artifacts
                │
┌───────────────▼──────────────────────────────────────────────┐
│ Bun Agent Controller                                         │
│ Claims jobs, leases work, starts isolated Agent Runners       │
└───────────────┬──────────────────────────────────────────────┘
                │ one isolated execution environment per job
┌───────────────▼──────────────────────────────────────────────┐
│ Bun Agent Runner + Pi SDK                                    │
│ Controlled workspace, explicit Skill, allowlisted Tools       │
│ Generates src, tests, builds, validates, snapshots            │
└───────────────┬──────────────────────────────────────────────┘
                │ scoped internal HTTPS only
┌───────────────▼──────────────────────────────────────────────┐
│ Data Gateway endpoints in the Control Plane                  │
│ Credentials and authorized read-only source execution         │
└──────────────────────────────────────────────────────────────┘
```

The Data Gateway is a logical module inside the Control Plane for the first version. It is not a separate network service until independent scaling or network isolation requires it.

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

The production build is static and may be served by the Control Plane or a CDN. It contains no database credentials, model credentials, or data-source credentials.

### 7.2 mda CLI

A Bun-compiled TypeScript client that provides complete, scriptable access to the same Control Plane operations as the web UI, including continuous conversations, raw event streams, Tool and error inspection, simulations, and artifact export.

The CLI contains presentation and client concerns only. It does not connect directly to Pi, PostgreSQL, Object Storage, or data sources. Its complete command and interaction contract is defined in `docs/mda-cli-design.md`.

### 7.3 Control Plane

A Bun service built on `Bun.serve` that owns:

- Authentication and tenant context.
- Dashboard, Revision, Publication, and Share Link lifecycles.
- Data-source descriptions and Query Revisions.
- Data Gateway runtime execution.
- Agent job creation, cancellation, and status.
- SSE event replay.
- Object-storage metadata and signed artifact access.
- Audit records.

The Control Plane never executes generated dashboard code and never gives its data-source credentials to the Agent Runner.

### 7.4 Agent Controller

A Bun process that:

- Claims queued Agent Jobs from PostgreSQL.
- Acquires a time-limited lease.
- Starts an isolated Agent Runner.
- Sends only job-scoped configuration and credentials.
- Renews the lease while the Runner is healthy.
- Requests cancellation when a job is cancelled.
- Records terminal job state when the Runner exits.

The Agent Controller is separate from the public Control Plane so the web-facing process never needs container-launch privileges.

### 7.5 Agent Runner

An ephemeral Bun execution environment containing:

- Pi SDK.
- The approved dashboard template and dependencies.
- Platform-maintained Skills.
- Platform-maintained custom Tools.
- One dashboard workspace.
- Build and validation commands.

One Runner handles one Agent Job and then exits. It does not retain another tenant's workspace or credentials.

### 7.6 PostgreSQL

PostgreSQL stores transactional metadata, job state, and durable event cursors. It does not store large source archives or built bundles.

### 7.7 Object Storage

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
│   ├── control-plane/        # Bun HTTP API, SSE, Data Gateway
│   ├── agent-controller/     # Job leasing and Runner orchestration
│   └── agent-runner/         # Pi SDK integration and Tool execution
├── packages/
│   ├── contracts/            # TypeBox schemas and shared API types
│   ├── dashboard-runtime/    # iframe/runtime API used by generated src
│   └── dashboard-template/   # Fixed build shell; Agent owns src
├── skills/
│   └── dashboard-aesthetics/ # Design guidance, no component restrictions
├── migrations/               # Ordered PostgreSQL SQL migrations
├── docs/
└── package.json
```

Do not create a package for every domain concept. Keep dashboard, query, publication, and job logic as modules inside the Control Plane until another deployable unit genuinely needs to import them.

## 9. Architecture Control Rules

These rules prevent architecture drift without limiting generated dashboard code.

### 9.1 Dependency Direction

```text
HTTP routes / job handlers
  → domain functions
  → database and storage functions
```

- HTTP routes parse input, establish tenant context, authorize, and call domain functions.
- Domain functions implement lifecycle and transaction rules.
- Database functions contain SQL.
- Storage functions contain S3 operations.
- Agent Tools call internal Control Plane APIs; they do not import Control Plane database code.

Do not add abstract interfaces with one implementation merely to imitate Clean Architecture. Introduce an interface only at a real process, storage, provider, or test boundary.

### 9.2 Shared Contracts

`packages/contracts` is the only package shared by the browser, CLI, Control Plane, and Agent code. It contains:

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
- Agent Runners never read Control Plane database credentials.
- The Control Plane never executes generated code.
- Public viewer requests never invoke Pi.

## 10. Control Plane Module Structure

Keep the service modular without introducing a framework-heavy layer hierarchy:

```text
apps/control-plane/src/
├── server.ts
├── auth/
├── dashboards/
├── revisions/
├── publications/
├── data-sources/
├── queries/
├── agent-jobs/
├── events/
├── runtime/
├── audit/
├── db/
└── storage/
```

Each domain directory may contain:

- Route definitions.
- TypeBox schemas specific to the domain.
- Plain TypeScript domain functions.
- SQL functions when they remain small.

Split SQL into `db/` only when sharing or file size makes that simpler. Do not begin with repositories, services, factories, and controllers for every table.

## 11. Metadata Model

The initial PostgreSQL model contains these core records:

```text
tenants
users
memberships

dashboards
dashboard_revisions
publications
share_links

data_sources
query_definitions
query_revisions
dashboard_query_bindings

agent_sessions
agent_jobs
agent_events

audit_events
```

Important ownership rules:

- Every tenant-owned row contains `tenant_id`.
- Every Dashboard Revision is immutable after validation begins.
- Every Publication points to one immutable Dashboard Revision.
- Every published Query Binding points to one immutable Query Revision.
- Every Agent Job belongs to one Dashboard and one Agent Session.
- Agent Events are append-only and ordered within a Job.
- Secrets are represented by secret references, not plaintext credential columns.

Use PostgreSQL foreign keys, unique constraints, and checks for invariants that the database can enforce. Do not duplicate those guarantees only in TypeScript.

## 12. Agent Job Controller

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

### 12.2 Claiming Work

The Agent Controller claims work using a short PostgreSQL transaction and `FOR UPDATE SKIP LOCKED`. The lease has an expiry and is renewed by heartbeat.

A crashed controller does not permanently own a Job. An expired Job may be reclaimed only if its previous Runner is confirmed dead or isolated.

### 12.3 Idempotency

Creating an Agent Job accepts an idempotency key. Repeated browser submissions with the same key return the existing Job instead of starting duplicate Agent runs.

Publishing also requires an idempotency key because browser retries must not create multiple Publications.

### 12.4 Cancellation

Cancellation sets a durable flag in PostgreSQL. The Agent Controller forwards it to the Runner, and the Runner calls `session.abort()` and terminates active subprocesses.

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

The Agent Runner should coalesce very small text deltas before persistence to avoid one PostgreSQL row per token. Final messages and Tool state transitions remain authoritative.

PostgreSQL polling is sufficient initially. `LISTEN/NOTIFY` may later reduce latency but is only a wake-up optimization; durable events remain in the table.

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
4. Snapshot the workspace when a Revision is saved.
5. Dispose the `AgentSession`.
6. Exit the Runner.

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

The preview origin uses a strict CSP and allows network access only where the Runtime implementation requires it.

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

A share link points to a Publication, not to the current Draft.

## 18. Runtime Data Architecture

The Data Gateway remains presentation-neutral:

```text
Generated src
  → dashboard.query(logicalName, parameters)
  → Viewer Host
  → Control Plane Runtime endpoint
  → authorized Query Revision
  → read-only data source
  → structured rows and metadata
```

It returns data, column metadata, truncation state, and structured errors. It never returns component, chart, control, or layout instructions.

The Coding Agent decides how every result is presented and how every control behaves.

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

Use disposable PostgreSQL and MinIO instances for:

- SQL migrations and constraints.
- Job claiming and lease recovery.
- Event ordering and SSE replay.
- Source descriptions and read-only queries.
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
- Runtime query bridge.
- Dashboard build rendering.
- Publishing and fixed-revision share links.
- CSP and prohibited-network checks.

## 25. Local Development

Use Docker Compose only for infrastructure:

```text
PostgreSQL
MinIO
optional local OIDC test provider
```

Run TypeScript applications with Bun on the host for fast iteration:

```bash
bun install
bun run db:migrate
bun run dev
```

The Agent Runner should still execute in its container during integration tests because host execution does not validate the real security boundary.

Provide one seed command that creates:

- A development tenant and user mapping.
- One sample PostgreSQL data source.
- A small sales schema.
- One empty dashboard.

## 26. Production Deployment

Initial production topology:

```text
Static Web/CDN
Bun Control Plane replicas
Bun Agent Controller
Ephemeral Agent Runner containers
Managed PostgreSQL
S3-compatible Object Storage
External OIDC provider
```

Do not require Kubernetes for the first deployment. A container platform that can run a web service, a worker, and isolated jobs is sufficient.

Scale independently only where needed:

- Control Plane replicas for HTTP and SSE load.
- Agent Controller capacity for concurrent jobs.
- Agent Runner count for generation workloads.
- PostgreSQL and Object Storage through managed scaling.

The Data Gateway becomes a separate service only if source network placement, query load, or credential isolation requires it.

## 27. Implementation Order

### Phase 1: Foundation

1. Create Bun workspace and strict TypeScript configuration.
2. Add `contracts`, Control Plane, Web, CLI, and Agent Runner workspaces.
3. Add PostgreSQL migrations and Bun SQL access.
4. Add S3-compatible artifact storage.
5. Add shared error and configuration schemas.

### Phase 2: Agent Vertical Slice

1. Create a dashboard and Agent Job.
2. Run Pi SDK inside an isolated Bun Agent Runner.
3. Stream events through PostgreSQL and SSE.
4. Generate source from the fixed template.
5. Build a preview with Bun and Vite.
6. Render the preview in the isolated iframe.

### Phase 3: Data Vertical Slice

1. Register one PostgreSQL source.
2. Implement source description.
3. Add Agent exploration and query registration Tools.
4. Bind a Query Revision to a Dashboard Revision.
5. Execute it through `dashboard.query()`.

### Phase 4: Publish and Share

1. Save immutable Dashboard Revisions.
2. Validate from a clean snapshot.
3. Publish immutable build artifacts.
4. Add authenticated share links.
5. Add public snapshot or explicitly public-query sharing.

### Phase 5: Hardening

1. Complete sandbox filesystem and network policy.
2. Add cancellation and lease recovery tests.
3. Add credential-redaction tests.
4. Add browser security tests.
5. Add backup and restore procedures.

## 28. Architecture Acceptance Criteria

The architecture is acceptable when:

1. All first-party application code is TypeScript executed or built with Bun.
2. The direct Pi SDK path passes under the pinned Bun version.
3. The public Control Plane cannot execute generated code.
4. Each Agent Job runs in an isolated environment with one workspace.
5. The Agent cannot access data-source credentials.
6. Generated dashboards cannot query data sources directly.
7. Published viewers never invoke Pi.
8. Agent events survive browser reconnects.
9. Dashboard and Query Revisions are immutable once published.
10. The Data Gateway describes data without describing components.
11. The aesthetics Skill guides appearance without defining a component schema.
12. The Coding Agent retains full control over `src/**` and `public/**`.
13. The system operates without Redis, Kafka, Kubernetes, an ORM, or a low-code DSL in the first version.
14. The `mda` CLI reaches feature parity through the same Control Plane API and stable event contracts used by the web client.
