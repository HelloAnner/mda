# Dashboard Skill System

## Purpose

MDA uses a reviewed, project-pinned Agent Skill pack to raise dashboard quality without defining a component catalog, chart registry, layout schema, or proprietary UI model. When authorized evidence supports several distinct questions, the default product shape is a coordinated multi-view dashboard rather than a single chart, poster, or homogeneous card wall.

The Coding Agent remains the sole author of `src/**` and `public/**`. Professional upstream Skills own the reusable requirements, visualization, visual-design, React, functional-testing, and web-audit guidance. MDA-owned Skills contain only platform workflow or context-specific presentation and industry know-how.

## Principles

1. **Purpose precedes form.** Every dashboard starts with its audience, decisions, questions, metric definitions, evidence, and acceptance criteria.
2. **Composition is purposeful.** When evidence permits, prefer complementary orientation, diagnosis, comparison, detail, and action surfaces over one dominant visualization. Diversity must answer distinct questions; it is never a component quota or a reason to repeat metrics.
3. **Professional foundations have one owner.** MDA does not keep a second home-grown version of generic design or visualization guidance.
4. **Source remains free.** Skills never mandate a component, chart type, grid, CSS architecture, or file structure.
5. **Data stays truthful.** Production data is never fabricated; fixtures are clearly labeled. Units, periods, baselines, denominators, freshness, uncertainty, truncation, and missing values remain visible when material.
6. **States are part of the product.** Loading, empty, partial, stale, refreshing, error, unauthorized, and normal states receive intentional implementation and testing.
7. **Progressive disclosure preserves context.** Skills are read at the stage where they affect a decision; optional context Skills are selected sparingly.
8. **Industry knowledge is semantic, not cosmetic.** A healthcare Skill changes denominator, privacy, and risk-adjustment judgment; it does not require blue cards.
9. **Tools remain the source of truth.** A Skill cannot create a data source, approve a dependency, run a browser, pass a build, or publish an artifact by assertion.

## Professional Workflow

Every new dashboard or material redesign follows these stages:

| Stage | Skill | Required outcome |
|---|---|---|
| Platform boundaries | `dashboard-coding` | Inspect the workspace and data context; preserve MDA source, dependency, query, and validation boundaries. |
| Requirements | `measure-dashboard-requirements` | Define audience, decisions, questions, metric formulas, evidence-backed view roles, source/quality needs, cadence, filters, access constraints, states, and acceptance criteria. Stop for approval before coding. |
| Visualization | `data-visualization` | Compose the smallest useful set of complementary data views, select an encoding for each analytical relationship, and preserve labels, units, baselines, uncertainty, coordinated scope, and accessible alternatives. |
| Visual design | `frontend-design` | Make the result read as a subject-specific decision interface, with hierarchy across varied data components, compact tokens, typography, responsive behavior, and one restrained signature detail. |
| React engineering | `vercel-react-best-practices` | Apply only rules compatible with the fixed React/Vite browser runtime and approved dependencies. |
| Functional testing | `webapp-testing` | Exercise filters, table actions, navigation, keyboard paths, and data states at mobile and desktop widths when a runnable browser target is available. Never claim an unavailable browser run. |
| Final quality gate | `web-quality-audit` | Review source-owned performance, WCAG accessibility, security, and web-quality concerns; fix critical and high findings and identify platform-owned or unverified items. |

Minor edits and focused repairs may reuse requirements already approved in the current Session instead of stopping again. They still load the Skills relevant to the changed stage and re-run available validation.

The requirements stage also loads at most one primary presentation Skill and one primary industry Skill. Those Skills supply context-specific decisions, definitions, segments, caveats, and test cases; they do not repeat the universal workflow.

## Upstream Review and Pinning

The professional pack is vendored under `apps/agent/skills` so the explicit Agent `ResourceLoader` can discover it in production. Each redistributed or adapted Skill retains its license and provenance. Upstream changes are reviewed and pinned deliberately rather than fetched during deployment.

| Skill | Upstream | Reviewed revision | License | MDA treatment |
|---|---|---|---|---|
| `measure-dashboard-requirements` | `product-on-purpose/pm-skills` | `69df49c3eff24b3fa1a29d0bd6a35ae400af4f3e` | Apache-2.0 | Adapted to produce an implementation brief, capture evidence-backed multi-view composition and workflow-board semantics, defer encoding choice, respect read-only source context, and avoid fabricated capabilities. |
| `data-visualization` | `anthropics/knowledge-work-plugins` | `5267cf7bff3031921d4474b8e8f86ad02d2b8f6d` | Apache-2.0 | Adapted from Python-figure guidance to browser dashboards; adds purposeful multi-view composition while retaining chart-selection, accuracy, color, labeling, and accessibility know-how. |
| `frontend-design` | `anthropics/skills` | `3b3fad96af16a10759d930941b4520ba0c40edae` | Apache-2.0 | Adapted with an MDA decision-interface preface so the upstream hero guidance does not turn dashboards into landing pages or single-component posters. |
| `webapp-testing` | `anthropics/skills` | `3b3fad96af16a10759d930941b4520ba0c40edae` | Apache-2.0 | Adapted with MDA capability, honesty, coordinated multi-component, and Kanban interaction checks; upstream helper and examples remain bundled for environments with Playwright. |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | `dd089a8c752c966dee8bf0f27cb625ba193ffd9e` | MIT (declared by the Skill) | Vendored with a React/Vite compatibility preface; detailed rules remain on demand. |
| `web-quality-audit` | `addyosmani/web-quality-skills` | `95d6e255afe1596b557d7a8498517884438f5b3a` | MIT | Adapted to separate Agent-owned findings from platform-owned headers, hosting, and shell concerns. |

