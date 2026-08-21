# Docker Compose Deployment Architecture

## 1. Goal

MDA uses Docker Compose for its first complete deployment architecture.

The required deployment separates system management from Coding Agent execution:

```text
mda-main image       → system management and Control Plane
mda-agent image      → independent Coding Agent worker
```

The complete stack also includes the standalone Data Source module and its JDBC boundary:

```text
mda-datasource image
mda-jdbc-runner image
PostgreSQL
Redis
S3-compatible Object Storage
```

Core principle:

> The public management service never executes generated code, and the Coding Agent image never receives management-database or Data Source credentials.

## 2. Deployment Scope

Docker Compose is the initial single-host deployment target for:

- Local development.
- Product demonstrations.
- Integration testing.
- Small self-hosted installations.
- Initial production deployments that accept a single-host control plane.

Docker Compose is not a multi-host scheduler. High availability across machines requires a later container platform, but the image and service boundaries defined here must remain valid.

The Bounded Contexts, aggregates, and application module ownership inside these images are defined in `docs/domain-driven-design-structure.md`.

## 3. Images

### 3.1 `mda-main`

The management image contains:

- Bun runtime.
- Control Plane API.
- Compiled Management Web assets.
- Authentication and tenant management.
- Dashboard, Session, Job, Revision, Publication, and Share management.
- SSE endpoints.
- Query Binding validation.
- Redis outbox dispatcher and event fan-out.
- PostgreSQL migrations for Control Plane-owned tables.

It does not contain:

- Pi SDK execution.
- Generated dashboard build toolchains.
- Data Source credentials.
- JDBC drivers.
- Permission to launch arbitrary shell commands for users.

### 3.2 `mda-agent`

The independent Coding Agent image contains:

- Bun runtime.
- Pi SDK.
- Approved dashboard template dependencies.
- TypeScript and Vite build tools.
- Platform-maintained Skills.
- Platform-maintained custom Tools.
- Git, Bash, ripgrep, and required source utilities.
- Agent Job consumer.
- Workspace validation and build logic.

It does not contain:

- Control Plane PostgreSQL credentials.
- Data Source credentials.
- Direct access to HTTP or JDBC sources.
- Docker socket access.
- Host filesystem mounts.
- Host Pi configuration or credentials.

Each Agent container runs a configurable pool of Coding Agent workers (`MDA_AGENT_WORKERS`, bounded to 1–64). Every worker processes one Job at a time, while the container can multiplex many conversations concurrently. Each MDA Session owns a separate Pi `AgentSession`, history directory, and logical workspace on the shared single-host Agent volume.

Dashboard and Session IDs are validated as single path segments before these directories are resolved. Separate `workspace/`, `history/`, and `runtime/` subtrees prevent accidental file overlap but are not a security sandbox. The initial trusted single-host deployment intentionally defers hostile multi-tenant sandboxing; multi-host deployment requires moving Session snapshots to S3-compatible storage.

### 3.3 `mda-datasource`

The standalone Data Source image contains:

- Bun runtime.
- Data Source CRUD API.
- HTTP connector.
- JDBC connector client.
- Query and Schema Revision management.
- Runtime query execution.
- Health, audit, and event logic.
- Data Source Service migrations.

It is the only Bun service allowed to resolve Data Source secret references.

### 3.4 `mda-jdbc-runner`

The JDBC image contains:

- A minimal supported JVM.
- JDBC Runner protocol implementation.
- Allowlisted, pinned JDBC drivers.
- Bounded connection pooling.
- Read-only SQL execution.

It is reachable only from `mda-datasource` on the connector network.

### 3.5 Third-Party Images

```text
postgres                 authoritative metadata and durable state
redis                    job stream, wake-up events, distributed cache
minio                    S3-compatible source/session/build storage
```

Image versions are pinned. Do not use floating `latest` tags in a release deployment.

## 4. Service Topology

```text
                         HTTPS
                           │
                    ┌──────▼──────┐
                    │  mda-main   │
                    │ Web + API   │
                    └──┬──┬──┬───┘
                       │  │  │
            ┌──────────┘  │  └─────────────┐
            │             │                │
       PostgreSQL       Redis          MinIO/S3
            │             │                │
            │      Agent Job Stream        │ artifacts
            │             │                │
            │       ┌─────▼──────┐         │
            │       │ mda-agent  │─────────┘
            │       │ Pi SDK     │
            │       └────────────┘
            │
     ┌──────▼────────────┐
     │ mda-datasource    │
     │ HTTP/JDBC/query   │
     └──────┬────────────┘
            │
       ┌────▼────────────┐
       │ JDBC Runner     │
       └────┬────────────┘
            │
       SQL databases

mda-datasource ───────────────→ authorized remote HTTP APIs
```

