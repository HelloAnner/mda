# Why MDA Uses a Coding Agent Instead of GenUI

## 1. Decision

MDA uses a real Coding Agent as its dashboard-generation core instead of a GenUI architecture based on predefined components or a UI schema.

Status: **Accepted**

Primary reason:

> MDA's highest priority is flexibility and the Vibe Coding experience, not deterministic assembly from a fixed component catalog.

A user should work with MDA in the same general way they work with Codex CLI or Claude Code on a local project:

1. Describe what they want in natural language.
2. Watch the Agent inspect data, read files, call Tools, and edit source.
3. Preview the result.
4. Continue the same conversation.
5. Ask for any visual, structural, or behavioral change.
6. Inspect Diffs, errors, logs, and Tool calls.
7. Keep, export, publish, or share the resulting code.

The Agent creates a real TypeScript web project. It does not merely choose items from a platform-defined UI menu.

## 2. Product Principle

From the dashboard author's perspective, MDA provides only one creative input:

> The platform provides authorized data. The Coding Agent decides what to build with it.

The platform necessarily provides operational infrastructure such as authentication, sandboxing, source persistence, builds, previews, publishing, and sharing. Those facilities protect and operate the result, but they do not design the result.

The platform does not decide:

- Which components exist.
- Which chart type to use.
- Which filters appear.
- How controls behave.
- How the page is laid out.
- How navigation works.
- Which visual hierarchy is appropriate.
- Whether the result even looks like a conventional dashboard.

Those decisions belong to the Coding Agent and the user conversation.

## 3. What GenUI Means Here

In this decision, GenUI refers to systems where a model produces a structured UI description that a host application renders through known components.

A typical GenUI response resembles:

```json
{
  "type": "dashboard",
  "layout": "grid",
  "children": [
    {
      "type": "metric-card",
      "title": "Revenue",
      "query": "monthly-revenue"
    },
    {
      "type": "line-chart",
      "query": "revenue-trend",
      "grid": { "x": 0, "y": 1, "w": 8, "h": 4 }
    }
  ]
}
```

The host then maps `metric-card` and `line-chart` to registered application components.

This approach is valid for products whose main priorities are:

- Predictable UI structure.
- A small known set of interactions.
- Strong visual uniformity.
- Fast rendering without a build step.
- Low-risk output from a constrained component registry.
- Forms or workflows with a stable schema.

MDA has a different priority order.

## 4. Why GenUI Does Not Fit MDA's Primary Goal

### 4.1 A Component Registry Becomes the Creative Ceiling

A GenUI system can generate only what its renderer understands.

If the registry contains:

```text
metric-card
line-chart
bar-chart
table
date-filter
select-filter
```

then every generated result is ultimately assembled from those concepts. A model may combine them creatively, but it cannot create a genuinely new interaction without first extending the platform registry and schema.

MDA must allow the Agent to create:

- A custom SVG visualization.
- A Canvas or WebGL experience.
- A narrative, scroll-driven report.
- A dense operational console.
- An interactive map.
- A custom comparison tool.
- A timeline with unusual interactions.
- A presentation, microsite, or data story.
- A page that does not resemble a standard dashboard.

A required component registry would make these possibilities exceptions instead of normal outcomes.

### 4.2 A UI Schema Moves the Bottleneck to the Platform Team

With GenUI, every new capability requires platform work:

```text
new idea
  → design schema
  → implement component
  → define validation
  → add renderer support
  → version compatibility
  → update model instructions
  → only then can users generate it
```

With a Coding Agent:

```text
new idea
  → Agent writes the code
  → build
  → preview
  → iterate
```

MDA is intended to remove the platform team from the critical path of each new page idea.

### 4.3 The Output Is a Description, Not the Application

A GenUI document describes an application in platform-specific terms. It is not necessarily a normal project that a developer can open, understand, and continue editing with ordinary tools.

MDA treats source code as the primary artifact:

```text
dashboard/
├── dashboard.manifest.json
├── src/
├── public/
├── package.json
└── dist/
```

The user can inspect, Diff, export, and continue editing this source. The source remains useful outside the original conversation and does not depend on a proprietary component-tree representation.

