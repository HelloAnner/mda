# Dashboard Checkpoints and Revisions

## Purpose

This feature makes Coding Agent source durable and portable before Preview, Publication, export, and public sharing are implemented.

A Dashboard has one authoritative Draft lineage. Every successful Agent Job that changes source may advance that Draft by creating a recoverable Checkpoint. An explicit save promotes the latest Checkpoint into an immutable Dashboard Revision.

The source remains ordinary files. Neither Checkpoints nor Revisions introduce a component tree, chart schema, fixed layout, or UI DSL.

## Lifecycle

```text
latest Checkpoint
      │
Agent restores snapshot into an isolated Session workspace
      │
Agent edits and validates ordinary source
      │
successful changed Job
      ▼
new immutable Checkpoint
      │
explicit dashboard save
      ▼
new immutable Revision
```

A failed or cancelled Job never advances the authoritative Draft. Its partial workspace is discarded when the next Job restores the latest successful Checkpoint.

## Object Storage

MDA stores source snapshots in private S3-compatible Object Storage. Docker Compose provides MinIO for the single-host deployment.

The Control Plane owns permanent Object Storage credentials. The Agent receives no S3 credential. It sends a bounded, validated source snapshot to a lease-fenced internal Control Plane endpoint; the Control Plane validates content, writes the immutable object, and records metadata in PostgreSQL.

Object keys include tenant and Dashboard scope plus a content digest. Database rows remain authoritative references. Objects are never publicly readable.

## Source Snapshot

The internal snapshot format is a versioned JSON document:

```ts
interface SourceSnapshot {
  schemaVersion: 1;
  digest: string;
  fileCount: number;
  totalBytes: number;
  files: Array<{
    path: string;
    content: string; // canonical base64
    executable: boolean;
  }>;
}
```

Rules:

- Paths are normalized relative POSIX paths.
- Absolute paths, `..`, backslashes, control characters, and ambiguous segments are rejected.
- Symlinks are rejected and never followed.
- Files are sorted by path before hashing or storage.
- `node_modules`, `dist`, `.git`, and transient caches are excluded.
- The first release allows at most 1,000 files, 2 MiB per file, and 20 MiB total decoded content.
- The Control Plane recomputes file sizes and the aggregate SHA-256 digest instead of trusting Agent metadata.
- Empty snapshots do not create Checkpoints.

The digest covers every normalized path, executable bit, and file-content digest. Identical content does not create a duplicate Checkpoint.

## Concurrency

Every claimed Job records the Checkpoint from which its workspace was restored. Creating a new Checkpoint uses optimistic lineage:

- If the current latest Checkpoint still equals the Job's base Checkpoint, the new Checkpoint may advance the Draft.
- If another Session advanced the Draft first, the stale Job receives `DRAFT_CONFLICT` and cannot overwrite newer source.
- A later merge workflow may reconcile branches explicitly; the first release never performs an implicit last-writer-wins merge.

PostgreSQL locks the Dashboard while checking and advancing the lineage.

## Persistence

### `draft_checkpoints`

Each row records:

- Tenant, Dashboard, Session, and successful Agent Job.
- Parent Checkpoint.
- Private artifact key and SHA-256 digest.
- File count and decoded byte count.
- Creator and creation time.

A submitted Checkpoint is first `staged`. Successful fenced Job settlement activates it in the same PostgreSQL transaction; failed, cancelled, or conflicting Jobs leave no active Draft advance. Active rows and referenced objects are immutable. One Agent Job stages at most one Checkpoint.

### `dashboard_revisions`

Each row records:

- Tenant and Dashboard.
- Monotonic per-Dashboard revision number.
- Source Checkpoint and immutable artifact metadata.
- Optional save message.
- Creator and creation time.

A Checkpoint is promoted at most once. Saving with the same idempotency key returns the existing Revision.

## Agent Flow

1. Claim the Job and acquire its fenced lease.
2. Read the current latest Checkpoint metadata and object through the Control Plane.
3. Clear and restore the Session workspace from that snapshot. With no Checkpoint, start from an empty workspace.
4. Run the Pi Session.
5. If the Job succeeds, capture and validate the workspace.
6. Submit and stage the snapshot with the base Checkpoint ID and active fencing token.
7. Settle the Job. The Control Plane locks the Dashboard, rechecks the active parent, activates the Checkpoint, persists `draft.checkpoint.saved`, and records Job success atomically.

A storage or lineage failure prevents successful settlement. Small-talk Jobs and unchanged source do not create extra Checkpoints.

## Public API

```text
POST /api/dashboards/:dashboardId/revisions
GET  /api/dashboards/:dashboardId/revisions
GET  /api/revisions/:revisionId
GET  /api/revisions/:revisionId/files
GET  /api/revisions/:revisionId/files/:encodedPath
GET  /api/revisions/:revisionId/export
```

All routes are tenant scoped. Save requires `dashboard.edit`; reads and exports require `dashboard.read`.

The export response is a deterministic `tar.gz` assembled from the immutable snapshot. It contains source only—never Pi history, credentials, model configuration, runtime tokens, logs, or generated `dist/` output.

## CLI

```text
mda dashboard save <dashboard-id> [--message <text>]
mda revision list --dashboard <dashboard-id>
mda revision show <revision-id>
mda revision files <revision-id>
mda revision read <revision-id> <path>
mda revision export <revision-id> [--output <path>] [--force]
```

JSON mode is available for metadata and file lists. `revision read` writes exact file bytes to stdout. Export writes atomically and refuses to overwrite unless `--force` is supplied.

## Security

- Agent and generated source never receive Object Storage credentials.
- Every internal checkpoint command is service-authenticated and lease-fenced.
- Snapshot validation occurs before Object Storage or database mutation.
- Restore and tar export revalidate all paths.
- Tenant ownership is checked before metadata or bytes are returned.
- API errors never expose artifact keys or storage credentials.
- Private objects are served only through authorized Control Plane routes.

## Acceptance Criteria

1. A successful Agent edit creates a durable Checkpoint.
2. A new Session for the same Dashboard restores the latest Checkpoint and can modify existing files.
3. Failed, cancelled, unchanged, and small-talk Jobs do not advance the Draft.
4. Concurrent stale Sessions cannot overwrite a newer Checkpoint.
5. An explicit CLI save creates one immutable Revision with a monotonic number.
6. CLI list, show, files, read, and export return the exact immutable source.
7. Restarting or replacing Agent and Main containers does not lose Checkpoints, Revisions, or objects.
8. Exported archives contain no credentials, histories, caches, dependencies, or build output.
9. PostgreSQL, Redis, Main, Agents, and MinIO are healthy after deployment.
10. The complete flow passes with the newest local `bun run mda` against the newest `moss-dev-2` deployment.
