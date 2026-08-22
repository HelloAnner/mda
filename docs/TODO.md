# MDA Implementation TODO

Last updated: 2026-08-22

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
- [x] Run a bounded in-process Redis consumer pool; each worker handles one Job at a time.
- [x] Import `@earendil-works/pi-coding-agent` `0.84.2` as an SDK dependency; no global Pi process or simulated CLI.
- [x] Create or restore one independent Pi `AgentSession` and SessionManager file per MDA Session.
- [x] Configure the OpenAI-compatible model endpoint and Agent-only API key from `mda.toml` references.
- [x] Use an explicit restricted ResourceLoader, platform Skill root, and Coding Tool allowlist.
- [x] Add the layered Dashboard Skill system: three mandatory foundations, six presentation contexts, and fourteen industry know-how Skills without component or layout constraints.
- [x] Persist coalesced Agent events and replay them through SSE.
- [x] Add continuous `mda chat <dashboard-id>` with the Chinese-by-default Moss role, natural small talk, durable SSE reconnect, and multi-turn Session continuity.
- [x] Build separate non-root `mda-main:0.1.0` and `mda-agent:0.1.0` images.
- [x] Deploy PostgreSQL 17.4, Redis 7.4, one Main, and three Agent replicas with eight workers each through Compose.
- [x] Give every MDA Session validated, independent workspace/history/runtime paths.
- [x] Verify concurrent same-dashboard Sessions cannot overwrite each other's files.
- [x] Verify dozens-scale capacity plus real Chinese small talk, multi-turn memory, Bash/file Tools, Data Source refusal, and Coding Agent writes with the literal `mda` CLI.

### Source artifacts and Revisions

- [x] Add private MinIO-backed source artifact storage without giving S3 credentials to Agents.
- [x] Capture bounded, path-safe, content-addressed source snapshots after successful Agent edits.
- [x] Fence Checkpoint activation with the authoritative Job lease and Draft parent.
- [x] Restore the latest successful Checkpoint into new Session workspaces.
- [x] Add immutable, monotonic Dashboard Revisions with idempotency, audit, and outbox records.
- [x] Add Dashboard save plus Revision list, show, files, read, and deterministic `tar.gz` export CLI flows.
- [x] Verify cross-Session source continuity and Main/MinIO restart durability against `moss-dev-2`.

### Build validation and Previews

- [x] Add the platform-owned Vite build shell with an Agent-chosen `src/` entry and approved optional dependencies.
- [x] Add the Preview-only Dashboard Runtime boundary without a component, chart, layout, or source DSL.
- [x] Run clean, bounded builds in `mda-agent` subprocesses with sanitized environments and no package installation.
- [x] Add `validate_dashboard` and `build_preview` Moss Tools with durable build and validation events.
- [x] Add dedicated model-free Preview Jobs for active Checkpoints and immutable Revisions.
- [x] Persist content-addressed Preview bundles in MinIO and metadata in PostgreSQL.
- [x] Add expiring signed Preview URLs with path validation, strict CSP, MIME allowlisting, and sandboxing.
- [x] Add `mda dashboard preview` and verify desktop, 390px, token rejection, and restart durability against `moss-dev-2`.

### Publications

- [x] Add model-free, lease-fenced Publication Builds from explicit immutable Revisions.
- [x] Store immutable content-addressed Publication bundles and monotonic Publication metadata.
- [x] Reject declared Queries until immutable Query Revision bindings are available.
- [x] Add deterministic built-bundle export without source, Sessions, logs, tokens, or credentials.
- [x] Add Dashboard publish plus Publication list, show, and download CLI flows.
- [x] Verify publish, metadata, exact bundle download, and deployment durability against `moss-dev-2`.

### Public Share Links

- [x] Add opaque, digest-only, idempotent Share Link tokens bound to immutable Publications.
- [x] Add bounded expiry, final revocation, tenant-scoped metadata, audit, and outbox records.
- [x] Directly serve published `index.html` and relative assets from `/s/<token>/`.
- [x] Apply strict CSP, sandboxing, MIME allowlisting, path validation, no-referrer, and cache policy.
- [x] Add Share create, list, show, and revoke CLI flows.
- [x] Verify direct delivery, token tampering, digest-only storage, idempotency, and immediate revocation against `moss-dev-2`.

### HTTP Data Access and live Runtime

- [x] Add the independently deployed Bun Data Source Service, owned migrations, private API, audit, and events.
- [x] Add Data Source create, list, show, describe, rename, revisioned update, test, activate, enable, disable, soft delete, restore, and schema refresh flows.
- [x] Add bounded HTTP JSON execution with fixed-host policy, typed parameters, JSON Pointer rows, timeouts, size limits, redirect denial, and private-network opt-in.
- [x] Add immutable active registered Queries, public-execution approval, result schema inference, execution audit, and CLI management.
- [x] Add credential-free Moss source summaries plus list, describe, list-query, register-query, and test-query Tools.
- [x] Validate and pin Query Revisions into immutable Publications.
- [x] Add same-origin `dashboard.query()` and no-overlap `dashboard.watch()` runtime execution through public Share Links.
- [x] Verify current source-row changes appear after manual refresh without Agent work, rebuilding, or republishing.

## Next

Continue the backend distribution and data path:

- [x] Add the isolated JVM JDBC Runner with a checksum-pinned PostgreSQL driver.
- [ ] Move Pi Session history from the shared Agent volume to S3/MinIO before multi-host deployment.
- [x] Add the expired-lease recovery sweep and Redis pending-entry reclaim.
- [ ] Add Redis cancellation wake-ups; active Pi Sessions now abort through one-second authoritative cancellation polling.
- [ ] Add Data Source Service PostgreSQL migrations and its separate database role.