### 4.4 Fixed Layout Schemas Conflict with Vibe Coding

Vibe Coding depends on rapid, unconstrained iteration:

```text
"Make this feel more editorial"
"Turn the chart into a scroll-driven story"
"Replace the filters with a timeline"
"Make the mobile version work completely differently"
"Build a custom comparison interaction"
```

A model working through source files can interpret these requests and change any part of the implementation.

A schema-based system must either:

- Reject requests the schema cannot express.
- Approximate them with existing components.
- Add increasingly complex escape hatches.
- Eventually embed arbitrary code inside the schema.

The last option recreates a Coding Agent badly, while retaining the complexity of the schema layer.

### 4.5 Round-Tripping Through a Visual Model Damages Source Ownership

GenUI systems often want both a visual editor and generated output. This creates a round-trip problem:

```text
source code → parsed UI model → visual edit → regenerated source
```

Regeneration may reorder files, discard abstractions, rewrite styles, or erase deliberate custom behavior.

MDA avoids that conflict:

- Source is authoritative.
- The Coding Agent edits source directly.
- Preview renders the built source.
- The management system never rewrites `src/**` through a visual model.

### 4.6 Schema Evolution Becomes Product Debt

A required GenUI schema creates long-term compatibility obligations:

- Old component versions.
- Removed Props.
- Layout migrations.
- Renderer differences.
- Schema upgrade tools.
- Export compatibility.
- Partial support across clients.

MDA still has versioned boundaries, but they are smaller:

- Dashboard Manifest.
- Runtime Data API.
- Query Bindings.
- Build entry point.

The internal page implementation remains ordinary code and evolves through ordinary source changes.

## 5. Why a Coding Agent Fits MDA

### 5.1 The Agent Can Create Anything the Runtime Can Build

The Coding Agent controls `src/**` and `public/**`.

It may:

- Create any number of files.
- Choose any component structure.
- Use React components or lower-level browser APIs.
- Write CSS, SVG, Canvas, and WebGL code.
- Build custom controls and interactions.
- Refactor existing code.
- Replace an implementation completely.
- Add responsive and accessible behavior.
- Transform data in application code.
- Debug build and runtime failures.

The only hard limits are system and security boundaries, not presentation boundaries.

### 5.2 The Agent Works on a Real Project

The Agent has the same basic working model as a local Coding Agent:

```text
conversation
  → inspect project
  → inspect data description
  → read files
  → edit files
  → run build
  → inspect errors
  → fix code
  → preview
  → continue conversation
```

This is the experience users already understand from tools such as Codex CLI and Claude Code.

MDA changes the environment, not the fundamental interaction:

- The workspace is managed and isolated.
- Data access is provided through safe Tools.
- Sessions are persisted centrally.
- Preview, publishing, and sharing are built in.
- The same workflow is available through web and the `mda` CLI.

### 5.3 Conversation Has Real Technical Context

The Coding Agent can see and reason about:

- Existing source files.
- Previous implementation decisions.
- Build errors.
- Runtime errors.
- Tool results.
- Data-source descriptions.
- Query result shapes.
- Previous conversation turns.
- File Diffs and Revisions.

A follow-up request modifies the actual implementation rather than generating a new disconnected UI description.

### 5.4 Debugging Is Part of Generation

Real applications fail in real ways:

- Type errors.
- Missing imports.
- Incorrect data assumptions.
- Empty results.
- Layout overflow.
- Runtime exceptions.
- Query parameter mismatches.

A Coding Agent can inspect these failures, edit the relevant files, rebuild, and try again.

MDA exposes errors and Tool calls instead of hiding them behind a one-shot generation response.

### 5.5 Source Can Leave the Platform

A dashboard source export contains an ordinary TypeScript project rather than a proprietary UI document.

This matters because users can:

- Audit the implementation.
- Keep source in their own repository.
- Continue with another Coding Agent.
- Review changes through normal Diffs.
- Rebuild a historical Revision.
- Understand what was published.

Portability is a direct consequence of code being the artifact.

## 6. Target User Experience

### 6.1 Local Coding Agent Feel

A typical CLI workflow should feel familiar:

