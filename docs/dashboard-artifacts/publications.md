# Dashboard Publications and Bundle Export

## Purpose

A Publication is the immutable, validated frontend release built from one saved Dashboard Revision. It is the only artifact a Share Link may target.

Publishing never builds from a mutable Draft or an Agent Session workspace. It pins source first, runs the same fixed clean build used by Preview, stores the exact validated bundle, then creates the Publication transactionally.

## Lifecycle

```text
immutable Dashboard Revision
          │
          │ publish request
          ▼
Publication Build (queued → running → ready | failed)
          │
          │ fixed clean Vite build in mda-agent
          ▼
validated content-addressed bundle in private Object Storage
          │
          │ fenced completion transaction
          ▼
immutable Publication
```

A Publication Build is operational job state. A Publication does not exist until its build and boundary validation succeed.

## Build Rules

Publication builds use `packages/dashboard-template` exactly like Preview builds:

- `mda-main` never executes generated source.
- `mda-agent` restores the exact Revision Checkpoint.
- The subprocess receives the platform-owned shell and approved dependencies only.
- The environment omits model, Redis, Control Plane, Object Storage, and deployment credentials.
- Package installation and user Vite configuration are forbidden.
- Source, Manifest, and output digests are recomputed.
- The bundle must contain `index.html` and obey all file and size bounds.

A successful Preview is useful evidence but is not reused as Publication authority. Publishing performs a clean build from the immutable Revision so the recorded source and bundle relationship is independently verifiable.

## Query Binding Gate

A Publication must pin every declared Query to an immutable external Query Revision. Until the Data Access and Query Binding slice exists, MDA permits publication only when `dashboard.manifest.json` declares an empty `queries` array.

A non-empty declaration fails with `QUERY_BINDINGS_UNAVAILABLE`; it is never silently removed, mocked, or treated as public-safe. This temporary gate preserves the final publication invariant.

## Persistence

### `publication_builds`

Each operational build records:

- Tenant, Dashboard, source Revision, source Checkpoint, Agent Job, requester, and request ID.
- Pinned source digest.
- `building`, `ready`, or `failed` status.
- Resulting Publication ID or safe terminal error.
- Request and completion times.

Idempotent retries with the same key and request return the same Build and Job. Reusing the key for another Revision is a conflict.

### `publications`

Each immutable Publication records:

- Tenant, Dashboard, monotonic Publication number, Revision, and Build.
- Source, Manifest, and build digests.
- Template and Runtime versions.
- Private artifact key, build file count, and decoded bytes.
- Publisher and creation time.

Publication rows and referenced bundles are immutable. Releasing the same Revision again creates another explicit Publication and audit event; it never repoints an earlier release.

## Agent Protocol

A dedicated `publish` Agent Job:

1. Claims a fenced lease.
2. Restores the exact Revision Checkpoint supplied by the Control Plane.
3. Runs the fixed clean build without invoking the model.
4. Emits `build.started`, `validation.completed`, and `build.completed`.
5. Uploads the validated bundle through the lease-fenced internal Publication endpoint.
6. The Control Plane writes the private object, creates the Publication, marks the Publication Build ready, and records audit/outbox facts in one transaction.
7. The Agent emits `publication.created` and settles successfully.

A Job cannot settle successfully unless its Publication Build is ready. Failed, cancelled, stale, or mismatched Jobs create no Publication.

## APIs

```text
POST /api/dashboards/:dashboardId/publications
GET  /api/dashboards/:dashboardId/publications
GET  /api/publication-builds/:buildId
GET  /api/publications/:publicationId
GET  /api/publications/:publicationId/export
POST /internal/v1/agent-jobs/:jobId/publication
```

Create input requires an immutable `revisionId`. Save and publish remain separate operations.

The export response is a deterministic `tar.gz` containing the immutable built bundle rooted at `index.html`. It contains no source, Pi history, build logs, query results, credentials, tokens, or internal metadata.

Publication bundle delivery to viewers is intentionally not exposed as an unguarded URL in this slice. The next Share Link slice creates revocable access policies that point to one Publication and directly serves this same immutable bundle.

## CLI

```text
mda dashboard publish <dashboard-id> --revision <revision-id>
mda publication list --dashboard <dashboard-id>
mda publication show <publication-id>
mda publication download <publication-id> [--output <path>] [--force]
```

`dashboard publish` streams durable build events and returns only after the Publication exists. JSON mode returns the Publication. Downloads write atomically and refuse overwrite unless `--force` is supplied.

## Security

- Only users with `dashboard.edit` may request publication.
- Publication reads and downloads require `dashboard.read` in the owning tenant.
- Internal upload is service-authenticated and lease-fenced.
- The source digest must equal the pinned Revision digest.
- The Control Plane revalidates every bundle path, media type, size, digest, and Manifest digest before storage.
- Object keys and credentials never appear in public contracts.
- Export response headers prevent content sniffing and browser execution.
- A failed build stores only bounded safe diagnostics.

## Acceptance Criteria

1. Publishing requires a saved Revision and never reads the latest mutable Draft implicitly.
2. The model is not invoked by a Publication Build.
3. A successful build creates exactly one immutable Publication for one idempotent request.
4. Failed, cancelled, stale, mismatched, or query-unbound builds create no Publication.
5. Publication numbers increase monotonically per Dashboard.
6. CLI publish, list, show, and download return the exact immutable artifact metadata and bytes.
7. Export is deterministic and contains only validated `dist/` files.
8. Main/Agent/MinIO restart does not lose Publication Builds, Publications, or bundles.
9. Audit and outbox records contain IDs and digests but no credentials or raw content.
10. The newest local CLI completes the full flow against the newest deployed environment.
