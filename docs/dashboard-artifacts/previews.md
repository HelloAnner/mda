# Dashboard Build Validation and Previews

## Purpose

This feature turns ordinary Dashboard source into a validated, immutable Preview without reducing the Coding Agent's control over presentation or source structure.

The platform owns the build shell, approved dependencies, Runtime boundary, validation, isolation policy, and artifact delivery. The Coding Agent owns `src/**`, `public/**`, and the external `dashboard.manifest.json` contract.

## Source Contract

A build reads only:

```text
dashboard.manifest.json
src/**
public/**
```

The Manifest declares the build entry rather than forcing one project layout:

```json
{
  "schemaVersion": 1,
  "title": "Sales Overview",
  "description": "Executive sales performance",
  "sourceEntry": "src/main.tsx",
  "entry": "dist/index.html",
  "runtimeVersion": "1",
  "queries": []
}
```

`sourceEntry` may point to any normalized JavaScript or TypeScript module under `src/`. The Agent remains free to organize every other file, component, style, chart, interaction, and state model.

The Agent cannot replace `package.json`, the Vite configuration, dependency versions, or build scripts. Files such as `package.json`, lockfiles, `vite.config.*`, `node_modules`, and `dist` in the source snapshot are ignored as build input and reported as boundary violations.

## Fixed Build Shell

`packages/dashboard-template` owns:

- Vite configuration and `bun run build` equivalent.
- A generated HTML shell that imports the declared `sourceEntry`.
- The approved dependency catalog.
- Build limits, environment sanitization, and artifact capture.
- Template version `1` and Runtime version `1`.

The first approved browser dependencies are React, React DOM, ECharts, D3, Lucide React, and `@mda/dashboard-runtime`. Their presence is optional; the Agent is never required to use a particular library.

The fixed shell uses relative asset URLs so an immutable bundle can be served beneath a tokenized Preview path.

## Validation

Validation checks only platform boundaries:

1. Manifest Schema, Runtime version, output entry, and normalized source entry.
2. Presence of the declared source entry.
3. Protected build files and excluded caches are absent from authored input.
4. Source contains no obvious private keys, credential literals, remote module imports, or prohibited external network destinations.
5. Vite builds successfully with only approved installed dependencies.
6. `dist/index.html` exists.
7. Build files have normalized paths, safe media types, bounded sizes, and a recomputed aggregate digest.

Validation does not parse React component trees, prescribe charts, score layouts, count components, or rewrite source.

Static validation is defense in depth. Runtime CSP and iframe sandboxing remain authoritative browser boundaries.

## Build Isolation

Builds run only in `mda-agent`; `mda-main` never executes generated source.

For every build, the Agent:

1. Creates a fresh temporary directory outside the editable workspace.
2. Copies only validated Manifest, `src/**`, and `public/**` files.
3. Generates the platform HTML shell and attaches the read-only approved dependency tree.
4. starts Vite in a subprocess with a minimal environment that omits Agent, Redis, model, Object Storage, and Control Plane credentials.
5. Enforces a two-minute timeout and bounded logs.
6. Captures and validates `dist/**` into a content-addressed bundle.
7. Removes the temporary directory in `finally`.

No package installation or user-provided Vite plugin/configuration runs during the build.

## Agent Tools

Moss receives two hard-boundary Tools:

```text
validate_dashboard
build_preview
```

`validate_dashboard` runs the fixed clean build and returns bounded diagnostics. `build_preview` runs the same validation, uploads the immutable bundle through the lease-fenced internal Control Plane API, and returns the Preview path.

Moss may repair source after either Tool reports a failure. It may claim validation or Preview success only after the corresponding Tool succeeds.

A CLI-requested Preview uses the same Agent worker build function without invoking the model.

## Persistence

`dashboard_previews` records:

- Tenant, Dashboard, source Checkpoint, optional source Revision, and Agent Job.
- Source, Manifest, and immutable build digests.
- Template and Runtime versions.
- Build artifact key, file count, and decoded bytes.
- `building`, `ready`, `failed`, or `expired` status.
- Safe terminal validation error, creator, creation time, and expiry.

A ready Preview row and its bundle are immutable. A failed build retains safe diagnostics but no artifact reference.

## APIs

```text
POST /api/dashboards/:dashboardId/previews
GET  /api/dashboards/:dashboardId/previews
GET  /api/previews/:previewId
POST /internal/v1/agent-jobs/:jobId/preview
GET  /p/:previewId/:signedToken/
GET  /p/:previewId/:signedToken/*
```

Creating a Preview pins the active Checkpoint or a specified immutable Revision before enqueueing a dedicated `preview` Agent Job. The response includes the Job and short-lived Preview URL. Idempotent retries return the same Preview and URL.

Public Preview asset requests require a signed, expiring token bound to the Preview ID. Revocation occurs through expiry or Preview state. The token grants access only to one immutable Preview bundle and never to source, Sessions, APIs, credentials, or other artifacts.

## Delivery Security

Preview responses use:

- Content-type allowlisting and `X-Content-Type-Options: nosniff`.
- No referrer and no browser caching of HTML.
- A restrictive CSP with no external network connection.
- CSP sandboxing without same-origin privileges.
- Relative immutable assets beneath the signed Preview path.
- Path normalization and bundle digest verification before serving.

The management frontend must still place Preview pages in a sandboxed iframe. A separate Preview origin can later route these same paths without changing artifact identity.

## CLI

```text
mda dashboard preview <dashboard-id> [--revision <revision-id>]
```

The CLI creates the Preview, streams durable build events, fails non-zero when the Job or validation fails, then prints the final URL. JSON mode returns the complete ready Preview.

## Acceptance Criteria

1. Moss can create arbitrary React/Vite source under `src/**` and build it with `build_preview`.
2. A CLI Preview pins one Checkpoint or Revision and does not invoke the model.
3. Unapproved imports, protected build files, traversal, symlinks, secrets, external URLs, and missing entries fail safely.
4. The build subprocess receives no deployment or model credential environment variables.
5. The Control Plane stores and serves an immutable content-addressed bundle but never executes generated source.
6. A signed Preview URL directly renders `dist/index.html` and relative assets.
7. Expired, malformed, cross-Preview, and traversal requests cannot read artifacts.
8. CSP prevents direct external network access and same-origin privilege.
9. Agent events persist `build.started`, `validation.completed`, `build.completed`, and `preview.ready`.
10. The newest local CLI and a real browser complete the flow against the newest deployed environment.
