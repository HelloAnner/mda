# MDA Implementation TODO

Last updated: 2026-08-21

This file tracks implementation status. The detailed contracts and architecture in `docs/` remain the source of truth.

## Done

### Design

- [x] Define the Pi-based dashboard generation architecture.
- [x] Select TypeScript, Bun, React/Vite, PostgreSQL, Redis, S3/MinIO, and Docker Compose.
- [x] Define DDD boundaries, aggregate ownership, transaction rules, and dependency direction.
- [x] Define Dashboard artifact, Data Gateway, live refresh, Data Source, CLI, and deployment contracts.
- [x] Define the separation between `mda-main`, `mda-agent`, `mda-datasource`, and the JDBC Runner.

### Runnable foundation

- [x] Create the Bun workspace and commit `bun.lock`.
- [x] Pin Bun `1.3.14` in `package.json`.
- [x] Enable strict TypeScript checking.
- [x] Add Biome formatting and linting.
- [x] Create `packages/contracts` with TypeBox schemas for service metadata, health, and API errors.
- [x] Create a minimal `mda-main` Control Plane using `Bun.serve`.
- [x] Add `/api/meta`, `/health/live`, and `/health/ready`.
- [x] Return the shared API error contract for unknown routes.
- [x] Create the `mda` CLI with help, version, and `doctor` commands.
- [x] Validate Control Plane metadata in `mda doctor` through the shared TypeBox contract.
- [x] Add contract and HTTP tests.
- [x] Verify `bun run typecheck`, `bun run lint`, and `bun test`.

### First Dashboard slice

- [x] Validate required Control Plane startup configuration.
- [x] Validate OIDC access tokens and resolve tenant membership from PostgreSQL.
- [x] Add the first Control Plane migration and Bun SQL migration runner.
- [x] Add versioned Dashboard create, list, and show contracts.
- [x] Implement normalized tenant-unique Dashboard creation.
- [x] Persist Dashboard, idempotency, audit, and outbox records transactionally.
- [x] Add authenticated Dashboard create, list, and show APIs.
- [x] Add `mda dashboard create`, `list`, and `show` commands.
- [x] Add a PostgreSQL integration check for idempotency, constraints, auditing, outbox records, and tenant isolation.

### Deployment and Agent configuration

- [x] Add deployment-wide `mda.toml` host, port, OIDC, database, Agent lease, and model configuration.
- [x] Keep access passwords, internal tokens, and model API keys in environment/file references rather than TOML plaintext.
- [x] Add a deployment access-password gate for public APIs and CLI forwarding.
- [x] Allow HTTP model and application endpoints for local/private deployments; require an HTTPS proxy for public Internet access.
- [x] Add the Agent-owned loader for model provider, model ID, base URL, and API key resolution.

### Agent Job authority

- [x] Add versioned Agent Session, Agent Job, claim, lease, and settlement contracts.
- [x] Add Agent Session and Agent Job migrations and active-Session constraints.
- [x] Implement pure claim, start, heartbeat, settlement, cancellation, fencing, and expired-lease recovery transitions.
- [x] Persist idempotent Agent Job creation with audit and transactional outbox records.
- [x] Add authenticated message submission and Job read/cancel APIs.
- [x] Add internal claim, start, heartbeat, and settlement APIs with service-token authentication.
- [x] Verify stale fencing-token rejection through PostgreSQL integration tests.

### Core Coding Agent chat

- [x] Dispatch queued Jobs from the PostgreSQL outbox through Redis Streams.
- [x] Run an independent Redis-consuming `mda-agent` worker with one Job at a time.
- [x] Import `@earendil-works/pi-coding-agent` `0.84.2` as an SDK dependency; no global Pi process or simulated CLI.
- [x] Create or restore one independent Pi `AgentSession` and SessionManager file per MDA Session.
- [x] Configure the OpenAI-compatible model endpoint and Agent-only API key from `mda.toml` references.
- [x] Use an explicit empty ResourceLoader and a file-tool allowlist.
- [x] Persist coalesced Agent events and replay them through SSE.
- [x] Add continuous `mda chat <dashboard-id>` with multi-turn Session continuity.
- [x] Deploy PostgreSQL 17.4, Redis 7.4, Main, and one Agent worker locally.
- [x] Verify a real LLM chat, multi-turn memory, Tool events, and a Coding Agent file write through the deployed CLI.

## Next

Continue the authoritative authoring and Agent Job path:

- [ ] Add immutable Draft Checkpoints and Dashboard Revisions with artifact references and Query Bindings.
- [ ] Move local Pi Session and workspace snapshots to S3/MinIO before adding Agent replicas.
- [ ] Add the fixed React/Vite Dashboard Template and build/preview Tools.
- [ ] Add the expired-lease recovery sweep and Redis pending-entry reclaim.
- [ ] Add cancellation wake-ups that abort an active Pi Session immediately instead of on heartbeat.
- [ ] Add Data Source Service PostgreSQL migrations and its separate database role.

