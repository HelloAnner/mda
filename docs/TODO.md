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

## Next

Continue the authoritative authoring and Agent Job path:

- [ ] Add Data Source Service PostgreSQL migrations and its separate database role.
- [ ] Add the Draft Checkpoint and Dashboard Revision contracts and migrations.
- [ ] Implement immutable source artifact references and Query Bindings.
- [ ] Add Agent Session and Agent Job contracts.
- [ ] Implement the Agent Job lease and fencing-token domain transitions.
- [ ] Persist Agent Job creation with idempotency and a transactional outbox event.
- [ ] Dispatch queued Agent Jobs through Redis Streams.
- [ ] Add durable Agent Event append and SSE replay.

## Not Done

### Foundation and boundaries

- [ ] Management Web workspace and React/Vite application.
- [ ] Data Source Service workspace and runnable service.
- [ ] Agent workspace and runnable worker.
- [ ] Dashboard Runtime and Dashboard Template packages.
- [ ] Versioned Dashboard, Session, Job, Agent Event, Data Access, Runtime, and integration-event contracts.
- [ ] OIDC login flows and tenant/role administration beyond token and membership validation.
- [ ] Production secret-file loading.
- [ ] Remaining PostgreSQL schemas, migrations, constraints, and separate service roles.
- [ ] Idempotency, audit, and transactional outbox primitives.
- [ ] Redis Streams, event wake-ups, and outbox dispatch.
- [ ] S3/MinIO artifact storage.
- [ ] Import-boundary test between workspaces and services.

### Dashboard authoring and Agent work

- [ ] Dashboard metadata CRUD and archive behavior.
- [ ] Draft Checkpoints and immutable Dashboard Revisions.
- [ ] Query Bindings owned by Dashboard Revisions.
- [ ] Agent Sessions and resumable Pi Session artifacts.
- [ ] Agent Job state machine, leases, fencing tokens, cancellation, and recovery.
- [ ] Durable ordered Agent Events and SSE replay.
- [ ] Independent Redis-consuming `mda-agent` image.
- [ ] Pi SDK integration pinned to the reviewed version.
- [ ] Explicit Pi `ResourceLoader`, Tool allowlist, Skills, and workspace restrictions.
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
- [ ] Dashboard generation and continuous chat.
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
bun install
bun run db:migrate
bun run typecheck
bun run lint
bun test
bun run dev
bun run mda --help
bun run mda doctor
```