Only `mda-main` exposes a public HTTP port.

## 5. PostgreSQL Responsibilities

PostgreSQL is the authoritative store.

### 5.1 Control Plane Ownership

The `mda-main` database role owns:

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

### 5.2 Data Source Ownership

The `mda-datasource` database role owns a separate database or schema:

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

Rules:

- Roles cannot read each other's tables.
- Migrations run independently.
- No cross-service foreign keys.
- Redis is never the sole copy of a Job, event, Revision, Query, or Data Source.

## 6. Redis Responsibilities

Redis is required in this Docker Compose architecture, but it is not the system of record.

Redis provides:

1. Agent Job delivery through Redis Streams.
2. Consumer groups for multiple `mda-agent` replicas.
3. Wake-up notifications for SSE event delivery.
4. Short-lived distributed coordination and rate counters.
5. Authorization-scoped runtime query caching when enabled.
6. Bounded idempotency and request-throttling acceleration.

Redis does not permanently own:

- Agent Job state.
- Agent event history.
- Dashboard source.
- Session JSONL.
- Data Source definitions.
- Query Revisions.
- Publications.

If Redis data is lost, PostgreSQL outboxes reconstruct required Job delivery and event notification state.

## 7. Agent Job Delivery

### 7.1 Transactional Creation

`mda-main` creates a Job in one PostgreSQL transaction:

```text
insert agent_job
insert control_outbox record
commit
```

An internal dispatcher reads unprocessed outbox records and appends Job IDs to a Redis Stream.

This avoids creating a Redis Job without the corresponding PostgreSQL record.

### 7.2 Consumer Group

Agent containers use a Redis consumer group:

```text
stream: mda:agent-jobs
consumer group: mda-agents
consumer: unique container-and-worker ID
```

The stream payload contains only routing information:

```json
{
  "jobId": "job_123",
  "tenantId": "tenant_123",
  "attempt": 1
}
```

It contains no prompt body, model key, Data Source credential, or source archive.

### 7.3 Claim

After receiving a stream entry, `mda-agent` calls a signed internal `mda-main` endpoint to claim the Job.

`mda-main`:

- Confirms the Job is claimable.
- Acquires a lease in PostgreSQL.
- Returns job-scoped configuration.
- Returns short-lived internal and artifact credentials.
- Never returns Data Source credentials.

### 7.4 Completion and Acknowledgement

The Agent posts terminal state to `mda-main`. The Redis entry is acknowledged only after PostgreSQL records the terminal state or safe retry state.

### 7.5 Crash Recovery

- PostgreSQL lease expiry identifies abandoned Jobs.
- Redis pending entries are reclaimed with bounded retry.
- A new Agent receives a new attempt and isolated workspace.
- Idempotency prevents duplicate Publication.
- A stale Agent cannot save after losing its lease.

## 8. Agent Events and SSE

The Agent posts platform events to `mda-main` over signed internal HTTP.

`mda-main`:

1. Persists durable events in PostgreSQL.
2. Publishes a lightweight Redis wake-up notification.
3. Wakes connected SSE handlers.
4. Replays missed events from PostgreSQL by sequence.

Redis Pub/Sub or Streams reduces polling latency but is not event history.

A browser or `mda` CLI reconnects with `Last-Event-ID` and receives all authorized missed events from PostgreSQL.

## 9. Runtime Query Cache

`mda-datasource` may use Redis for bounded Query Result caching.

Cache keys include:

```text
tenant
viewer authorization scope
Publication or Preview Revision
Query Revision
normalized parameters
trusted row-level context digest
```

Rules:

- TTL is finite.
- No cache entry crosses tenant or authorization scope.
- Permission revocation and Query retirement invalidate affected entries.
- A cache miss falls back to the live source.
- A Redis outage falls back to live execution when source policy allows.
- Cache values contain no credentials.

Automatic dashboard refresh still repeats authorization even when a cached result is returned.

## 10. Object Storage

MinIO provides S3-compatible storage in Compose.

Buckets or prefixes separate:

```text
source-revisions/
draft-checkpoints/
pi-sessions/
preview-bundles/
published-bundles/
exports/
```