## Not Done

### Foundation and boundaries

- [ ] Management Web workspace and React/Vite application.
- [ ] Data Source Service workspace and runnable service.
- [ ] Hardened Agent image; the host-deployed worker is runnable.
- [ ] Dashboard Runtime and Dashboard Template packages.
- [ ] Remaining Dashboard Revision, Agent Event, Data Access, Runtime, and integration-event contracts.
- [ ] OIDC login flows and tenant/role administration beyond token and membership validation.
- [ ] Production secret-file loading.
- [ ] Remaining PostgreSQL schemas, migrations, constraints, and separate service roles.
- [ ] Idempotency, audit, and transactional outbox primitives.
- [ ] Redis event wake-ups and pending-entry recovery; Streams and outbox dispatch now run.
- [ ] S3/MinIO artifact storage.
- [ ] Import-boundary test between workspaces and services.

### Dashboard authoring and Agent work

- [ ] Dashboard metadata CRUD and archive behavior.
- [ ] Draft Checkpoints and immutable Dashboard Revisions.
- [ ] Query Bindings owned by Dashboard Revisions.
- [ ] S3-backed Pi Session and workspace artifacts; local single-worker Session resume now works.
- [ ] Persisted expired-lease recovery, immediate cancellation wake-ups, and Redis reclaim.
- [x] Durable ordered Agent Events and SSE replay.
- [ ] Independent hardened `mda-agent` image; the host worker currently consumes Redis.
- [x] Pi SDK integration pinned to the reviewed version.
- [x] Explicit Pi `ResourceLoader` and file Tool allowlist; platform Skills remain to add.
- [ ] Agent Tools for source discovery, queries, validation, preview, and publishing.
- [ ] Workspace restore, checkpoint, build, upload, settlement, and cleanup flow.
- [ ] Preview build and isolated iframe rendering.

### Data Access

- [ ] Data Source CRUD, rename, configuration revisions, test, activation, enable, disable, delete, and restore.
- [ ] Secret-reference storage and resolution boundary.
- [ ] Presentation-neutral schema descriptions and health projection.
- [ ] HTTP JSON connector with SSRF, redirect, timeout, and size protections.
- [ ] Registered Queries and immutable Query Revisions.
- [ ] Signed execution grants from Main to Data Source Service.
- [ ] Runtime query execution, parameter binding, limits, auditing, and structured errors.
- [ ] Isolated JVM JDBC Runner and allowlisted drivers.
- [ ] Read-only parameterized JDBC execution and value normalization.

### Runtime, publishing, and sharing

- [ ] `dashboard.query()` Runtime API.
- [ ] `dashboard.watch()` polling, cancellation, no-overlap, visibility pause, focus refresh, and bounded retry.
- [ ] Viewer Host and validated iframe message protocol.
- [ ] Immutable Preview and Publication artifacts.
- [ ] Clean build, validation, and browser smoke-test pipeline.
- [ ] Authenticated, public-live, and snapshot Share Links.
- [ ] Authorization-safe query caching and invalidation, if load requires it.

### CLI and Web feature parity

- [ ] CLI contexts and OIDC login beyond `MDA_TOKEN` authentication.
- [ ] Dashboard generation with build/preview; continuous core chat now works.
- [ ] Session resume, fork, inspect, compact, and export.
- [ ] Job watch, event replay, cancellation, retry, Tool inspection, errors, logs, and statistics.
- [ ] Dashboard validation, preview, save, publish, and export.
- [ ] Source and Query commands.
- [ ] Simulation, audit, completion, and full deployment diagnostics.
- [ ] Management Web screens for the same Control Plane capabilities.

### Deployment and hardening

- [ ] Separate Main, Agent, Data Source, and JDBC Runner Dockerfiles.
- [ ] Complete Docker Compose topology with PostgreSQL, Redis, MinIO, networks, health checks, and secrets.
- [ ] Database migration and seed commands.
- [ ] Container filesystem, process, capability, and network hardening.
- [ ] Credential and sensitive-output redaction tests.
- [ ] Pi compatibility, integration, browser, security, cancellation, and recovery tests.
- [ ] Backup, restore, retention cleanup, metrics, and operational procedures.

## Current Commands

```bash
cp mda.example.toml mda.toml
bun install
bun run db:migrate
bun run typecheck
bun run lint
bun test
bun run dev
bun run agent
bun run mda --help
bun run mda chat <dashboard-id>
bun run mda doctor
```
