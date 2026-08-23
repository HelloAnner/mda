---
name: measure-dashboard-requirements
description: Defines the audience, decisions, questions, metric formulas, source and quality needs, refresh cadence, filters, access constraints, states, and acceptance criteria for a dashboard. Use before creating a new dashboard or materially redesigning one; stop for approval before coding.
license: Apache-2.0; see LICENSE.txt
metadata:
  author: product-on-purpose
  upstream-revision: 69df49c3eff24b3fa1a29d0bd6a35ae400af4f3e
  mda-adapted: "true"
---
<!--
Adapted by MDA from product-on-purpose/pm-skills at the revision above.
Changes: tailored the output to MDA's conversational workflow and read-only Data
Source boundary; delegated chart selection; added state and approval requirements;
removed references to unrelated PM Skills and unsupported capabilities.
-->

# Dashboard Requirements

A useful dashboard starts with the decisions and questions it must support, not a collection of charts. Use this Skill to turn a request into a concise, testable implementation brief.

## When to use

Use for a new dashboard, a material redesign, a new audience, a changed metric contract, or a persistent report replacing ad-hoc analysis. A small visual fix may reuse requirements already approved in the current Session.

## MDA workflow

1. Read `dashboard-coding` and inspect the existing source, manifest, conversation, and credential-free Data Source summary.
2. Load at most one matching presentation Skill and one matching industry Skill. Use their domain definitions and caveats in the brief; do not copy their visual prose.
3. Draft the brief in the response using `references/TEMPLATE.md` as a checklist. Do not add a requirements document to the dashboard workspace unless the user explicitly requests one and the platform source boundary permits it.
4. Mark assumptions and unknowns. Never invent a production formula, target, source, field, permission, refresh capability, alert, export, or publication path.
5. For a new dashboard or material redesign, stop and ask for approval before editing source. Once the current Session contains explicit approval, continue to visualization and design.

## 1. Purpose and audience

Define:

- The primary audience, expertise, viewing context, device, and usage frequency.
- The decisions or actions the dashboard should inform.
- One primary question and a small number of supporting questions.
- The time horizon and decision latency: live response, daily operation, periodic review, or long-term explanation.
- What is explicitly out of scope.

If the request lacks detail, make the smallest reversible assumptions. Ask only questions whose answers materially change metric truth, access safety, or the product direction.

## 2. Metric contracts

For every proposed metric, capture:

- Business name and plain-language definition.
- Decision or question it supports.
- Formula, numerator, denominator, inclusion/exclusion rules, and aggregation.
- Entity grain, time grain, period, timezone, unit, and rounding.
- Baseline, target, threshold, and whether higher or lower is favorable, when known.
- Required segmentations and minimum sample rules.
- Actual authorized source or query, owner, freshness, latency, and known quality limits.

Do not convert an unknown into a plausible-looking number. If a formula or source is not established, label it `TBD` and make confirmation an acceptance dependency. Distinguish zero, missing, unknown, not applicable, delayed, estimated, and suppressed values.

## 3. Evidence and visualization needs

Describe the analytical relationship each view must communicate—status, trend, comparison, ranking, distribution, composition, deviation, correlation, flow, or geography—and the precision and interaction required.

Do **not** choose charts here. Load `data-visualization` after approval and let it own encoding selection. This separation prevents the requirements document from becoming a fixed component or chart specification.

## 4. Filters, interactions, and states

Specify only controls that support a real decision:

- Global and local filters, defaults, scope, dependencies, and reset behavior.
- Segments, drill paths, comparison baselines, sorting, search, or detail lookup.
- Loading, refreshing, empty, no-match, partial, stale, error, unauthorized, and normal states.
- Mobile, keyboard, long-label, large-result, and reduced-motion expectations.
- Any alert, export, sharing, or persistence need as a requirement—not as an available capability unless a Tool or platform contract confirms it.

## 5. Data access and privacy

Record who may view which level of data, sensitive fields that must be excluded or aggregated, small-sample suppression, and export restrictions. MDA's Data Source context is read-only: requirements may identify a need, but the Agent must not create, configure, test, enable, disable, or request credentials for a source.

When no authorized production source exists, choose either a useful empty state or clearly labeled fixture data. Never present fixtures as live, current, observed, or production data.

## 6. Acceptance criteria

Criteria must be observable and testable. Cover:

- Metric definitions and spot-check expectations.
- Filter and interaction behavior.
- State behavior, including failure and stale data.
- Required desktop and mobile widths plus keyboard access.
- Performance or result-size expectations when evidence exists.
- Correct access restrictions and fixture labeling.
- Successful MDA validation/build.
- Browser, accessibility, or quality checks that can actually be run; unavailable checks remain explicitly unverified.

## Quality gate

Before requesting approval, verify that the brief answers:

- Who uses this, to make which decision, at what cadence?
- What exact questions and metric contracts support that decision?
- Which authorized evidence exists, and what remains unknown?
- Which filters, states, privacy constraints, and responsive contexts matter?
- How will implementation be accepted without assuming unsupported capabilities?
- Are all fixture-data and uncertainty labels explicit?