`mda-main` owns metadata and grants short-lived access.

`mda-agent` may receive narrowly scoped temporary credentials for only the assigned Job and object prefix. It cannot list or modify another tenant's artifacts.

Published artifacts are immutable.

## 11. Networks

Use multiple Compose networks:

```text
edge-net       public ingress to mda-main
control-net    main, PostgreSQL, Redis, MinIO, datasource
agent-net      main, Redis, MinIO, agent
source-net     main, datasource, JDBC Runner
```

Recommended membership:

| Service | edge | control | agent | source |
|---|:---:|:---:|:---:|:---:|
| `mda-main` | Yes | Yes | Yes | Yes |
| `mda-agent` | No | No | Yes | No |
| `mda-datasource` | No | Yes | No | Yes |
| `mda-jdbc-runner` | No | No | No | Yes |
| PostgreSQL | No | Yes | No | No |
| Redis | No | Yes | Yes | No |
| MinIO | No | Yes | Yes | No |

The Agent cannot connect to PostgreSQL, `mda-datasource`, or the JDBC Runner through Compose networks.

Compose network separation does not provide destination-level outbound filtering. Production hosts should add an egress proxy or firewall policy for Agent model-provider access and HTTP connector destinations.

## 12. Secrets

Use Docker Compose secrets rather than committing values to YAML.

Required secret categories:

```text
PostgreSQL passwords
Redis password or ACL credentials
MinIO access and secret keys
OIDC client secret
internal service signing keys
model provider credentials
Data Source secret-manager credentials
JDBC Runner mutual-auth material
```

Secret visibility:

| Secret | Main | Agent | Datasource | JDBC Runner |
|---|:---:|:---:|:---:|:---:|
| Control DB credential | Yes | No | No | No |
| Data Source DB credential | No | No | Yes | No |
| Redis main credential | Yes | No | Optional | No |
| Redis Agent ACL credential | No | Yes | No | No |
| MinIO management credential | Yes | No | No | No |
| Job-scoped MinIO credential | No permanent value | Temporary | No | No |
| Model provider credential | No | Yes | No | No |
| Managed source credentials | No | No | Resolve only | Request-scoped only |

The Agent image must not mount the host `~/.pi/agent` directory.

## 13. Container Hardening

### 13.1 Main

- Run as a non-root user.
- Read-only root filesystem where practical.
- Drop Linux capabilities.
- Set `no-new-privileges`.
- Mount only necessary temporary paths.
- Do not mount Docker socket.

### 13.2 Agent

- Run as a non-root user.
- Drop all capabilities.
- Set `no-new-privileges`.
- Use a read-only root filesystem.
- Use `tmpfs` for `/workspace`, `/tmp`, and writable package/build caches.
- Set memory, CPU, process, and file limits.
- Do not mount host project paths.
- Do not mount host SSH keys.
- Do not mount Docker socket.
- Process one Job at a time per in-container worker.
- Bound `MDA_AGENT_WORKERS` according to model, memory, and database capacity.
- Keep every conversation in its own Session workspace.

Docker Compose alone is not a hostile multi-tenant sandbox. Higher-risk deployments should launch one fresh container or micro-VM per Job. The independent `mda-agent` image is designed to support that later deployment mode.

### 13.3 Datasource

- Run as non-root.
- Resolve source secrets only in this service.
- Restrict outbound HTTP destinations.
- Restrict inbound access to `mda-main`.
- Use separate PostgreSQL role and schema.

### 13.4 JDBC Runner

- Run as non-root.
- Read-only driver directory.
- No public network port.
- Accept requests only from `mda-datasource`.
- Bound heap, threads, connection pools, and statement execution.
- Do not persist credentials.

## 14. Image Build Strategy

### 14.1 Main Dockerfile

Use a multi-stage build:

```text
Bun dependency stage
  → build shared contracts
  → build Management Web
  → prepare Control Plane production dependencies
  → copy into minimal Bun runtime image
```

The final image contains no Agent build tools.

### 14.2 Agent Dockerfile

Use a separate multi-stage build:

```text
Bun dependency stage
  → install pinned Pi SDK
  → install dashboard template dependencies
  → copy Agent Runner and Skills
  → final hardened Agent image
```

The Agent image intentionally contains build tools required by generated dashboards. Those tools are not copied into `mda-main`.

### 14.3 Datasource Dockerfile