```bash
mda dashboard generate \
  --name "Revenue Analysis" \
  --source sales-prod \
  --prompt "Create an interactive revenue analysis experience"

mda chat <dashboard-id>
```

Then:

```text
You › Make the regional comparison more visual and improve mobile behavior.

Agent › I will inspect the current implementation and query result shape.

  read                   src/App.tsx                         ✓
  read                   src/styles.css                      ✓
  describe_data_source   sales-prod                          ✓
  edit                   src/RegionalComparison.tsx          ✓
  edit                   src/styles.css                      ✓
  build_preview                                               ✓

Agent › Updated the regional comparison and added a dedicated mobile layout.
```

The important properties are:

- The same conversation continues.
- The Agent works on existing files.
- Tool activity is visible.
- The result can be previewed immediately.
- The user can ask for another change without starting over.

### 6.2 Web Experience

The web UI provides the same working model:

- Conversation beside Preview.
- Streaming Agent output.
- Tool calls and build status.
- File changes and Revision Diffs.
- Continue, resume, fork, or cancel.
- Validate, publish, share, and export.

The web UI is not a drag-and-drop editor that owns the component tree. It is a managed Coding Agent workspace.

### 6.3 CLI and Web Continuity

A user may begin in one interface and continue in the other:

```text
web conversation
  → close browser
  → mda chat --session session_123
  → continue editing
  → publish
  → inspect later in web
```

Both clients operate on the same Dashboard, Session, Jobs, Revisions, and Tool events through the Control Plane.

## 7. What the Platform Provides

MDA provides a small set of capabilities around the Coding Agent.

### 7.1 Workspace

- A real TypeScript project.
- A fixed build entry point.
- Approved dependencies.
- Source and Revision persistence.
- Isolated execution.

### 7.2 Data

- Authorized Data Source listing.
- Factual schema descriptions.
- Safe design-time exploration.
- Agent-authored registered queries.
- Live Runtime `dashboard.query()` and polling-based `dashboard.watch()` access.
- Structured rows, metadata, and errors.

### 7.3 Operation

- Agent Sessions and Jobs.
- Event streaming.
- Builds and Preview.
- Validation.
- Publishing and sharing.
- Source and conversation export.

These are infrastructure capabilities. None of them define the page's component structure.

## 8. What the Platform Does Not Provide

MDA does not require:

- A dashboard component registry.
- A chart registry.
- A filter registry.
- A layout grid schema.
- A visual component tree.
- A JSON UI DSL.
- A model-to-component renderer.
- A drag-and-drop editor that rewrites source.
- A required React component hierarchy.
- A list of approved page types.
- A rule that the result must look like a dashboard.

The platform may ship optional libraries and examples. Optional tools must remain optional.

## 9. Data Is Presentation-Neutral

The Data Gateway returns facts:

```json
{
  "rows": [
    {
      "region": "North",
      "revenue": 125000,
      "growth": 0.18
    }
  ],
  "meta": {
    "columns": [
      { "name": "region", "type": "string" },
      { "name": "revenue", "type": "number" },
      { "name": "growth", "type": "number" }
    ]
  }
}
```

It does not return presentation instructions:

```json
{
  "recommendedChart": "bar",
  "componentType": "region-ranking",
  "gridPosition": { "x": 0, "y": 0, "w": 6, "h": 4 },
  "controlType": "select"
}
```

The second example is explicitly outside the Data Gateway contract.

The Coding Agent may turn the same rows into:

- A table.
- A map.
- A custom SVG.
- A ranking animation.
- A comparison card.
- A narrative paragraph.
- A keyboard-driven explorer.
- Something not anticipated by the platform team.

## 10. The Dashboard Skill System Is Not GenUI

MDA provides layered Dashboard Skills to improve quality. Universal foundations are mandatory for dashboard work; presentation and industry Skills load only when their descriptions match the user goal. The full contract is `docs/dashboard-skills/skill-system.md`.

The Skills may explain:

- How to establish audience, decision, and visual hierarchy.
- How to use spacing, typography, alignment, color, and motion with restraint.
- How to preserve mobile usability, accessibility, and complete data states.
- How to choose among several truthful expressions for a data relationship.
- Which information, definitions, comparisons, risks, and caveats matter in a specific industry.
- How executive, operational, analytical, editorial, wallboard, and mobile contexts change reading priorities.