Source review is mandatory even when a registry reports passing security scanners. In particular, bundled scripts are instructions and code with the same effective trust as any other Agent resource. Deployment never downloads or updates Skills dynamically.

## Replacement Audit

The previous generic Skills were removed rather than retained as aliases:

- `dashboard-foundations` was replaced by `measure-dashboard-requirements`, `frontend-design`, `webapp-testing`, and `web-quality-audit` at their respective stages.
- `dashboard-data-communication` was replaced by the MDA-adapted `data-visualization` Skill.
- `dashboard-coding` remains because its workspace, manifest, approved-dependency, Data Source, Tool, and completion-reporting rules are unique to MDA.

Presentation Skills remain because viewing distance, decision latency, density, and interaction expectations are not covered by the professional foundations. `dashboard-kanban` owns workflow-board semantics, scan density, card hierarchy, and responsive lane behavior while leaving visual execution and source structure free. Industry Skills remain because their metric relationships, denominators, segmentations, privacy constraints, and failure modes are domain know-how. Generic visual, chart, React, testing, and audit advice belongs only to the professional Skills.

The stack-specific additions in the research set are intentionally not installed: Streamlit, Vizro, Grafana, Kibana, Retool-style dense UI, and single-file prototype Skills conflict with MDA's fixed React/Vite runtime or impose a presentation niche. They may be reviewed later only if MDA adds the matching runtime or explicit product mode.

## Presentation Context

Select at most one primary presentation Skill:

- `dashboard-executive`
- `dashboard-operations`
- `dashboard-analytical`
- `dashboard-kanban`
- `dashboard-storytelling`
- `dashboard-wallboard`
- `dashboard-mobile`

If none clearly matches, do not force the nearest theme.

## Industry Context

Select at most one primary industry Skill:

- `dashboard-finance`
- `dashboard-sales`
- `dashboard-marketing`
- `dashboard-product`
- `dashboard-support`
- `dashboard-supply-chain`
- `dashboard-manufacturing`
- `dashboard-healthcare`
- `dashboard-cybersecurity`
- `dashboard-sustainability`
- `dashboard-people`
- `dashboard-project-portfolio`
- `dashboard-ecommerce`
- `dashboard-public-sector`

A second industry Skill is appropriate only for an explicitly cross-domain request whose information requirements are materially distinct.

## Precedence and Capability Rules

1. User requirements and already-approved Session decisions take precedence unless they conflict with safety, truthful data communication, accessibility, or hard runtime boundaries.
2. The MDA system prompt and `dashboard-coding` define platform capabilities. Upstream examples cannot authorize package installation, external network access, protected-file edits, Data Source management, browser execution, Preview success, or publication.
3. `data-visualization` owns view-portfolio, chart, and encoding judgment. Requirements and industry Skills define the question, view role, metric, and caveat rather than prescribing a duplicate component or chart catalog.
4. `frontend-design` owns universal aesthetic direction and visual hierarchy across the selected components. Presentation and industry Skills add only context-specific constraints.
5. `vercel-react-best-practices` is selective: Next.js, server-component, SWR, third-party script, and unavailable-package rules do not apply to the current template.
6. `webapp-testing` and `web-quality-audit` must distinguish executed checks from source review. Missing browser, Lighthouse, screen-reader, field-data, HTTPS, CSP-header, or hosting access is reported as unverified or platform-owned, never as passed.
7. Never fabricate production data. Sample or fixture data must be visibly labeled in the dashboard and completion report.

## Runtime Behavior

The Agent `ResourceLoader` recursively discovers reviewed `SKILL.md` files under `apps/agent/skills`. Pi appends Skill names, descriptions, and absolute paths to the system prompt and loads full files on demand through the `read` Tool.

The MDA system prompt encodes the phased workflow and approval gate. Full Skill content remains outside the initial prompt, preserving context for the user, source, Tool results, and iteration history.

## Validation

Automated tests verify:

- Every Skill has valid Agent Skills frontmatter.
- Names are unique and use lowercase letters, digits, and hyphens.
- Descriptions are specific enough for selection.
- Discovery produces no diagnostics.
- All professional, presentation, and industry Skills are present.
- Replaced generic Skill names are absent.
- The system prompt contains the requirements approval gate, staged Skill names, evidence-backed multi-view dashboard preference, component freedom, compatibility boundaries, and fixture-label rule.

Deployment verification uses the newest local `bun run mda` against the newest deployed environment. A real dashboard conversation must first read requirements and matching context Skills, stop for approval, then read visualization/design/React/testing/audit Skills during implementation and accurately report which checks actually ran.

## Acceptance Criteria

1. A new dashboard does not enter source implementation before its requirements brief is approved.
2. Every implemented dashboard uses the six-stage professional pack plus MDA's platform workflow Skill.
3. Relevant presentation and industry know-how changes requirements and caveats without loading the whole catalog.
4. Generic guidance has one semantic owner; removed home-grown foundations do not survive as aliases or copied sections.
5. When authorized evidence supports multiple distinct questions, generated work defaults to a coordinated dashboard of complementary data components; a single-view result is intentional, not an unexamined default.
6. Generated dashboards remain ordinary exportable source code with no prescribed component count, chart, or layout schema.
7. Critical and high source-owned findings are fixed before completion; unavailable checks are disclosed.
8. No Skill causes fabricated production data, source capabilities, Tool results, browser tests, Preview state, or publication claims.
