---
name: dashboard-coding
description: MDA-specific mandatory workflow for creating, modifying, reviewing, or repairing dashboard source. Defines workspace, manifest, approved dependency, registered query, Tool validation, and honest completion boundaries without duplicating design, visualization, React, testing, or audit guidance.
---

# MDA Dashboard Coding

This Skill owns only MDA's platform contract. Professional Skills own general requirements, visualization, frontend design, React performance, functional testing, and quality auditing.

## Start with the current stage

1. Inspect the Session conversation, workspace, existing `dashboard.manifest.json`, source, and credential-free Data Source summary. Preserve good existing work; do not rebuild without cause.
2. For a new dashboard or material redesign, read `measure-dashboard-requirements`, load at most one matching presentation Skill and one matching industry Skill, present the implementation brief, and stop for approval before editing source.
3. After approval, follow `data-visualization` and `frontend-design`; for React code apply compatible guidance from `vercel-react-best-practices`.
4. After implementation, follow `webapp-testing` and `web-quality-audit`. Distinguish checks actually executed from source review or unavailable checks.
5. A focused repair may reuse requirements already approved in this Session and load only the professional stages affected by the change.

## Workspace and source boundary

All Agent-authored dashboard source is limited to:

- `dashboard.manifest.json`
- `src/**`
- `public/**`

The manifest must use a real module under `src/**` as `sourceEntry`, `dist/index.html` as `entry`, runtime version `1`, and valid registered Query declarations. You may freely create, remove, split, and refactor files inside the allowed source boundary.

Do not create or modify `package.json`, lock files, Vite configuration, `node_modules`, `dist`, generated reports, screenshots, or test artifacts. Use only approved dependencies already present in the fixed template: React, React DOM, D3, ECharts, Lucide React, and `@mda/dashboard-runtime`. Upstream Skill examples never authorize another package, CDN, script, font host, or external URL.

## Data boundary

The Data Source context and Tools are read-only with respect to source configuration. Never create, modify, delete, test connectivity, enable, disable, or request credentials for a Data Source.

When authorized Tools exist, you may:

- Use `list_data_sources` and `describe_data_source` to understand available evidence.
- Use `list_queries` to reuse valid registered Query Revisions.
- Use `register_query` for a bounded read-only query against an already authorized source.
- Use `test_query` to inspect a registered Query's current bounded result.

Dashboard code accesses data only through `dashboard.query()` or `dashboard.watch()` from `@mda/dashboard-runtime`, using Query IDs and typed parameters declared in the manifest. It never embeds source addresses, arbitrary SQL, credentials, or direct `fetch`, WebSocket, or EventSource destinations.

Never fabricate a production field, formula, query, result, freshness time, or live-data claim. When no authorized evidence exists, implement an honest empty state or clearly label fixture data as **Sample data** in the interface and completion report.

## Implementation loop

1. Translate the approved brief into ordinary source code; no component registry, fixed grid, JSON UI schema, or Skill example is authoritative.
2. Keep semantic structure, responsive behavior, keyboard paths, and all required data states in the implementation.
3. Use `dashboard.watch()` for data expected to change while the page remains open unless approved requirements call for manual refresh. Preserve usable previous data and expose refreshing, stale, and failure status.
4. Keep changes within the approved scope. Do not implement alerts, export, persistence, sharing, publication, or permissions merely because requirements mention a future need.
5. Run `validate_dashboard` or `build_preview` after source changes. Fix failures and repeat until the Tool succeeds or a real platform/data blocker remains.
6. Apply the functional-test and audit stages with capabilities that actually exist. A clean build is not a browser test, Lighthouse run, accessibility certification, Preview viewing, or publication.

## Completion report

Briefly state:

- What changed and which approved decisions it implements.
- Which registered or fixture data is used and its limitations.
- Exact Tools and checks that succeeded.
- Browser or audit checks that were not run and why.
- Remaining blockers or platform-owned findings.

Only a successful Tool result can support a claim that validation or Preview build passed. Never claim that a Preview was viewed, a dashboard was published, a browser test ran, or live data was connected without corresponding evidence.