The Skills must not say:

- Use the platform's `MetricCard` component.
- Use a twelve-column platform grid.
- Emit a specific component JSON tree.
- Use a line chart for every time series.
- Restrict the page to registered components, layouts, or source structures.
- Make an industry dashboard imitate a cosmetic stereotype.

A Skill guides judgment and domain credibility. GenUI constrains representation. MDA uses the former and rejects the latter as a mandatory architecture.

## 11. Guardrails Without GenUI

Choosing a Coding Agent does not mean removing safety or reliability controls.

MDA applies boundary-based guardrails:

| Boundary | Enforcement |
|---|---|
| Workspace | Agent may modify only the assigned dashboard workspace |
| Data | Runtime queries use authorized Query Revisions |
| Credentials | Remain in server-side credential storage |
| Network | Sandbox and CSP restrict destinations |
| Dependencies | Build uses approved, pinned dependencies |
| Artifact | Build must produce the required entry point |
| Publication | Uses immutable validated Revisions |
| Runtime | Generated page runs on an isolated origin |

These rules define what the result may access and how it is operated. They do not define what the result must look like or how its components are written.

## 12. Manifest Scope

The Dashboard Manifest is not a UI schema.

It may declare:

- Schema version.
- Title and description.
- Build entry point.
- Runtime version.
- Query names, parameter types, and pinned Query Revisions.

It must not declare:

- Component trees.
- Chart types.
- Grid positions.
- Controls.
- CSS tokens.
- Internal state management.
- Interaction graphs.

If a proposed Manifest field describes presentation rather than an external runtime dependency, it should remain in source code instead.

## 13. Flexibility Examples

The following requests must not require a platform component or schema change:

```text
"Create a dashboard with a custom radial comparison."
"Build a data story with scroll-driven transitions."
"Make this look like a newspaper front page."
"Replace the dashboard with an operations command center."
"Create a map with custom animated routes."
"Use keyboard shortcuts for navigating the report."
"Build a mobile-first card stack and a separate desktop canvas."
"Turn the analysis into a presentation."
"Create a custom page that mixes prose, data, and illustrations."
```

These requests may require the Agent to write more code. That is expected and is the reason MDA uses a Coding Agent.

## 14. Tradeoffs We Accept

A Coding Agent architecture has real costs compared with constrained GenUI.

### 14.1 Variable Output

Two runs may produce different implementations. MDA addresses this with:

- Visible source.
- Build validation.
- Preview.
- Continuous conversation.
- Immutable Revisions.
- Regression simulations.

### 14.2 Build Failures

Generated code may fail to compile. MDA treats build/debug/fix as part of the Agent loop rather than assuming every first response is renderable.

### 14.3 Longer Generation Time

Editing, building, and validating code takes longer than rendering a small UI schema. MDA accepts this because flexibility is the primary product requirement.

### 14.4 Stronger Isolation Requirements

Arbitrary generated source needs a real sandbox, separate Preview origin, CSP, and limited credentials. These controls are mandatory.

### 14.5 More Complex Evaluation

Exact output snapshots are inappropriate for flexible code generation. MDA evaluates:

- Successful builds.
- Required data usage.
- Tool behavior.
- Runtime correctness.
- Accessibility checks.
- Browser smoke tests.
- User-requested outcomes.

### 14.6 Maintenance of Generated Code

Flexible code can vary in quality. MDA mitigates this through:

- Strict TypeScript.
- Aesthetics and engineering Skills.
- Approved dependencies.
- Build and browser checks.
- Continued Agent refactoring.
- Source export and review.

These costs are accepted deliberately. Replacing the Coding Agent with GenUI would optimize against the product's main goal.

## 15. Comparison

