<!--
Adapted by MDA from product-on-purpose/pm-skills, Apache-2.0.
This compact conversational template replaces the upstream document-heavy chart
specification and delegates encoding decisions to data-visualization.
-->

# Dashboard implementation brief

## Purpose

- **Audience:**
- **Viewing context / device:**
- **Decision cadence:**
- **Primary decision:**
- **Primary question:**
- **Supporting questions:**
- **Out of scope:**

## Metric contracts

| Metric | Decision served | Definition and formula | Grain / period / unit | Baseline or target | Authorized source | Quality caveats |
|---|---|---|---|---|---|---|
| | | | | | | |

Use `TBD` rather than inventing a definition, value, field, source, or target.

## Evidence needs

| Question | Relationship to communicate | Required dimensions / precision | Evidence status |
|---|---|---|---|
| | | | Available / missing / fixture-only |

Chart and component choices are intentionally deferred to `data-visualization` and `frontend-design`.

## Controls and behavior

- **Global filters and defaults:**
- **Local interactions / drill paths:**
- **Comparison baseline:**
- **Reset and preserved context:**
- **Loading / refreshing:**
- **Empty / no-match:**
- **Partial / stale:**
- **Error / unauthorized:**
- **Mobile / keyboard / long-content behavior:**

## Data, access, and freshness

- **Authorized sources or registered queries:**
- **Refresh need and actual capability:**
- **Timezone / reporting cutoff:**
- **Sensitive data / minimum aggregation:**
- **Viewer or export restrictions:**
- **Fixture policy:** No fixtures / clearly labeled fixtures / empty state

## Visual direction constraints

Record only requirements already supplied by the user or context. Do not design here.

- **Brand or visual direction:**
- **Presentation context:**
- **Industry cautions:**

## Acceptance criteria

- [ ] Metric contracts are confirmed or visibly marked TBD.
- [ ] Filters and interactions produce the defined scope and reset behavior.
- [ ] Loading, empty, partial, stale, error, unauthorized, and normal states are intentional.
- [ ] Desktop, mobile, keyboard, long-content, and reduced-motion behavior is checked.
- [ ] Sensitive data and access constraints are preserved.
- [ ] Fixture data is visibly labeled and never described as production or live.
- [ ] MDA validation or Preview build succeeds.
- [ ] Executed browser and quality checks are distinguished from unverified checks.

## Assumptions and open questions

- **Reversible assumptions:**
- **Blocking questions:**
- **Approval requested:** Approve / revise before implementation