## Not Done

### Foundation and boundaries

- [ ] Management Web workspace and React/Vite application.
- [x] Data Source Service workspace and runnable service.
- [x] Separate non-root Main and Agent images with read-only container filesystems and dropped capabilities.
- [x] Fixed Dashboard Template and live public query/watch Runtime package.
- [ ] Remaining Dashboard Revision, Agent Event, Data Access, Runtime, and integration-event contracts.
- [ ] OIDC login flows and tenant/role administration beyond token and membership validation.
- [ ] Production secret-file loading.
- [ ] Remaining PostgreSQL schemas, migrations, constraints, and separate service roles.
- [ ] Idempotency, audit, and transactional outbox primitives.
- [ ] Redis event wake-ups; Streams, outbox dispatch, expired-lease recovery, and pending-entry reclaim now run.
- [x] Private S3/MinIO source artifact storage with persistent Compose volume and readiness checks.
- [ ] Import-boundary test between workspaces and services.

### Dashboard authoring and Agent work

- [x] Dashboard metadata create, list, show, optimistic update, and archive behavior.
- [x] Draft Checkpoints and immutable Dashboard Revisions.
- [x] Immutable Query Bindings owned by Publications; promote binding validation earlier into Dashboard Revision save when Query editing is added.
- [ ] S3-backed Pi Session history; source workspaces now restore from MinIO Checkpoints.
- [ ] Redis cancellation wake-ups; persisted expired-lease recovery, one-second cancellation polling, and Redis reclaim now work.
- [x] Durable ordered Agent Events and SSE replay.
- [x] Independently scalable `mda-agent` image consuming Redis Streams.
- [x] Pi SDK integration pinned to the reviewed version.
- [x] Explicit Pi `ResourceLoader`, Coding Tool allowlist, platform-maintained progressive Dashboard Skill catalog, and read-only Data Source summary prompt section.
- [x] Restrict Moss's business operations to Dashboard generation; Data Source management stays outside its Tool boundary.
- [ ] Agent publishing Tool; source discovery, registered Query, validation, and Preview Tools now work.
- [ ] Pi history upload and retention cleanup; source restore, Checkpoint upload, clean build, Preview upload, and fenced settlement now work.
- [x] Immutable Preview build and sandboxed browser rendering.

### Data Access

- [x] HTTP Data Source CRUD, rename, configuration revisions, test, activation, enable, disable, delete, restore, and schema refresh.
- [x] File-backed JDBC secret-reference resolution isolated to the Data Source Service and Runner channel.
- [x] Presentation-neutral administrator-declared schema descriptions and health projection.
- [x] HTTP JSON connector with host, private-address, redirect, timeout, and size protections.
- [x] Registered Queries and immutable first Query Revisions.
- [ ] Signed execution grants from Main to Data Source Service.
- [x] Runtime query execution, parameter binding, limits, auditing, and structured errors.
- [x] Isolated JVM JDBC Runner with an allowlisted PostgreSQL driver.
- [x] Read-only parameterized JDBC execution, DML/DDL rejection, limits, rollback, and value normalization.

### Runtime, publishing, and sharing

- [x] `dashboard.query()` Runtime API for public approved Query Bindings.
- [x] `dashboard.watch()` polling, cancellation, no-overlap, visibility pause, focus refresh, and bounded retry signaling.
- [ ] Viewer Host and validated iframe message protocol.
- [x] Immutable Preview and Publication artifacts.
- [ ] Clean build, validation, and browser smoke-test pipeline.
- [ ] Authenticated and snapshot Share Link modes; revocable public-live links with explicitly approved Queries now work.
- [ ] Authorization-safe query caching and invalidation, if load requires it.

### CLI and Web feature parity

- [ ] CLI contexts and OIDC login beyond `MDA_TOKEN` authentication.
- [x] Dashboard generation with fixed validation and Preview builds through Agent chat or model-free CLI Jobs.
- [ ] Session resume, fork, inspect, compact, and export.
- [ ] Job retry, Tool inspection, logs, and statistics; list, show, watch, durable replay, cancellation, and terminal errors now work.
- [ ] Complete combined export; validation, Preview, save, publication, source Revision export, and Publication bundle export now work.
- [x] HTTP Source and first immutable Query management commands.
- [ ] Simulation, audit, completion, and full deployment diagnostics.
- [ ] Management Web screens for the same Control Plane capabilities.

### Deployment and hardening

- [x] Separate Main, Agent, Data Source, and isolated JDBC Runner Dockerfiles.
- [x] Complete current Docker Compose topology with PostgreSQL, Redis, MinIO, Data Source, JDBC Runner, networks, health checks, and secrets.
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
docker compose --env-file .env.local up -d --build --scale agent=3
mda doctor
mda chat <dashboard-id>
mda dashboard preview <dashboard-id> [--revision <revision-id>]
mda dashboard save <dashboard-id> --message "First Revision"
mda dashboard publish <dashboard-id> --revision <revision-id>
mda publication list --dashboard <dashboard-id>
mda publication download <publication-id> --output dashboard-bundle.tar.gz
mda share create --publication <publication-id>
mda source add <http|jdbc> --name <name> --config source.json
mda source test <source-id>
mda source activate <source-id>
mda query register --config query.json
mda query test <query-id>
mda revision list --dashboard <dashboard-id>
mda revision files <revision-id>
mda revision export <revision-id> --output dashboard-source.tar.gz

bun run dev
bun run agent
bun run mda --help
bun run mda doctor
```