The final image contains Bun, HTTP connector code, Data Source management code, and JDBC protocol client. It does not contain arbitrary JDBC JARs.

### 14.4 JDBC Dockerfile

The JDBC image contains only the supported JVM, Runner, and allowlisted pinned driver artifacts.

## 15. Compose Service Definition

Illustrative Compose structure:

```yaml
name: mda

services:
  postgres:
    image: postgres:17.4-alpine
    environment:
      POSTGRES_USER: mda_admin
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
      POSTGRES_DB: mda
    secrets:
      - postgres_password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mda_admin -d mda"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks: [control-net]
    restart: unless-stopped

  redis:
    image: redis:7.4-alpine
    command: >-
      sh -c 'exec redis-server
      --appendonly yes
      --requirepass "$$(cat /run/secrets/redis_password)"'
    secrets:
      - redis_password
    volumes:
      - redis-data:/data
    healthcheck:
      test:
        - CMD-SHELL
        - 'redis-cli -a "$$(cat /run/secrets/redis_password)" ping | grep PONG'
      interval: 5s
      timeout: 3s
      retries: 20
    networks: [control-net, agent-net]
    restart: unless-stopped

  minio:
    image: minio/minio:RELEASE.2025-02-07T23-21-09Z
    command: server /data --console-address :9001
    environment:
      MINIO_ROOT_USER_FILE: /run/secrets/minio_access_key
      MINIO_ROOT_PASSWORD_FILE: /run/secrets/minio_secret_key
    secrets:
      - minio_access_key
      - minio_secret_key
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks: [control-net, agent-net]
    restart: unless-stopped

  jdbc-runner:
    image: "ghcr.io/example/mda-jdbc-runner:${MDA_VERSION}"
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    tmpfs:
      - /tmp:size=128m,noexec,nosuid
    networks: [source-net]
    restart: unless-stopped

  datasource-migrate:
    image: "ghcr.io/example/mda-datasource:${MDA_VERSION}"
    command: ["bun", "run", "db:migrate"]
    environment:
      DATABASE_URL_FILE: /run/secrets/datasource_database_url
    secrets:
      - datasource_database_url
    depends_on:
      postgres:
        condition: service_healthy
    networks: [control-net]
    restart: "no"

  datasource:
    image: "ghcr.io/example/mda-datasource:${MDA_VERSION}"
    environment:
      DATABASE_URL_FILE: /run/secrets/datasource_database_url
      INTERNAL_SIGNING_KEY_FILE: /run/secrets/internal_signing_key
      JDBC_RUNNER_URL: http://jdbc-runner:8090
      REDIS_URL_FILE: /run/secrets/redis_datasource_url
    secrets:
      - datasource_database_url
      - internal_signing_key
      - redis_datasource_url
    depends_on:
      datasource-migrate:
        condition: service_completed_successfully
      jdbc-runner:
        condition: service_started
      redis:
        condition: service_healthy
    networks: [control-net, source-net]
    healthcheck:
      test: ["CMD", "bun", "run", "healthcheck"]
      interval: 5s
      timeout: 3s
      retries: 20
    restart: unless-stopped

  main-migrate:
    image: "ghcr.io/example/mda-main:${MDA_VERSION}"
    command: ["bun", "run", "db:migrate"]
    environment:
      DATABASE_URL_FILE: /run/secrets/main_database_url
    secrets:
      - main_database_url
    depends_on:
      postgres:
        condition: service_healthy
    networks: [control-net]
    restart: "no"

  main:
    image: "ghcr.io/example/mda-main:${MDA_VERSION}"
    environment:
      DATABASE_URL_FILE: /run/secrets/main_database_url
      REDIS_URL_FILE: /run/secrets/redis_main_url
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY_FILE: /run/secrets/minio_access_key
      S3_SECRET_KEY_FILE: /run/secrets/minio_secret_key
      DATASOURCE_URL: http://datasource:8081
      INTERNAL_SIGNING_KEY_FILE: /run/secrets/internal_signing_key
    secrets:
      - main_database_url
      - redis_main_url
      - minio_access_key
      - minio_secret_key
      - internal_signing_key
    depends_on:
      main-migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
      datasource:
        condition: service_healthy
    ports:
      - "8080:8080"
    networks: [edge-net, control-net, agent-net, source-net]
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    tmpfs:
      - /tmp:size=128m,noexec,nosuid
    healthcheck:
      test: ["CMD", "bun", "run", "healthcheck"]
      interval: 5s
      timeout: 3s
      retries: 20
    restart: unless-stopped

  agent:
    image: "ghcr.io/example/mda-agent:${MDA_VERSION}"
    environment:
      CONTROL_PLANE_INTERNAL_URL: http://main:8080
      REDIS_URL_FILE: /run/secrets/redis_agent_url
      INTERNAL_AGENT_TOKEN_FILE: /run/secrets/internal_agent_token
      MDA_AGENT_WORKERS: 8
      MODEL_API_KEY_FILE: /run/secrets/model_api_key
      S3_ENDPOINT: http://minio:9000
    secrets:
      - redis_agent_url
      - internal_agent_token
      - model_api_key
    depends_on:
      main:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    networks: [agent-net]
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    tmpfs:
      - /workspace:size=2g,exec,nosuid
      - /tmp:size=512m,exec,nosuid
      - /home/mda/.cache:size=1g,nosuid
    restart: unless-stopped

networks:
  edge-net: {}
  control-net:
    internal: true
  agent-net: {}
  source-net: {}

volumes:
  postgres-data: {}
  redis-data: {}
  minio-data: {}

secrets:
  postgres_password:
    file: ./secrets/postgres_password
  main_database_url:
    file: ./secrets/main_database_url
  datasource_database_url:
    file: ./secrets/datasource_database_url
  redis_password:
    file: ./secrets/redis_password
  redis_main_url:
    file: ./secrets/redis_main_url
  redis_agent_url:
    file: ./secrets/redis_agent_url
  redis_datasource_url:
    file: ./secrets/redis_datasource_url
  minio_access_key:
    file: ./secrets/minio_access_key
  minio_secret_key:
    file: ./secrets/minio_secret_key
  internal_signing_key:
    file: ./secrets/internal_signing_key
  internal_agent_token:
    file: ./secrets/internal_agent_token
  model_api_key:
    file: ./secrets/model_api_key
```