| Dimension | Required GenUI | MDA Coding Agent |
|---|---|---|
| Output | Platform UI schema | Real TypeScript source |
| Components | Registered set | Any implementation within runtime boundaries |
| Layout | Schema-defined | Source-defined |
| New interaction | Platform feature work | Agent writes code |
| Debugging | Renderer/schema debugging | Normal build and runtime debugging |
| Iteration | Regenerate structured description | Edit existing project in one conversation |
| Portability | Depends on platform renderer | Source can be exported |
| Predictability | Higher | Lower, controlled by validation |
| Generation speed | Usually faster | Usually slower |
| Flexibility | Limited by schema | Primary strength |
| Security model | Constrained renderer | Sandbox and capability boundaries |
| Best use | Known workflows and components | Open-ended pages and dashboards |

MDA chooses the right-hand column because open-ended creation is the product.

## 16. Architecture Consequences

This decision requires:

1. A persistent real workspace for each Dashboard.
2. A Coding Agent with file and build Tools.
3. Isolated Agent execution.
4. Source Revisions and Diffs.
5. A stable build contract.
6. Preview of built artifacts.
7. Detailed Tool, error, and log visibility.
8. Continuous resumable Sessions.
9. A presentation-neutral Data Gateway.
10. Source and artifact export.

It also means the management system should be designed as a Coding Agent control plane, not as a low-code renderer.

## 17. Product and Architecture Rules

Future work must preserve these rules:

1. `src/**` remains authoritative for presentation and interaction.
2. The platform does not require a component tree outside source code.
3. Data-source APIs remain presentation-neutral.
4. Skills may guide quality but cannot enforce a component catalog.
5. Preview renders the built project; it does not reconstruct a UI from metadata.
6. Publishing stores source and build artifacts.
7. The `mda` CLI and web UI expose file, Tool, error, and Session visibility.
8. New capabilities should normally be exposed as Tools or Runtime APIs, not required UI components.
9. Optional templates must be replaceable by the Agent.
10. An unusual user request should fail only for a real runtime, security, or data limitation—not because the platform lacks a component type.

## 18. Warning Signs of Accidental GenUI Drift

The architecture should be reviewed if a proposal introduces required fields such as:

```text
componentType
chartType
gridPosition
controlType
children[] as the authoritative page tree
```

Other warning signs:

- The platform must implement a new component before the Agent can satisfy a request.
- A visual editor rewrites Agent source.
- The Manifest begins describing pixel or layout decisions.
- Data Source responses recommend UI components.
- Generated source becomes a compiled byproduct of a proprietary schema.
- Users can no longer export a normal project.
- Conversation changes operate on metadata instead of real files.

These patterns should be rejected unless they are strictly optional helpers that never become the authoritative representation.

## 19. Where GenUI May Still Be Used

This decision rejects GenUI as MDA's required generation architecture. It does not prohibit optional use in narrow contexts.

Possible optional uses:

- Rendering a confirmation dialog for a Tool call.
- Displaying structured Agent progress in the management UI.
- Building fixed administration forms.
- Showing known error or audit records.
- Offering a non-authoritative starter suggestion.

These cases concern the MDA management interface, not the generated Dashboard source.

GenUI must never become the required storage or rendering format for user-created pages.

## 20. Acceptance Criteria

This decision remains satisfied when:

1. A user can ask for a page concept that has no prebuilt platform component.
2. The Coding Agent can satisfy it by editing ordinary source files.
3. No UI schema or component registry change is required.
4. The Agent can build, inspect errors, fix the implementation, and Preview again.
5. The same Session can continue through web or `mda` CLI.
6. Users can inspect Diffs, Tool calls, errors, logs, and Revisions.
7. Users can export a normal TypeScript project.
8. Data Source responses contain data descriptions, not presentation instructions.
9. The layered Dashboard Skills improve aesthetics and domain credibility without defining components.
10. Security restrictions constrain capabilities rather than visual design.
11. Published pages run without invoking Pi.
12. The system can create any page or dashboard supported by the browser runtime and authorized data, not merely templates anticipated by the platform team.

## 21. Summary

MDA is not a model-driven component renderer. It is a managed Vibe Coding environment centered on a Coding Agent.

The platform supplies data and safe operating boundaries. The Coding Agent supplies the application.

That choice is less deterministic than GenUI, but it preserves the quality MDA values most:

> A user can describe an idea, watch a Coding Agent build the real project, and continue shaping it without waiting for the platform to invent a component for them.
