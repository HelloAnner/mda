# MDA Web Workspace

## Purpose

The MDA web workspace is the browser operating surface for every public Control Plane capability. It does not duplicate business logic: dashboards, Agent work, source snapshots, previews, publications, sharing, Data Sources, and Queries continue to use the same versioned APIs as the CLI.

The visual system follows the Moss `0.5.0` workspace profile within its validated source scope. Light uses the exact source tokens; dark uses the exact source token definitions but is not claimed as runtime-validated against Moss. MDA keeps its own name and mark rather than copying Moss brand identity.

## Information architecture

```text
MDA shell
├─ 260px / 48px directory sidebar
│  ├─ MDA brand and collapse action
│  ├─ New dashboard
│  ├─ User-created nested folders
│  ├─ Independently managed dashboards
│  └─ Data Sources / Queries / Jobs / connection settings
├─ conversation or management workspace
│  ├─ 48px contextual header
│  ├─ 900px conversation column or module content
│  └─ 116px conversation composer
└─ optional 50% inset drawer
   ├─ Board drawer: Preview and Publication workflow
   └─ Revision drawer: saved source files
```

On coarse-pointer mobile devices at 960px or below, the product presents a calm desktop-required page, matching the source product strategy. Narrow desktop windows keep working by collapsing secondary chrome.

## Business-to-design mapping

| MDA object | Moss semantic pattern | Main states |
|---|---|---|
| Folder tree and Dashboard | Sidebar group and session item | current, hover, creating, archived |
| Agent Job | Conversation turn | queued, running, succeeded, failed, cancelled |
| Agent Event | Process note or tool action | pending, running, completed, failed |
| Assistant output | Assistant response surface | streaming, complete, empty, error |
| Preview / Publication | Right-side Board drawer | building, validating, ready, expired, failed |
| Revision files | Right-side file workspace | loading, grid/list, search, preview, download |
| Data Source / Query | Neutral management list and drawer form | loading, empty, healthy, degraded, invalid |
| Destructive action | Confirm dialog | idle, submitting, error |

## Dashboard folders

Dashboard folders are tenant-scoped, user-created, nested directories. A Dashboard has an optional `folderId`; no folder means the root directory.

Rules:

- Folder names are normalized and unique among siblings.
- A folder cannot become its own descendant.
- Deleting a folder requires it to contain neither child folders nor Dashboards.
- Moving a Dashboard or Folder uses optimistic version checks.
- Existing Dashboards remain at the root after migration.
- Folder APIs are additive and do not alter existing Dashboard route behavior.

Public routes:

```text
GET    /api/dashboard-folders
POST   /api/dashboard-folders
PATCH  /api/dashboard-folders/:folderId
DELETE /api/dashboard-folders/:folderId
```

Dashboard create/update accepts optional `folderId`; update accepts `null` to move to root.

## Conversation contract

The browser must restore conversations created by either web or CLI, not only messages cached in one browser. Additive read APIs expose the already-persisted Agent Session, user prompt, Job, and sanitized durable events:

```text
GET /api/dashboards/:dashboardId/sessions
GET /api/agent-sessions/:sessionId/timeline
```

The timeline never exposes Pi history files, credentials, hidden model reasoning, raw storage keys, or unsanitized logs. The frontend derives:

- user bubbles from persisted prompt text;
- assistant text from ordered `assistant.delta` events, with `assistant.completed` as fallback;
- process rows from model, compaction, build, validation, and checkpoint events;
- tool rows from paired `tool.started` / `tool.completed` events;
- terminal state and duration from the Job.

A live turn resumes SSE with the last durable sequence and reconciles final Job state after disconnects.

## Board lifecycle

### Automatic reveal

When a conversation emits `build.started`, the Board drawer opens automatically and places a translucent mask over its content. Feedback uses the Moss Board language:

1. a 2px low-saturation travelling rail;
2. a restrained dashboard skeleton;
3. the confirmed “magnifier scans dashboard” loading visual;
4. human labels such as preparing, rendering, validating, and publishing.

`preview.ready` removes the mask, refreshes the Preview collection, selects the created Preview, and renders it in a sandboxed iframe. Failure replaces motion with a calm actionable error.

### Board actions