The example is a contract illustration. Exact image versions and secret paths must be pinned by the deployment release. The abbreviated Redis setup uses one server password; production must configure separate Redis ACL users and key permissions for Main, Agent, and Data Source roles.

## 16. Compose Health

Required health endpoints:

```text
mda-main:        GET /health/live and /health/ready
mda-datasource:  GET /health/live and /health/ready
JDBC Runner:     GET /health/live and /health/ready
```

Readiness rules:

- Main requires PostgreSQL migrations, Redis, Object Storage, and Data Source Service contract compatibility.
- Data Source Service requires its PostgreSQL migrations and JDBC Runner only when JDBC is enabled.
- Agent requires Redis and the internal Main API; it does not need direct PostgreSQL readiness.

`depends_on` improves startup ordering but does not replace application retry and readiness logic.

## 17. Scaling

Scale Agent capacity both within and across containers:

```bash
MDA_AGENT_WORKERS=8 docker compose up -d --scale agent=3 agent
```

This example supports up to 24 active conversations. Each container-and-worker pair uses a unique Redis consumer ID and handles one Job at a time; additional Jobs remain durably queued.

The initial Compose deployment runs one Main and one Data Source Service replica. Scaling those services requires an external load balancer and shared signing, PostgreSQL, Redis, and Object Storage configuration.

Redis Streams distribute Agent Jobs across replicas. PostgreSQL leases remain authoritative for ownership.

## 18. Resource Limits

Example Agent limits:

```yaml
services:
  agent:
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 4g
        reservations:
          cpus: "0.5"
          memory: 1g
    pids_limit: 512
```

Compose support for `deploy.resources` varies by mode, so deployments must verify that limits are actually enforced by their Docker environment.

Data Source and JDBC limits must separately bound:

- Connection pools.
- Concurrent requests.
- Statement duration.
- HTTP response bytes.
- JDBC heap and threads.

## 19. Local Development

Use two files:

```text
compose.yaml
compose.dev.yaml
```

Development overrides may:

- Build images from local Dockerfiles.
- Expose PostgreSQL, Redis, MinIO, and service debug ports on loopback only.
- Mount source code for Main and Data Source hot reload.
- Use test OIDC configuration.
- Use fixture Data Sources.

The Agent should still use its real image and temporary workspace so development exercises the isolation boundary.

Example:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

## 20. Deployment Procedure

