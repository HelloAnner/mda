# Dashboard Skill System

## Purpose

MDA uses platform-maintained Agent Skills to raise dashboard quality without defining a component catalog, chart registry, layout schema, or proprietary UI model.

The Coding Agent remains the sole author of `src/**` and `public/**`. Skills guide judgment: audience, decision framing, information hierarchy, data semantics, interaction, state handling, accessibility, visual character, and industry cautions. They never make a component, chart type, grid, CSS architecture, or file structure mandatory.

## Principles

1. **Aesthetics are functional.** Hierarchy, typography, spacing, alignment, color, motion, and material treatment must clarify meaning rather than decorate an unfinished structure.
2. **Source remains free.** The Agent may create any implementation supported by the approved browser runtime, including custom React, CSS, SVG, Canvas, WebGL, tables, maps, narrative pages, or unfamiliar interactions.
3. **Purpose precedes form.** Every dashboard begins with its audience, decision, time horizon, primary question, and available evidence.
4. **Data stays truthful.** Units, periods, baselines, denominators, freshness, uncertainty, truncation, and missing values remain visible when they affect interpretation.
5. **States are part of the design.** Loading, empty, partial, stale, refreshing, error, unauthorized, and normal states receive intentional treatment.
6. **Progressive disclosure controls context.** Universal skills are always read. Presentation and industry skills are loaded only when they match the request.
7. **Industry knowledge is semantic, not cosmetic.** A healthcare skill explains quality and safety context; it does not require blue cards. A cybersecurity skill explains risk and response context; it does not require neon visuals.

## Skill Layers

### Mandatory foundations

Every request that creates, modifies, reviews, or repairs a dashboard must load:

- `dashboard-coding`: workspace workflow, validation, data-source boundaries, and honest completion reporting.
- `dashboard-foundations`: audience, hierarchy, responsive composition, interaction states, accessibility, and aesthetic review.
- `dashboard-data-communication`: analytical relationships, visual encoding, labels, color semantics, tables, uncertainty, and data integrity.

A request that only asks a general question and does not change or review a dashboard does not need these files.

### Presentation context

The Agent normally selects at most one primary presentation skill:

- `dashboard-executive`
- `dashboard-operations`
- `dashboard-analytical`
- `dashboard-storytelling`
- `dashboard-wallboard`
- `dashboard-mobile`

These describe viewing distance, decision latency, density, reading order, and interaction expectations. They are not visual presets.

### Industry context

The Agent normally selects at most one primary industry skill:

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

An additional industry skill is appropriate only when the user explicitly asks for a cross-domain view and the information requirements are materially distinct.

## Selection Rules

1. Read all mandatory foundation skills before editing dashboard files.
2. Infer presentation and industry context from the user request, data-source summary, existing source, and current conversation.
3. If no optional skill clearly matches, use only the foundations. Never force the nearest theme.
4. If the user specifies a visual direction, preserve it unless it conflicts with accessibility, truthful data communication, or runtime safety.
5. When presentation and industry guidance conflict, preserve factual industry semantics and adapt the visual expression to the presentation context.
6. Skills never authorize Data Source management, credential access, publication claims, or network behavior.

## Skill Content Contract

Each optional skill should contain only guidance that changes judgment for its context:

- Intended audience and decisions.
- Information priorities and metric relationships.
- Appropriate density, reading order, and visual character.
- Interaction, refresh, and status expectations.
- Domain definitions, denominators, segmentations, and caveats.
- Failure patterns to avoid.
- A short quality gate.

A skill must not contain:

- Required component names or imports.
- A fixed component tree or twelve-column grid.
- Mandatory chart selection for a data type.
- Required CSS classes, design tokens, or file structure.
- Database queries, credentials, or source configuration.
- Instructions to claim a Preview, build, publication, or live-data connection without successful Tools.

## Prompt and Runtime Behavior

The Agent `ResourceLoader` recursively discovers reviewed `SKILL.md` files under `apps/agent/skills`. Pi appends skill names, descriptions, and absolute paths to the system prompt and loads full files on demand through the `read` Tool.

The MDA system prompt explicitly requires the three foundation skills for dashboard work and instructs the Agent to choose optional skills sparingly. Full skill content remains outside the initial prompt, preserving context for the user, source, Tool results, and iteration history.

## Validation

Automated tests must verify:

- Every skill has valid Agent Skills frontmatter.
- Names are unique and use lowercase letters, digits, and hyphens.
- Descriptions are specific enough for model selection.
- Discovery produces no diagnostics.
- All mandatory and cataloged skills are present.
- The system prompt contains the mandatory loading and component-freedom policies.

Deployment verification must use the newest local `bun run mda` against the newest `moss-dev-2` deployment. A real dashboard prompt must cause the Coding Agent to read the three foundations and the matching optional presentation and industry skills before creating source.

## Research Basis

The first catalog synthesizes guidance from Tableau dashboard best practices, Microsoft Power BI dashboard design, FineReport dashboard examples, Grafana dashboard practices, IBM Carbon data visualization, WCAG 2.2, UK Government Analysis Function and ONS visualization guidance, Google HEART, DORA, NIST CSF 2.0, IFRS Sustainability Standards, AHRQ Quality Indicators, ASCM SCOR, and ecommerce operating metrics.

The durable design conclusions are:

- Start with audience and decision.
- Make the primary signal visually dominant.
- Reduce cognitive load and visual noise.
- Choose form from the analytical relationship, not fashion.
- Use color semantically and never as the only cue.
- Preserve complete operational and accessibility states.
- Teach domain relationships and cautions instead of KPI card inventories.

Research artifacts and source evidence are kept outside the repository; this document remains the implementation source of truth.

## Acceptance Criteria

1. A dashboard task always loads the three foundation skills.
2. A clearly matched task loads relevant optional skills without loading the entire catalog.
3. A vague or unfamiliar task still receives complete foundational guidance.
4. Skills improve information hierarchy, aesthetic coherence, state completeness, and domain credibility.
5. The Agent can create an unanticipated component or interaction without changing any MDA schema or skill.
6. No skill makes a component, chart, layout, or source structure authoritative.
7. Generated dashboards remain ordinary exportable source code.
