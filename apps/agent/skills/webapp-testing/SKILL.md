---
name: webapp-testing
description: Plans and executes functional dashboard checks for filters, tables, navigation, keyboard behavior, responsive layouts, data states, and browser console errors. Use after implementation; run Playwright only when a real browser target and dependencies are available, and report unexecuted checks honestly.
license: Apache-2.0; see LICENSE.txt
metadata:
  author: anthropic
  upstream-revision: 3b3fad96af16a10759d930941b4520ba0c40edae
  mda-adapted: "true"
---
<!--
Adapted by MDA from anthropics/skills at the revision above.
Changes: retained the upstream Playwright reconnaissance-and-action workflow and
helpers, added coordinated multi-component dashboard and Kanban state/interaction
checks, and made MDA build/Preview capability boundaries and honest reporting
explicit.
-->

# Web Application Testing

Functional testing proves behavior; reading source and completing a build do not. Start by identifying what must be tested, then execute only against a real runnable target.

## MDA capability check

Before claiming browser testing, establish all three facts:

1. A reachable URL or locally runnable target exists for the exact current source.
2. A browser runner such as Playwright and its browser binary are available.
3. The test can run without installing packages, changing protected files, exposing credentials, bypassing access controls, or connecting to an unapproved destination.

`validate_dashboard` and `build_preview` prove the fixed clean build and artifact boundary. They do **not** prove browser rendering or interactions, and a successful `build_preview` call does not itself provide a URL inside the current Agent Job. If no runnable browser target exists, still create and apply the source-review matrix below, run the available build Tool, and report browser checks as **not run**—never as passed.

Do not add test files, package files, Playwright dependencies, screenshots, logs, or generated output to the dashboard source boundary. The bundled upstream Python helper and examples are available for a compatible environment; they are not permission to install missing software in MDA.

## Test inventory

Read the approved requirements, source, and manifest. Inventory:

- Global and local filters, defaults, dependent options, clear/reset actions, and preserved scope.
- The approved dashboard view roles and every coordination path between summaries, charts, tables, lists, boards, and details; identify which components should update, highlight, or remain fixed together.
- Tabs, links, drill paths, expandable regions, modals, menus, and return paths.
- Sort, search, pagination, selection, export, and row actions that genuinely exist.
- For Kanban or workflow boards: lane counts and WIP, card ordering and detail return, empty lanes, blocked/aging evidence, intentional board overflow, and move behavior only when persistent mutation actually exists.
- Loading, refreshing, empty, no-match, partial, stale, error, unauthorized, and normal states.
- Live regions, focus movement, keyboard order, escape behavior, and non-hover alternatives.
- Long labels, large and negative values, missing values, many rows/series, and fixture labels.
- Desktop and mobile layouts, local overflow, touch targets, and reduced motion.

Map each requirement and interactive control to at least one observable assertion. Do not test invented controls or unavailable capabilities.

## Browser workflow

### 1. Reconnaissance before action

For a dynamic app:

1. Navigate to the exact target and wait for application initialization. `networkidle` is useful only when polling or long-lived requests will not prevent it; otherwise wait for a stable, meaningful locator.
2. Capture browser console errors and uncaught page errors from the start.
3. Inspect the rendered DOM using roles, labels, visible text, and stable IDs.
4. Take a screenshot when the environment and model can actually inspect it.
5. Select locators from the rendered state rather than guessing.

Prefer user-facing locators such as role plus accessible name. CSS IDs are acceptable when intentionally stable. Avoid brittle DOM-depth and generated-class selectors.

### 2. Exercise behavior

For every control:

- Confirm its default state and accessible name.
- Perform the action by keyboard as well as pointer where applicable.
- Assert the visible result, current filter scope, every affected data component's coordinated update or highlight, unaffected context that should remain fixed, and the reset path. Fail silent mixed-scope states where one component remains stale or incompatible.
- Confirm unrelated state is preserved and focus is not lost.
- On a board, confirm filtering and refresh keep lane semantics and counts consistent. If moving cards is supported, test valid and invalid transitions, keyboard equivalence, save progress, failure rollback, and conflict behavior; otherwise verify that the UI does not imply write-back.
- Repeat boundary cases: no matches, a single result, long values, rapid changes, and failed or delayed data when controllable.

Do not merely click controls. An action passes only when the resulting state and data scope are correct.

### 3. Responsive checks

At minimum, test the requirements' primary desktop width and one narrow mobile width. Also inspect the breakpoint where layout changes.

Assert that:

- Primary content remains first and readable.
- The page has no unintended horizontal overflow.
- Any intentionally scrollable table, chart, or Kanban region is bounded and discoverable, with lane or header context preserved.
- Labels do not overlap or disappear.
- Controls remain reachable, named, and large enough for touch.
- Hover-only information has another path.

### 4. Accessibility behavior

Tab through the whole page. Verify visible focus, logical order, activation with Enter/Space, Escape where expected, dialog focus return, and no keyboard trap. Check that status changes are exposed as text and, where appropriate, via a live region. Reduced-motion mode must retain meaning.

### 5. Console and request failures

Fail the relevant scenario for uncaught exceptions, failed same-origin assets, repeated React warnings, hydration/render loops, or control actions that cause console errors. Distinguish an intentionally simulated data error from an application failure.

## Using the bundled upstream helper

Only in an environment where Python and Playwright are already available:

```bash
python /absolute/path/to/webapp-testing/scripts/with_server.py --help
```

Run `--help` before using the helper. It manages server lifecycle and accepts shell commands, so pass only reviewed local commands. Prefer a minimal ephemeral Playwright script and always close the browser. See `examples/` for selector discovery, static HTML, and console capture patterns; adapt paths and assertions rather than copying them blindly.

## Completion report

Report:

- Executed target and source revision, browser, viewport(s), and scenarios.
- Passed and failed assertions plus fixes made.
- Console or request errors observed.
- Checks performed only by source review.
- Checks not run and the exact missing capability.

A build-only result must say “build passed; browser functional testing not run,” not “fully tested.”