```text
1. Build and tag all MDA images with one release version.
2. Generate or provision secrets outside the repository.
3. Pull pinned third-party images.
4. Start PostgreSQL, Redis, and MinIO.
5. Run Control Plane and Data Source migrations.
6. Start JDBC Runner and Data Source Service.
7. Start Main and verify readiness.
8. Start or scale Agent workers.
9. Run mda doctor and the deployment smoke scenario.
```

Example:

```bash
export MDA_VERSION=0.1.0
docker compose pull
docker compose up -d postgres redis minio
docker compose run --rm datasource-migrate
docker compose run --rm main-migrate
docker compose up -d datasource jdbc-runner main
docker compose up -d --scale agent=2 agent
mda doctor
```

## 21. Rolling Updates

For a single-host Compose deployment:

1. Back up PostgreSQL and verify Object Storage durability.
2. Pull new pinned images.
3. Run backward-compatible migrations.
4. Replace Data Source Service and Main.
5. Drain active Agent Jobs or allow them to finish on the old Agent version.
6. Replace Agent replicas.
7. Run contract and live-refresh smoke tests.

Do not update Pi SDK independently inside a running Agent container. Pi and the Agent image are versioned together.

## 22. Backup and Restore

Back up:

- PostgreSQL with point-in-time recovery where available.
- MinIO/S3 artifact buckets and versioning.
- Deployment configuration without plaintext secrets.
- Secret-manager records through the platform's supported process.

Redis backup is useful for faster recovery but not required for correctness because PostgreSQL and outboxes remain authoritative.

A restore test must verify:

- Dashboard and Query Bindings.
- Session references.
- Source and Query metadata.
- Published artifacts.
- Redis Job reconstruction.
- Live query execution.

## 23. Failure Behavior

### PostgreSQL unavailable

- Main and Data Source become unready.
- No mutating operation proceeds.
- Agents stop claiming new Jobs.

### Redis unavailable

- Durable API writes may continue to PostgreSQL where safe.
- New Agent Jobs remain in the outbox until Redis recovers.
- SSE wake-ups fall back to bounded PostgreSQL polling.
- Query cache falls back to live execution or a structured unavailable error.

### MinIO unavailable

- New source checkpoints, builds, exports, and Publications fail safely.
- Existing CDN-cached Publications may continue serving.

### Main unavailable

- Public API, CLI, and new Agent claims stop.
- Running Agents lose lease renewal and terminate safely.

### Agent unavailable

- Management and published Dashboards remain available.
- Jobs stay queued for another Agent replica.

### Data Source Service unavailable

- Management and published frontend artifacts remain available.
- Live data queries return structured retryable errors.
- Agent code editing may continue, but Data Source Tools fail safely.

### JDBC Runner unavailable

- HTTP Sources remain operational.
- JDBC Sources report a connector-specific retryable error.

## 24. Security Acceptance Criteria

1. Only Main exposes a public service port.
2. Main and Agent use different images and runtime privileges.
3. Main contains no Pi SDK execution path.
4. Agent has no PostgreSQL or Data Source credential.
5. Agent has no Docker socket or host workspace mount.
6. Data Source Service is the only Bun service that resolves source secrets.
7. JDBC Runner is reachable only by Data Source Service.
8. Redis users and key prefixes are role scoped.
9. PostgreSQL roles cannot access another module's schema.
10. Generated code executes only in Agent or isolated Preview boundaries.
11. Secrets are not committed in Compose files.
12. Published Dashboard refresh does not invoke Agent containers.

## 25. Deployment Acceptance Criteria

The Compose architecture is complete when:

1. `docker compose up` starts PostgreSQL, Redis, MinIO, Data Source Service, JDBC Runner, Main, and Agent.
2. Main serves the Management Web and Control Plane API from `mda-main`.
3. Agent Jobs execute only in `mda-agent` containers.
4. Agent replicas consume Jobs through Redis Streams while PostgreSQL remains authoritative.
5. Browser and CLI event streams recover from Redis or client reconnects using PostgreSQL event history.
6. HTTP and JDBC Data Sources execute through the standalone Data Source Service.
7. Source and Session artifacts persist in MinIO across container replacement.
8. A source-row change appears in a published Dashboard without rebuilding or invoking Pi.
9. Main remains available when Agent replicas are stopped.
10. Published Dashboards remain available when no Agent worker is running.
11. Data Source and Control Plane migrations run independently.
12. `mda doctor` and a scripted Dashboard generation simulation pass after deployment.