Every Board drawer exposes:

- **Save**: promote the current successful Draft Checkpoint to an immutable Revision, with optional message and folder selection;
- **Refresh**: reload a ready iframe or create a replacement Preview when the URL expired;
- **Share**: select or create a Revision, build an immutable Publication, then create a revocable Share Link with optional expiry;
- **Open**: open the signed Preview or newly created Share URL in a separate tab;
- **Maximize / close**: use the shared inset drawer behavior.

After save, a small neutral board tile travels from the save action toward the selected directory, then the directory briefly pulses and the Dashboard list refreshes. Reduced-motion users receive the same state change without spatial animation.

## Frontend modules and API coverage

### Dashboards

- List, select, create, rename, describe, move, archive.
- Create, rename, move, and delete folders.
- Start and resume Sessions.
- Send prompts, stream/replay events, inspect and cancel Jobs.

### Revisions

- Save the active Draft.
- List and inspect Revisions.
- List, search, preview, and download individual source files.
- Export a source archive.

### Previews

- List and inspect Previews.
- Build from the latest Draft or a selected Revision.
- Follow the build Job and render a ready signed Preview in a sandboxed iframe.

### Publications and shares

- List and inspect Publications.
- Publish a selected immutable Revision and follow its build Job.
- Download the immutable bundle.
- Create expiring Share Links, copy/open a newly returned URL, list metadata, and revoke active links.

### Data Sources

- List, show, describe, create HTTP/JDBC, rename, edit, test, activate, enable, disable, soft-delete, restore, and refresh schema.
- Kind-specific forms use the exact public contracts; advanced entities remain editable as structured JSON.

### Queries

- List/filter, show, register HTTP/JDBC read-only operations, configure typed parameters and sample values, execute, and render bounded tabular results.

### Jobs and system

- Service metadata and readiness.
- List/filter Jobs, inspect durable events and terminal errors, follow active work, and request cancellation.
- Connection settings for deployment password, tenant, and optional bearer token are kept in tab-scoped session storage.

## State and safety rules

- Every request carries the same contract/version, tenant, access-password, token, request ID, and idempotency headers used by the CLI where applicable.
- Mutations disable duplicate submission and surface the server's stable error code plus calm guidance.
- Destructive actions require an explicit Confirm dialog.
- Generated pages are always sandboxed; management credentials are never injected into an iframe.
- Download names are server-controlled or normalized by the client.
- Secret values are never printed in the UI, logs, screenshots, or repository.
- Unknown future Agent events remain visible as neutral process rows rather than being dropped.

## Visual values

The implementation consumes the Moss semantic token values directly:

- canvas `#FAF9F7`, chat `#FCFCFB`, sidebar `#F2F1ED` in light;
- sidebar `260px / 48px`, content rows `36px`, header `48px`;
- conversation max width `900px`, 24px message spacing;
- assistant mark `24px`, response `16px 18px`, radius `8px`;
- reasoning `14/22`, tool action `13/20`, duration `11/20`, connector `1.25px`;
- composer min height `116px`, radius `16px`, send `34px`;
- right drawer ratio `50%`, min width `480px`, inset `8px`, radius `6px`.

Orange is reserved for the MDA mark, creation/send actions, and the single Board-loading focal detail. Current navigation remains neutral.

## Verification

Before release:

1. `bun run typecheck && bun run lint && bun test` passes locally.
2. The full stack is deployed through `make deploy`.
3. The newest local CLI exercises the additive Folder API against the newest deployment.
4. Browser automation at 1440×900 covers connection, folder and Dashboard creation, chat replay/streaming, Board progress and Preview, save/fly animation, Revision files, publication/share, Data Sources, Queries, Jobs, dark theme, loading/empty/error states, and destructive confirmation on isolated test resources.
5. Screenshots are captured for the shell, conversation, Board progress, ready Preview, revisions, Data Sources, Queries, Jobs, dialogs, and dark theme.
6. Browser console and page error logs are empty except explicitly documented generated-Preview diagnostics.

The Moss source archive still lacks a real authenticated visual baseline and runtime-validated dark workspace. Therefore conformance is `exact within source-defined desktop geometry and token scope`, not a claim of pixel validation against the original running product.
