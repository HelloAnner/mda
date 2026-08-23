---
name: data-visualization
description: Selects truthful, decision-appropriate visual encodings for dashboard trends, comparisons, distributions, composition, correlation, flow, geography, tables, and uncertainty. Use after dashboard requirements are approved and whenever charts, metrics, labels, color, or data states are created or reviewed.
license: Apache-2.0; see LICENSE.txt
metadata:
  author: anthropics-knowledge-work-plugins
  upstream-revision: 5267cf7bff3031921d4474b8e8f86ad02d2b8f6d
  mda-adapted: "true"
---
<!--
Adapted by MDA from anthropics/knowledge-work-plugins at the revision above.
Changes: converted Python plotting guidance into framework-neutral browser-dashboard
guidance; retained the upstream chart-selection, accuracy, color, labeling, and
accessibility principles; added dashboard context, states, tables, and data-quality
rules formerly owned by MDA's replaced dashboard-data-communication Skill.
-->

# Data Visualization

Choose the encoding from the question and evidence, not from fashion or field type. Explain why each selected form is the clearest truthful answer. The choices below are candidates, never a platform chart registry.

## 1. Identify the relationship

| Relationship | Strong candidates | Selection questions |
|---|---|---|
| Current status or target gap | Direct value with context, bullet plot, compact trend | Is the exact value, direction, threshold, or distance from target the decision? |
| Trend over time | Line, area for meaningful accumulation, small multiples | Are intervals real, gaps visible, and series count readable? |
| Category comparison or ranking | Bar, dot/lollipop, slope for two periods, table | Are labels long, exact lookup important, or ordering meaningful? |
| Distribution | Histogram, box, violin/strip, quantile summary | Must users see shape, spread, tails, or group differences? |
| Part to whole | Stacked bar, 100% stack, treemap for true hierarchy | Is the whole stable and are parts few enough to compare? |
| Deviation from baseline | Diverging bar, variance plot, reference band | Is the center meaningful and shared across items? |
| Correlation | Scatter, matrix/heatmap, small multiples | Are sample size, outliers, and non-causality clear? |
| Flow or stages | Sankey for material flows, funnel for a consistent cohort, step table | Do quantities conserve, and are stages from the same population and window? |
| Geography | Choropleth for rates, proportional symbols for counts, spatial table | Does location change the decision, and is normalization appropriate? |
| Exact multi-field lookup | Table | Will users scan, sort, filter, compare, or audit individual rows? |

Small multiples often compare many series more honestly than one overloaded chart. Text and annotation may be the best encoding when the main result is a single conclusion with little supporting variation.

## 2. Avoid misleading forms

- Do not use 3D or perspective; it distorts position, length, angle, and area.
- Prefer bars to pie or donut charts. Consider a pie only for a stable whole with fewer than six clearly distinct parts where approximate proportion—not precise comparison—is the task.
- Start bar-length axes at zero. A non-zero line-chart baseline may be valid when the range itself is the subject; label it clearly.
- Treat dual axes as a last resort. Separate or normalize series when independent scales could imply a false relationship.
- Do not compare middle segments in a many-series stack when users need precise ranking.
- Use area and bubble size only when magnitude by area is intentional and perceptually defensible.
- Keep time intervals proportional; never silently bridge missing periods.
- Correlation, simultaneity, and attribution are not causation.

## 3. Preserve comparison integrity

- Compare like with like: definition, entity, population, denominator, unit, currency, timezone, period, aggregation, and precision.
- Name the baseline: target, prior period, year over year, budget, forecast, benchmark, zero, or control range.
- Distinguish actual, estimate, target, forecast, revision, and plan.
- Show absolute contribution alongside percentage change when a small base could exaggerate movement.
- Keep comparable panels on consistent scales unless the changed scale is unmistakable and justified.
- State ranking direction and ties. Do not rank sensitive people or institutions without context and legitimate purpose.

## 4. Titles, labels, and numerical context

- Use a conclusion or question title when evidence supports it; use a neutral descriptive title while the result is uncertain.
- Put date range, filter scope, timezone, source/freshness, and material caveats close to the affected view.
- Label axes and values with units. Prefer direct labels to distant legends.
- Annotate only events or thresholds that change interpretation.
- Precision serves the decision: remove accidental decimals, align comparable numbers, and keep formats consistent.
- Distinguish `0`, missing, unknown, not applicable, delayed, suppressed, estimated, and truncated values.
- Show numerator, denominator, sample size, and exclusion rules when they change interpretation.

Never write a finding that is stronger than the evidence. Fixture values may demonstrate interaction but cannot support production conclusions and must be visibly labeled.

## 5. Color

- Use color to encode meaning, not decoration. Keep most structure neutral and reserve emphasis for the primary signal.
- Use a limited categorical palette; when categories multiply, prefer labels, grouping, filtering, or small multiples over a rainbow.
- Use a lightness-ordered sequential scale for ordered magnitude and a diverging scale only around a meaningful center.
- Keep alert colors scarce. A high value is not automatically bad, and normal status does not need a field of green.
- Preserve entity and state color meaning across the page.
- Never rely on red/green or color alone. Pair color with labels, shape, stroke, pattern, or position.

## 6. Tables and detail

For precise lookup, high-dimensional evidence, operations, and audit trails:

- Choose a meaningful default sort and stable column order.
- Align numbers by decimal or least-significant digit and text by reading direction.
- Keep units, totals, groups, selected state, and missing values explicit.
- Provide search, filtering, pagination, or virtualization for large results when the runtime supports it.
- Use conditional formatting only for the few values that require attention.
- Preserve header context on narrow screens; if a table becomes a detail view, do not lose fields required for comparison.

## 7. Uncertainty and data quality

Show uncertainty when it affects a decision: sample size, confidence or prediction intervals, error range, estimate status, coverage, revision, sampling, and truncation. Mark the forecast boundary. Aggregates can hide subgroup harm or long tails, so expose relevant segments and absolute counts without enabling unsafe re-identification.

Data-dependent views must distinguish loading, refreshing, empty, no filter matches, partial, stale, failed, unauthorized, and normal data. Retain last-known values with a timestamp when appropriate rather than presenting stale data as current or clearing useful evidence.

## 8. Accessibility

- Provide an accurate text summary of each important chart's question and key finding.
- Provide an accessible table or equivalent path when exact values matter.
- Use semantic headings and programmatic names; critical facts cannot exist only in hover tooltips.
- Ensure labels and data marks remain distinguishable at zoom, in high contrast, and without color.
- Support keyboard access for interactive marks and offer a non-drag alternative.
- Respect reduced motion and make the static state understandable.

## Quality gate

Before implementation is complete, verify:

1. Every view answers an approved question and its encoding choice can be explained.
2. Units, periods, baselines, denominators, filters, freshness, and caveats prevent foreseeable misreading.
3. Scales, areas, color, and ranking do not exaggerate or imply unsupported causality.
4. Missingness, uncertainty, forecasts, truncation, and fixture status remain visible.
5. Exact details and accessible alternatives exist where needed.
6. Removing any view would not make the dashboard clearer; if it would, remove it.
