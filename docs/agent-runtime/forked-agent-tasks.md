# Forked Agent Tasks

## 1. Status and Decision

Status: **Proposed**

MDA should support optional, Agent-selected parallel delegation through a
structured `fork_tasks` Tool.

The feature is an execution strategy for the existing Moss Coding Agent. It is
not a dashboard layout model, component system, region schema, multi-agent role
catalog, or replacement for ordinary single-Agent authoring.

The governing decision is:

> One root Moss remains responsible for the user outcome. It may create fresh,
> disposable Moss children for independently executable tasks, but every parent
> owns the integration of its direct children and the root owns the final
> dashboard.

The first release must be deliberately narrow: one level of read-only children,
at most four children per Fork, and no recursive source mutation. Writable
children and depth-two recursion are later gates that require measured benefit
and reliable whole-page browser verification.

## 2. Purpose

Complex dashboards may contain several bodies of work that can proceed from the
same approved requirements and source snapshot, for example:

- Inspecting independent Data Sources or Query result shapes.
- Exploring several analytical relationships.
- Developing independent content modules.
- Reviewing accessibility, mobile behavior, or data truthfulness.
- Implementing source areas whose writable paths do not overlap.

A single Coding Agent performs these tasks serially even when they are
independent. Forked Agent Tasks allow Moss to identify such work, execute it in
parallel with fresh context windows, and then integrate the results into one
coherent dashboard.

The feature has three goals:

1. Reduce wall-clock time for genuinely decomposable dashboard work.
2. Preserve source-level flexibility and the ordinary Vibe Coding experience.
3. Make every delegated task, relationship, result, cost, and failure observable
   and recoverable.

Parallelism is not itself a product outcome. If delegation does not improve
latency without reducing quality, Moss must remain on the single-Agent path.

## 3. Product Boundary

### 3.1 What the Feature Changes

The feature adds:

- A `fork_tasks` Tool available to eligible Moss runs.
- Fresh child Pi Sessions using the same reviewed Moss runtime.
- A bounded asynchronous child scheduler.
- Parent, root, Fork-group, and depth lineage.
- Isolated child workspaces and result artifacts.
- Recursive status queries and nested progress events.
- Explicit join and integration behavior.
- Descendant cancellation, budgets, usage accounting, and recovery.

### 3.2 What the Feature Does Not Change

The feature does not add any required concept of:

- Dashboard regions, panels, lanes, axes, or coordinates.
- Component types, chart types, controls, or layout slots.
- A UI schema, component tree, or low-code representation.
- Predefined agents such as header, chart, table, or footer agents.
- Micro-frontends or separately published region applications.
- A second authoritative representation of dashboard source.

`src/**` and `public/**` remain authoritative. The Dashboard Manifest remains an
external runtime contract and must not acquire Fork, task, region, component, or
layout fields.

A parent may describe a child assignment as an “area” when that is useful, but
that word has no platform-defined geometry or semantics. The parent may instead
decompose by analysis, interaction, data dependency, source responsibility, or
any other boundary it judges appropriate.

## 4. Necessity and Routing Decision

Forking is useful only when parallel execution saves more time than delegation,
context preparation, joining, and integration consume.

Moss may Fork only when all of the following are true:

1. At least two tasks can make meaningful progress from the same immutable base.
2. Each task has a concrete, independently verifiable deliverable.
3. The outputs can be synthesized or merged predictably.
4. Writable tasks have non-overlapping, parent-selected source scopes.
5. The parent has an explicit integration plan.
6. Sufficient time, token, cost, and integration budget remains.

Moss must not Fork for:

- Small changes or focused repairs.
- Work with unclear or unapproved requirements.
- Page-wide visual direction and information hierarchy.
- A task centered on one shared mutable file or state model.
- Final composition, whole-page validation, publication, or delivery.
- Work whose likely execution time is shorter than its coordination overhead.
- The purpose of merely appearing parallel or using available capacity.

The default policy is:

> Parallel reasoning first; parallel authorship only when source ownership is
> genuinely independent.

The runtime enforces hard limits. Model judgment is never the only recursion,
cost, isolation, or concurrency boundary.

## 5. Terminology

| Term | Definition |
|---|---|
| Root Agent | The Moss instance handling the user request and owning the final outcome. |
| Root Job | The user-facing Agent Job in which the root Moss is executing. |
| Parent Agent | A Moss instance that invokes `fork_tasks`; it may be the root or a child. |
| Child Agent | A fresh, disposable Moss Pi Session executing one delegated task. |
| Task Node | One delegated unit of Agent work, represented by a child Agent Job. |
| Fork Group | One idempotent `fork_tasks` invocation and its ordered direct children. |
| Join | The barrier at which every direct child has reached a terminal state. |
| Integration | The parent’s mechanical and semantic combination of child outputs. |
| Report Task | A read-only child that returns findings without a source delta. |
| Patch Task | An isolated writable child that returns a bounded source delta. |
| Base Snapshot | The immutable source snapshot from which all siblings in a Fork start. |
| Source Delta | Content-addressed additions, modifications, and deletions relative to a Base Snapshot. |
| Task Capsule | The bounded context passed from a parent to one child. |
| Descendant | Any child, grandchild, or deeper node below a Task Node. |

“Fork” in this document does not mean Pi’s `/fork` session command. Pi session
forking creates a replacement conversation session; it does not create parallel
workers.

## 6. Core Invariants

The following invariants apply at every depth.

1. **One semantic owner:** A parent owns the integration of its direct children.
2. **Root accountability:** The Root Agent is the only Agent that may declare the
   user request complete.
3. **Structured lifetime:** A child cannot outlive its root tree. Cancellation or
   terminal failure closes all unfinished descendants.
4. **No orphan success:** A parent cannot succeed while a required descendant is
   queued, active, failed but unhandled, or unintegrated.
5. **Fresh context:** Every child has a new Pi Session and does not inherit the
   parent’s full conversation history.
6. **Minimum handoff:** Fresh context never means context-free execution; every
   child receives a Task Capsule.
7. **Immutable sibling base:** Siblings begin from exactly the same Base Snapshot
   digest.
8. **No shared mutation:** Children never edit the parent workspace or another
   child workspace directly.
9. **No last-write-wins:** Overlapping child source ownership is rejected before
   execution or surfaced as an explicit integration conflict.
10. **Single canonical source:** Only the parent workspace may become the Job’s
    canonical checkpoint.
11. **Local semantic aggregation:** A parent receives bounded direct-child
    results, not an automatic dump of every descendant transcript.
12. **Global operational visibility:** Authorized users may query the complete
    descendant tree independently of what enters model context.
13. **Bounded recursion:** Depth, fan-out, total nodes, concurrency, time, tokens,
    and cost are enforced by the runtime.
14. **Budget conservation:** A child can partition only the budget granted by its
    parent; recursion cannot create new budget.
15. **Integration reserve:** Descendant allocation cannot consume the budget
    reserved for parent synthesis and final root validation.
16. **Truthful completion:** Child checks, parent checks, and whole-page checks are
    reported separately and never inferred from one another.

## 7. Architecture Overview

```text
User request
    │
    ▼
Root Agent Job / Moss
    │
    ├─ confirm requirements and page-wide direction
    ├─ decide whether decomposition is beneficial
    ├─ capture immutable parent source snapshot
    │
    └─ fork_tasks
         │
         ├─ Child Job A ─ fresh Pi Session ─ isolated workspace ─ result A
         ├─ Child Job B ─ fresh Pi Session ─ isolated workspace ─ result B
         └─ Child Job C ─ fresh Pi Session ─ isolated workspace ─ result C
                │
                └─ optional bounded Fork of its own

         join direct children
                │
                ▼
         bounded summaries + result artifacts
                │
                ▼
Parent integration
    │
    ├─ synthesize reports
    ├─ merge permitted source deltas
    ├─ inspect the assembled whole
    └─ resolve semantic and mechanical seams
                │
                ▼
Root clean build + browser checks + quality gate
                │
                ▼
Canonical Draft Checkpoint and user response
```

There are two distinct planes:

### 7.1 Semantic Plane

The semantic plane contains only the context needed for a parent to understand
and integrate direct-child outcomes:

- Bounded result summaries.
- Assumptions and unresolved issues.
- Source-delta references and changed paths.
- Checks actually executed.
- Direct-child status and usage.

### 7.2 Control Plane

The Control Plane retains the complete operational tree:

- Root, parent, child, Fork Group, depth, and sibling order.
- Task Capsules and capability scopes.
- Authoritative state and leases.
- Child events, usage, timings, failures, and cancellation.
- Session, source, delta, and result artifact references.

Global visibility in the Control Plane must not imply global injection into every
LLM context.

## 8. Moss Runtime Model

### 8.1 Homogeneous Agents

A child is not a separately implemented specialist module. It is created from
the same Moss runtime factory as the root:

- Same pinned Pi SDK and `ModelRuntime`.
- Same explicit `ResourceLoader` pattern.
- Same reviewed Dashboard Skill catalog.
- Same Chinese-by-default identity and truthful-reporting rules.
- Same platform-owned source, dependency, and data boundaries.

Specialization comes from the Task Capsule and capability scope, not from a
predefined role registry.

### 8.2 Fresh Pi Session

Every child receives:

- A unique MDA Agent Session.
- A unique Pi Session JSONL file.
- A unique workspace and runtime directory.
- No parent transcript by default.
- The parent Session ID, parent Job ID, and root Job ID as metadata only.

The child Session is uploaded as a private artifact for authorized inspection and
recovery, then closed after its result is durable. Its local workspace is erased
after artifact persistence.

### 8.3 Child Prompt Differences

The child system prompt must state that:

- It is executing a delegated task and has no direct user conversation.
- The supplied requirements are already approved for the delegated scope.
- It must not restart the root requirements approval gate.
- Its responsibility ends at the declared deliverable.
- It must preserve the parent’s shared decisions.
- It may Fork only when its remaining policy permits.
- It must return integration notes, assumptions, checks, and unresolved issues.
- It may not claim that the whole dashboard is complete.

Children still read the Skills relevant to their assignment progressively. They
do not load the entire Skill catalog into initial context.

## 9. Task Capsule

A Task Capsule is the minimum sufficient handoff from parent to child.

```ts
interface AgentTaskCapsule {
  schemaVersion: 1;
  rootGoal: string;
  approvedRequirements: string;
  sharedDecisions: string[];
  task: {
    key: string;
    goal: string;
    nonGoals: string[];
    deliverable: string;
    acceptanceCriteria: string[];
    mode: "report" | "patch";
    writeScope?: string[];
  };
  source: {
    baseDigest: string;
    artifactKey: string;
  };
  dataContext: {
    sourceIds: string[];
    queryIds: string[];
    notes: string[];
  };
  budget: {
    depth: number;
    maxDepth: number;
    maxChildren: number;
    maxTurns: number;
    deadline: string;
  };
}
```

The actual contract must use TypeBox and stable versioned transport schemas.

Capsules must remain concise. They include selected shared decisions rather than
copying the complete parent Session. Large evidence is referenced by authorized
artifact or source identifiers and read on demand.

## 10. Fork Tool Contract

### 10.1 Tool Name and Availability

The model-facing Tool name is `fork_tasks`. Its display label may be **Fork**.

The Tool is active only when:

- The current Job purpose supports Agent delegation.
- The root and tenant have remaining Fork budget.
- The current depth is below the configured maximum.
- The parent is not already integrating another Fork.
- Cancellation has not been requested.

At a depth or budget boundary, the Tool should be omitted from the child’s active
Tool set rather than relying only on a prompt instruction.

### 10.2 Input

```ts
interface ForkTasksInput {
  reason: string;
  integrationPlan: string;
  tasks: Array<{
    key: string;
    goal: string;
    nonGoals?: string[];
    deliverable: string;
    acceptanceCriteria: string[];
    mode: "report" | "patch";
    writeScope?: string[];
  }>;
}
```

Rules:

- A Fork contains between two and four tasks in the first release.
- Task keys are unique within the Fork and stable across retries.
- `reason` explains why execution is independently parallelizable.
- `integrationPlan` explains how the parent will combine the outputs.
- Report Tasks must not declare writable paths.
- Patch Tasks must declare at least one writable path prefix.
- Sibling writable scopes must not overlap.
- Paths are normalized relative paths under `src/**` or `public/**`.
- Platform-owned files remain prohibited.
- `dashboard.manifest.json` may be assigned only as an exclusive scope and is
  root-owned by default.
- Glob syntax, absolute paths, parent traversal, symlinks, and ambiguous prefixes
  are rejected.

No Tool field describes visual coordinates, chart types, controls, or component
structure.

### 10.3 Execution Semantics

One invocation performs structured Fork-Join execution:

1. Validate eligibility, limits, scopes, and remaining budget.
2. Capture the parent workspace as one immutable Base Snapshot.
3. Create or recover the idempotent Fork Group.
4. Create one ordered child Job and fresh child Session per task.
5. Schedule children concurrently under bounded permits.
6. Stream lifecycle progress without exposing raw prompts or source.
7. Wait until all direct children are terminal.
8. Persist every child Session and result artifact.
9. Produce bounded direct-child summaries in declaration order.
10. For eligible Patch Tasks, prepare a deterministic merged staging snapshot.
11. Return control to the parent for semantic integration.

Completion order affects progress events but not the order of the model-visible
result. Stable declaration order keeps retries and parent reasoning
deterministic.

The normal path does not require the parent model to call a polling Tool. An
inspection Tool or API may exist for diagnostics, but polling is not part of the
Agent workflow.

### 10.4 Output

```ts
interface ForkTasksResult {
  forkId: string;
  status: "joined" | "partial" | "failed" | "cancelled";
  baseDigest: string;
  tasks: Array<{
    taskJobId: string;
    key: string;
    state: "succeeded" | "failed" | "cancelled";
    summary: string;
    changedPaths: string[];
    resultArtifactId?: string;
    sourceDeltaId?: string;
    checks: Array<{
      name: string;
      status: "passed" | "failed" | "unverified";
      detail?: string;
    }>;
    assumptions: string[];
    unresolved: string[];
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }>;
  merge?: {
    status: "not-applicable" | "ready" | "conflict";
    stagingArtifactId?: string;
    conflicts?: Array<{
      path: string;
      taskKeys: string[];
      reason: string;
    }>;
  };
}
```

Model-visible text is bounded independently of stored details:

- At most 4 KiB of summary text per child.
- At most 24 KiB for the complete Fork result.
- Full histories, source deltas, logs, and diagnostics remain in private
  artifacts.

Nested model usage is returned through Pi’s Tool `usage` field so Session totals
include descendant work. MDA also records usage per node.

## 11. Child Capability Scopes

Children inherit authorization but not unrestricted side effects.

### 11.1 Report Task Tools

A Report Task normally receives:

```text
read, grep, find, ls
list_data_sources, describe_data_source, list_queries, test_query
fork_tasks when depth and budget permit
```

It cannot write source, register Queries, checkpoint, build a Preview, publish,
or execute arbitrary Bash.

### 11.2 Patch Task Tools

A Patch Task normally receives:

```text
read, edit, write, grep, find, ls
list_data_sources, describe_data_source, list_queries, test_query
scoped validation tools
fork_tasks when depth and budget permit
```

`edit` and `write` enforce the declared writable path prefixes. Raw Bash is
absent by default because it can bypass source-scope enforcement. Repeatable
build or validation behavior is exposed through purpose-built Tools.

A child cannot:

- Activate the Dashboard Draft Checkpoint.
- Save a Dashboard Revision.
- Create a Preview or Publication.
- Modify platform-owned template files.
- Install dependencies.
- Create or configure Data Sources.
- Register a Query unless a later contract gives it an exclusive, explicit
  registration allocation.

These restrictions coordinate side effects; they do not prescribe presentation
or source structure.

## 12. Workspace and Source-Delta Contract

### 12.1 Isolation

Every child workspace is restored from the Fork Group’s Base Snapshot:

```text
/workspaces/{tenantId}/{dashboardId}/jobs/{rootJobId}/
├── parent/                         # existing parent Session workspace
└── forks/{forkId}/
    ├── {taskJobId}/workspace/      # isolated child source
    ├── {taskJobId}/history/        # child Pi JSONL
    └── {taskJobId}/runtime/        # child-local Pi runtime files
```

The exact physical layout may differ, but validated identifiers, separate
directories, and cleanup invariants are mandatory.

### 12.2 Source Delta

A Patch Task returns a Source Delta relative to its Base Snapshot:

```ts
interface AgentSourceDelta {
  schemaVersion: 1;
  baseDigest: string;
  resultDigest: string;
  files: Array<{
    path: string;
    operation: "add" | "modify" | "delete";
    beforeDigest?: string;
    afterDigest?: string;
    content?: string;
    executable?: boolean;
  }>;
}
```

The transport representation may move file bodies into an Object Storage
artifact, but digests, operations, paths, and bounds remain authoritative.

A delta is accepted only when:

- Its Base Snapshot digest matches the Fork Group.
- Every changed path belongs to the child’s declared writable scope.
- Before-digests match the Base Snapshot.
- The result digest recomputes exactly.
- File count and byte limits remain within the Dashboard artifact contract.
- No symlink, special file, excluded path, or platform-owned file appears.

### 12.3 Mechanical Merge

Sibling Patch Tasks must have disjoint writable scopes. Their deltas are applied
to a staging snapshot in task declaration order.

The merge must:

1. Revalidate every delta and scope.
2. Reject overlapping additions, changes, deletions, or path prefixes.
3. Apply all accepted deltas to the shared Base Snapshot.
4. Recompute the complete staging digest.
5. Preserve reports and failed-child diagnostics independently.
6. Avoid mutating the parent workspace if any required delta is invalid.

No last-write-wins merge is permitted.

### 12.4 Parent Adoption

The parent remains responsible for adopting and integrating the staging result.
Before adoption, the runtime verifies that the parent workspace still has the
same digest captured at Fork creation. If it changed, adoption stops with an
explicit `PARENT_WORKSPACE_CHANGED` conflict.

A Patch-mode Fork must execute as an exclusive Tool batch. It cannot run beside
`edit`, `write`, `bash`, another Fork, or another workspace-mutating Tool from the
same assistant message. The runtime enforces this by inspecting the complete
assistant Tool-call message during Tool preflight.

After safe adoption, the parent must inspect the changed paths and perform a
semantic integration pass. Mechanical merge success is never equivalent to
whole-page completion.

Only the root’s final successful Agent Job may capture the canonical Draft
Checkpoint.

## 13. Recursive Execution and Aggregation

### 13.1 Local Ownership Rule

A child may Fork when its Tool is active and its allocation permits. It then
becomes the parent of those direct descendants.

That child must:

1. Define the descendant tasks and its integration plan.
2. Wait for all direct descendants to settle.
3. Integrate their reports or deltas into its own isolated workspace.
4. Validate its declared deliverable.
5. Return one coherent result to its parent.

The root does not automatically receive every grandchild transcript or source
delta. It receives the integrated direct-child result. Authorized operational
queries may still reveal the complete tree.

### 13.2 Aggregate State

A Task Node is semantically successful only when:

- Its own Agent execution succeeded.
- Every required direct-child Fork joined.
- Failed descendants were explicitly handled or caused failure.
- Its local integration completed.
- Its result artifact is durable.

A Fork Group is joined when all direct children are terminal. Joined does not
mean successful; it may contain failed or cancelled children.

### 13.3 Depth and Fan-Out

The storage and event contracts support recursive lineage from the beginning,
but release gates remain conservative:

| Stage | Maximum depth | Children per Fork | Total nodes per root |
|---|---:|---:|---:|
| Read-only proof | 1 | 4 | 4 descendants |
| Writable children | 1 | 4 | 4 descendants |
| Bounded recursion | 2 | 4 | 12 descendants |

Depth greater than two is not planned without evidence that it improves quality
or latency. Deep trees amplify context loss, cost, coordination, and recovery
complexity.

## 14. Authoritative State Model

### 14.1 Agent Jobs as Task Nodes

The existing `AgentJob` remains the authoritative leased execution unit. A
child Task Node is an Agent Job with a unique child Agent Session and delegated
purpose.

Conceptually, delegated Jobs add:

```text
root_job_id          nullable for the root, fixed for descendants
parent_job_id        direct parent Job
fork_id              owning Fork Group
depth                root = 0, direct child = 1
sibling_order        declaration order within the Fork
task_key              unique within the Fork
task_capsule          validated JSON
base_source_digest    immutable sibling base
result                bounded structured JSON
result_artifact_key   private full result artifact
source_delta_key      optional Patch result
```

The public Job list hides delegated Jobs by default and exposes them through the
tree query or an explicit `includeDescendants` option.

The existing one-active-Job-per-Session constraint remains valid because every
child has a separate Session.

### 14.2 Fork Group

A Fork Group is an immutable task declaration with mutable execution state:

```text
id
root_job_id
parent_job_id
parent_tool_call_id
base_source_digest
reason
integration_plan
state
child_count
created_at
joined_at
```

Required constraints:

- Unique `(parent_job_id, parent_tool_call_id)` for Tool-call idempotency.
- Unique `(fork_id, task_key)` for child idempotency.
- Parent and children share tenant and Dashboard identity.
- Every child depth equals parent depth plus one.
- A root cannot change after Fork creation.
- A joined or cancelled Fork cannot gain new children.

Suggested Fork states:

```text
created → running → joined
                  ├─→ failed
                  └─→ cancelled
```

Child Jobs use the existing authoritative state machine:

```text
queued → leased → running → succeeded
                    ├────→ failed
                    └────→ cancelled
```

Parent “waiting for children” and “integrating” are durable phase events and
Fork state, not additional terminal Job states. The parent Job remains running
and leased while its Tool is active in the initial implementation.

### 14.3 Tree Queries

Lineage is a strict tree, not a general DAG. PostgreSQL recursive queries derive
descendants from authoritative parent references.

The system must not copy complete descendant state or result bodies into every
ancestor row. Cached aggregate counts may be added only as rebuildable
projections if query load requires them.

## 15. Scheduling and Parallelism

### 15.1 Async Concurrency, Not an OS Thread Requirement

Model calls and most Data Source operations are network-bound. MDA needs a
bounded asynchronous scheduler and semaphores, not one operating-system thread
per child.

Builds and other CPU or process work continue through bounded subprocesses.

### 15.2 Initial Scheduler

The initial implementation should add a shared `ForkScheduler` inside each
`mda-agent` process:

- It reuses the process’s pinned `ModelRuntime`.
- It creates independent Pi `AgentSession` objects per child.
- It holds a container-wide child concurrency semaphore.
- It holds a per-root concurrency semaphore.
- It executes descendants without consuming ordinary Redis root-conversation
  worker loops.
- It persists every authoritative transition through the Control Plane.

This avoids a deadlock in which every ordinary worker is occupied by a parent
waiting for children queued to the same exhausted pool.

A single root tree initially remains on the Agent container that owns the root
lease. If later measurements require one tree to span hosts, delegated Jobs may
move behind a dedicated Redis Stream without changing the Tool, Task Capsule,
lineage, result, or integration contracts.

### 15.3 Capacity and Fairness

Configuration must bound:

- Active child Sessions per Agent container.
- Active children per root tree.
- Active descendants per tenant.
- Queued descendants per root and tenant.
- Model requests per provider.
- Build subprocesses.
- Root duration, descendant duration, turns, tokens, and cost.

A tenant or one large dashboard must not monopolize all Agent capacity. Root
conversation work retains reserved capacity.

The recommended initial defaults are:

```text
max children per Fork:       4
max active children/root:    4
max depth:                   1
max descendants/root:        4
child timeout:               bounded by deployment policy
child retries:               one transient retry
```

The values are configuration, but increasing them requires load and quality
evidence.

### 15.4 Parent Waiting

While `fork_tasks` is running:

- The parent Agent is logically suspended at the Tool call.
- Its lease and cancellation heartbeat continue.
- It consumes no model-call permit.
- Child progress streams through Tool updates and durable platform events.
- The parent model does not receive partial child text or repeatedly poll.

A later implementation may durably suspend and unload the parent process if
long waits materially reduce worker capacity. That optimization must preserve
the same Fork-Join semantics.

## 16. Progress and Event Contract

Add stable platform events rather than exposing Pi-internal event types.

Recommended root-stream lifecycle events:

```text
agent.fork.started
agent.fork.progress
agent.task.queued
agent.task.started
agent.task.completed
agent.task.failed
agent.task.cancelled
agent.fork.joined
agent.integration.started
agent.integration.completed
agent.integration.conflict
```

Every nested lifecycle event contains only bounded metadata:

```ts
interface AgentTaskLifecycleData {
  rootJobId: string;
  parentJobId: string;
  taskJobId?: string;
  forkId: string;
  taskKey?: string;
  depth: number;
  siblingOrder?: number;
  state?: string;
  aggregate?: {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    cancelled: number;
  };
}
```

Root-stream events do not mirror every child text delta or Tool result. Detailed
child events remain attached to the child Job and are fetched only by authorized
inspection.

`tool_execution_update` from Pi must map to a stable `tool.updated` or
`agent.fork.progress` event so a long Fork does not appear idle.

Events must never contain:

- Full prompts or Task Capsules.
- Source bodies or deltas.
- Data Source rows.
- Credentials or authorization tokens.
- Unbounded child output.

## 17. Public Inspection Contract

Authorized clients need one global tree query:

```text
GET /api/agent-jobs/{root-or-node-job-id}/tree
```

The response contains a flat, stable list with parent IDs so CLI and Web clients
can render any hierarchy without recursive response-size amplification.

```ts
interface AgentJobTreeResponse {
  rootJobId: string;
  aggregate: {
    total: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    cancelled: number;
  };
  items: Array<{
    jobId: string;
    parentJobId?: string;
    forkId?: string;
    taskKey?: string;
    depth: number;
    siblingOrder: number;
    state: string;
    summary?: string;
    startedAt?: string;
    finishedAt?: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }>;
}
```

Rules:

- Tenant and Dashboard authorization applies before traversal.
- The default response contains no raw prompt, full result, source, or history.
- Large trees are impossible under runtime limits, but the API still enforces
  response bounds.
- Child Job detail and events require explicit follow-up requests.
- The CLI may render an indented live tree while `mda chat` continues watching
  the root event stream.

The parent Agent does not need this API in the normal Fork path because the Tool
already waits and returns direct-child results. It is an operational and user
inspection capability.

## 18. Persistence, Idempotency, and Recovery

### 18.1 Creation Boundary

Fork creation is one PostgreSQL transaction containing:

- The Fork Group.
- Child Sessions.
- Child Jobs and task order.
- Audit records.
- Any outbox or wake-up records required by the scheduler.

The Base Snapshot must already be durable and digest-verified before this
transaction commits.

### 18.2 Idempotency

The parent Pi Tool-call ID is the primary Fork idempotency key.

- Repeating the same `(parent_job_id, parent_tool_call_id)` returns the existing
  Fork Group.
- Reusing it with a different normalized task declaration is a conflict.
- Child creation is idempotent by `(fork_id, task_key)`.
- Result upload is idempotent by child Job and result digest.
- Source-delta upload is idempotent by child Job and delta digest.

Model retry or parent lease recovery must not create duplicate descendants.

### 18.3 Session Durability at Fork Boundaries

Current root Session persistence at Job settlement is insufficient for durable
long-running Forks. The parent Pi Session artifact must be uploaded:

1. After the assistant Tool-call message is persisted and the Fork Group exists.
2. After direct-child results are joined and the Tool result is persisted.
3. At ordinary Job settlement as before.

Child Sessions are uploaded at terminal execution and before a child returns a
successful result.

### 18.4 Recovery

If an Agent process fails during a Fork:

1. The root Job lease expires and follows existing recovery rules.
2. Unfinished child leases expire or are cancelled with the abandoned parent
   execution attempt.
3. Completed child results remain durable and reusable.
4. The recovered parent restores its latest Fork-boundary Session and source
   artifacts.
5. The Fork Group is reconciled by Tool-call ID.
6. Missing children are resumed or retried within policy; completed children are
   not rerun.
7. The recovered Tool result is appended once and the parent Agent continues
   integration.

A stale parent or child fencing token cannot append events, upload a result,
adopt a staging snapshot, or settle a Job.

If exact Pi continuation cannot be restored safely, the root Job fails with a
retryable recovery error rather than silently starting an unrelated tree or
applying partial source.

## 19. Cancellation, Failure, and Retry

### 19.1 Cancellation

Cancellation is hierarchical:

```text
cancel root
  → abort parent Pi Session
  → abort every active descendant
  → cancel queued descendants
  → terminate child subprocesses
  → persist terminal task and Fork events
```

Cancelling one child directly is permitted only through an authorized diagnostic
operation. The parent receives the cancellation as a child result and decides
whether the root can continue.

A child that owns descendants cascades cancellation to its subtree.

### 19.2 Failure Policy

The initial Fork policy is **all required**:

- Every declared task is required.
- A failed child does not mutate the parent workspace.
- Successful sibling reports and artifacts remain available.
- The Tool returns a bounded partial/failed result to the parent.
- The parent may retry a narrower task, complete the work itself, or fail the
  root request.

A future best-effort report policy may be added only with an explicit Tool field
and clear parent handling. Patch Tasks remain all-required by default.

### 19.3 Retries

Automatic retries apply only to classified transient failures:

- Model transport or rate-limit failure.
- Temporary Control Plane or Object Storage unavailability.
- Recoverable scheduler interruption.

Invalid source scopes, policy violations, deterministic build errors, exhausted
budgets, and semantic task failures are not blindly retried.

Every retry remains bounded by the child’s original budget and uses the existing
Job attempt and fencing model.

## 20. Data Access and Side Effects

Children inherit only Data Sources authorized for the root Dashboard and user
context. They never receive credentials.

Report and Patch children may:

- List authorized Data Sources.
- Read connector-neutral source descriptions.
- List existing immutable Queries.
- Execute bounded design-time Query samples when allocated.

Children may not independently register Queries in the first release. Query
registration changes shared Dashboard dependencies and can conflict across
siblings. The parent owns registration, logical Query naming, Manifest updates,
and final Query binding decisions.

If child Query registration is added later, the parent must allocate exclusive
logical names and source scopes in the Task Capsule, and the Control Plane must
enforce those allocations idempotently.

Children never publish, share, activate a Draft, or create a canonical Preview.
Only the root validates and previews the integrated dashboard.

## 21. Security Boundaries

Forked execution preserves all existing MDA boundaries and adds least-privilege
task scopes.

Required controls:

- Tenant, Dashboard, root, parent, and child identities are derived server-side.
- A child cannot select or change its tenant, Dashboard, root, or parent.
- Child access tokens or lease commands are task-scoped and short-lived.
- Child workspaces expose only their Base Snapshot and task-local files.
- Child Sessions do not discover host or workspace extensions, Skills, prompts,
  themes, or `AGENTS.md` files.
- The reviewed platform `ResourceLoader` remains explicit.
- Project-local Pi agents are never discovered.
- MDA does not spawn the example `pi` CLI subagent process with host defaults.
- Data Source credentials remain inside the Data Source Service.
- Child artifacts, histories, results, and deltas are private tenant resources.
- Raw Bash is absent from scoped children unless a future sandboxed contract can
  enforce the same path and network rules.
- A child cannot write the parent workspace, Object Storage keys outside its
  allocation, or another child’s artifacts.
- Parent adoption rechecks the authoritative lease, fencing token, base digest,
  and cancellation state.

The source-scope mechanism is a coordination and security boundary. It is not a
presentation constraint.

## 22. Context and Cost Control

Parallel Agents can reduce wall time while increasing total tokens and cost.
MDA must make that tradeoff visible and bounded.

### 22.1 Context Rules

- Child Sessions receive Task Capsules, not full parent transcripts.
- Child Tool outputs remain bounded by the existing Tool-output policy.
- Child result summaries are capped independently of stored artifacts.
- Grandchild results are summarized and integrated by their direct parent.
- The root loads full child artifacts only on demand.
- Source deltas are merged mechanically rather than copied in full into model
  context.

### 22.2 Budget Rules

Every root receives a configurable execution budget containing:

```text
maximum descendants
maximum depth
maximum active children
maximum turns per child
maximum wall-clock duration
maximum input and output tokens
maximum estimated cost
reserved root integration allowance
```

A parent receives only its remaining allocation. When it Forks, the scheduler
partitions that allocation among children while retaining the parent’s
integration reserve. Descendants cannot increase any limit.

### 22.3 Usage Accounting

Usage is recorded:

- Per child assistant turn.
- Per child Job.
- Per Fork Group.
- Per subtree.
- For the complete root Job.

Pi Tool results include aggregated descendant `usage`, while the Control Plane
retains the non-duplicated per-node values. Root totals must not double-count
usage already represented by descendant Tool results.

## 23. Integration Quality Gate

Parallel generation succeeds only when the final page behaves and reads as one
artifact.

### 23.1 Parent Composition Responsibilities

After joining children, the parent must inspect the assembled whole and resolve:

- Information hierarchy and reading order.
- Shared design tokens, typography, spacing, and color use.
- Global filter and application state.
- Data definitions, units, periods, denominators, and freshness.
- Cross-area interactions and navigation.
- Loading, empty, partial, stale, refreshing, error, and unauthorized states.
- Responsive transitions and mobile behavior.
- Keyboard flow and accessible alternatives.
- Duplicate content, contradictory assumptions, and visual competition.
- Source abstractions that became awkward after mechanical merge.

Child success never waives this composition pass.

### 23.2 Final Validation

Only the integrated root workspace is authoritative for final validation.

The root must perform, when available:

1. Manifest and boundary validation.
2. One clean final build after the last source mutation.
3. Browser rendering at desktop and mobile widths.
4. Functional checks for shared interactions and data states.
5. Screenshot or equivalent visual inspection of the complete page.
6. Accessibility and web-quality review.
7. A final Preview from the canonical integrated source.

Child-local builds can detect syntax or isolated implementation failures, but
they do not prove whole-page success.

Writable Forking must not be released before MDA can exercise the integrated
page through a real browser. The current build-only path is insufficient to
claim that independently generated areas connect correctly.

## 24. Observability

Structured logs and metrics include:

```text
rootJobId
parentJobId
taskJobId
forkId
taskKey
depth
siblingOrder
tenantId
dashboardId
sessionId
model
state
attempt
queueMs
modelMs
toolMs
joinWaitMs
integrationMs
inputTokens
outputTokens
estimatedCost
changedPathCount
mergeConflictCount
```

Initial metrics:

- Fork decision rate.
- Fork rejection rate by policy reason.
- Children and depth per root.
- Active and queued child Sessions.
- Child success, failure, cancellation, and retry rates.
- Parent join wait.
- Source-scope violation and merge-conflict rates.
- Root repair turns after join.
- Final build and browser-check pass rates.
- Single-Agent versus Forked wall-clock duration.
- Single-Agent versus Forked token and estimated cost.
- Quality-review differences on benchmark tasks.

Logs and events never contain credentials, raw authorization, full prompts,
unbounded model output, source bodies, or sensitive Query parameters.

## 25. CLI and Web Experience

The normal chat remains one conversation with the root Moss.

A client may render Fork progress as a quiet nested tree:

```text
Moss  integrating dashboard
  Fork  2/3 complete
    ✓ regional-comparison
    ◌ mobile-interactions
    ✓ accessibility-review
```

Requirements:

- Root assistant text remains the primary transcript.
- Child text is collapsed and hidden by default.
- Tool and task states are visible without exposing internal reasoning.
- Users may inspect a child’s authorized events and result explicitly.
- Completion-order updates do not reorder the stable task list.
- Cancelling the root clearly shows descendant cancellation.
- A recovered Fork does not duplicate rows or assistant output.
- CLI and Web consume the same stable public contracts.

The management UI may use structured rendering for progress. Generated
Dashboard source remains ordinary code and is never reconstructed from this
tree.

## 26. Testing Strategy

### 26.1 Contract Tests

Verify:

- Strict Fork input and output schemas.
- Task Capsule bounds and versioning.
- Path-prefix normalization and overlap rejection.
- Tree response and event schemas.
- Source Delta digest and operation validation.
- Bounded summaries and result sizes.

### 26.2 Domain Tests

Verify:

- Parent/root/depth invariants.
- Fork and task idempotency.
- Child state transitions and terminality.
- Parent success rejection with unfinished descendants.
- Joined Forks cannot gain children.
- Budget partition and exhaustion.
- Cancellation cascade.
- Stale fencing-token rejection.
- Aggregate status without duplicated state.

### 26.3 Scheduler Tests

Verify:

- Children run concurrently up to the configured limit.
- Declaration-order results remain stable under reverse completion order.
- One root cannot monopolize all permits.
- Parents waiting for children do not deadlock child execution.
- Cancellation aborts model requests and subprocesses.
- Recursive work respects global and per-root limits.
- No child Session, workspace, timer, or permit leaks after completion.

### 26.4 Workspace Tests

Verify:

- Every sibling receives the exact same Base Snapshot.
- Children cannot observe sibling writes.
- Report Tasks cannot mutate source.
- Patch Tasks cannot mutate outside their scope.
- Overlapping scopes are rejected before execution.
- Invalid or conflicting deltas never mutate the parent.
- Parent-digest drift prevents adoption.
- Clean staging merge is deterministic.
- Only root settlement records the canonical Checkpoint.

### 26.5 Recovery Tests

Verify crashes:

- After Fork Group creation.
- While children are queued.
- During concurrent child model turns.
- After one child completes.
- After all children complete but before join persistence.
- After join but before parent continuation.
- During staging adoption.

Every recovery must avoid duplicate children, duplicate Tool results, stale
source application, and orphaned active tasks.

### 26.6 End-to-End Tests

Minimum journeys:

1. Root chooses not to Fork for a focused edit.
2. Root creates three read-only children and synthesizes their reports.
3. Children complete out of order while the parent receives stable ordered
   results.
4. One child fails and the root completes its work explicitly without claiming
   that child succeeded.
5. Two Patch children modify disjoint source scopes and the root integrates them.
6. A Patch child violates its scope and no parent source changes.
7. A child Forks two read-only grandchildren at allowed depth and integrates
   them before returning.
8. Root cancellation aborts the complete tree.
9. CLI disconnect and reconnect replay nested progress without duplication.
10. The integrated dashboard builds and passes desktop/mobile browser checks.

Deployment verification must use the newest local `bun run mda` against the
newest deployed environment and exercise Forking itself, not only health or tree
query endpoints.

## 27. Evaluation Gate

Before writable or recursive release, compare the existing single-Agent path
with Forked execution on a fixed benchmark set:

- A large executive dashboard with several independent analytical sections.
- A dashboard with shared global filters and tightly coupled state.
- A narrative data story.
- A mobile-first redesign.
- A small focused repair.

Measure:

- End-to-end wall-clock duration.
- First successful build and browser-check duration.
- Total input and output tokens.
- Estimated model cost.
- Child failure and merge-conflict rate.
- Number of root integration and repair turns.
- Functional correctness.
- Blind visual-coherence review.
- Whether Moss Forked only when the task was actually decomposable.

The feature advances only when decomposable tasks become materially faster
without reducing final quality. Tightly coupled and small tasks are expected to
remain single-Agent and must not regress.

## 28. Delivery Phases

### Phase 0: Baseline and Spec Validation

1. Preserve this document as the feature contract.
2. Build the benchmark set and record single-Agent baselines.
3. Confirm event, lineage, budget, cancellation, and result schemas.
4. Add browser-based whole-page verification before writable delegation.

### Phase 1: One-Level Read-Only Fork

1. Add Fork Group and child lineage persistence.
2. Add the bounded in-process `ForkScheduler`.
3. Refactor Moss Session creation into one reusable root/child runtime factory.
4. Add `fork_tasks` with Report Tasks only.
5. Add nested progress, global tree query, cancellation, and usage accounting.
6. Limit depth to one and children to four.
7. Benchmark latency, cost, routing judgment, and synthesis quality.

### Phase 2: Isolated Patch Tasks

1. Add writable path scopes and scoped child Tools.
2. Add Source Delta artifacts and digest validation.
3. Add deterministic staging merge and parent-digest checks.
4. Enforce exclusive Patch-mode Fork Tool batches.
5. Add root composition and browser quality gates.
6. Keep depth at one.

### Phase 3: Recovery and Distributed Readiness

1. Persist parent Session artifacts at Fork boundaries.
2. Reconcile pending Forks after lease recovery.
3. Reuse completed child results idempotently.
4. Add retention cleanup for child workspaces, Sessions, and unreferenced
   artifacts.
5. Add fairness, provider limits, and operational metrics.

### Phase 4: Bounded Recursion

1. Enable depth two under feature configuration.
2. Enforce inherited budgets and integration reserve.
3. Require child-local descendant integration before return.
4. Add subtree cancellation and recovery tests.
5. Re-run benchmark and quality gates.

Depth beyond two and cross-host execution of one tree remain deferred until
measurements justify them.

## 29. Rejected Alternatives

### 29.1 Unrestricted Recursive Self-Replication

Rejected because model self-restraint cannot enforce cost, depth, cancellation,
or resource safety, and because deep trees amplify context loss and integration
risk.

### 29.2 Destroying the Parent After Fork

Rejected because it removes the semantic owner responsible for joining and
whole-page quality. The parent may suspend operationally but remains logically
alive until integration completes.

### 29.3 Pi Session `/fork` as the Execution Primitive

Rejected because Pi session Fork replaces the active conversation session and
does not provide parallel child execution, MDA lineage, task budgets, isolated
workspaces, or recursive aggregation.

### 29.4 Raw Pi Subprocess Subagents

Rejected because the example subprocess pattern can discover host resources,
bypasses MDA’s explicit ResourceLoader and Control Plane authority, complicates
credentials and sandboxing, and does not provide durable MDA task state.

### 29.5 Shared Writable Parent Workspace

Rejected because concurrent reads and writes create races, lost updates,
non-reproducible builds, and unclear ownership.

### 29.6 Independent Region Applications or Iframes

Rejected because separately built mini-applications damage shared state,
accessibility, responsive composition, performance, visual coherence, and source
portability. Children contribute to one ordinary dashboard source tree.

### 29.7 Model Polling Loops

Rejected because repeated status Tool calls consume model turns and tokens while
introducing timing-dependent behavior. Tool execution streams progress and
returns at the join barrier.

### 29.8 Copying Full Descendant Results Up Every Level

Rejected because it duplicates storage and context, exposes unnecessary data,
and makes context growth proportional to both node count and depth. Results move
up one semantic level as bounded summaries and artifact references.

### 29.9 Platform-Defined Dashboard Regions

Rejected because fixed regions, coordinates, component slots, or layout schemas
would constrain the Coding Agent and drift toward GenUI. Decomposition remains a
transient Agent decision.

## 30. Acceptance Criteria

The feature is acceptable when:

1. Moss can complete small or tightly coupled tasks without invoking Fork.
2. Moss can dynamically define parallel tasks without platform-defined regions,
   coordinates, components, charts, or layouts.
3. Every child uses the same reviewed Moss runtime with a fresh Pi Session and
   isolated workspace.
4. A child receives a bounded Task Capsule rather than the full parent history.
5. Parent, root, Fork Group, depth, order, state, and result lineage are durable.
6. Authorized clients can query all descendants from any node without injecting
   the full tree into model context.
7. The parent waits through one streaming Tool invocation rather than model
   polling.
8. Children execute concurrently within hard per-root, per-tenant, and global
   bounds.
9. Runtime policy prevents indiscriminate recursion and preserves integration
   budget.
10. Siblings never share a writable workspace.
11. Patch ownership is dynamically selected by the parent and mechanically
    enforced without prescribing source architecture.
12. Invalid, overlapping, stale, or partial deltas cannot mutate the parent.
13. Every parent integrates its direct descendants before returning success.
14. The root remains responsible for whole-page composition and final delivery.
15. Root cancellation closes the complete descendant tree without orphaned
    Sessions, processes, leases, or workspaces.
16. Lease recovery does not duplicate children, Tool results, events, or source
    application.
17. Child usage is included in root accounting without double counting.
18. Full child output remains private and bounded model-visible summaries do not
    overflow parent context.
19. Only the integrated root workspace may become the canonical Draft
    Checkpoint, Preview, Revision, or Publication input.
20. The integrated dashboard passes a clean build and real desktop/mobile
    browser verification before Moss claims success.
21. Benchmarks show material latency benefit on decomposable tasks without a
    final-quality regression.
22. Dashboard source remains ordinary exportable TypeScript with no Fork or
    region representation required by the Manifest.

## 31. Related Documents

- `docs/agent-runtime/performance.md`: model, Tool-input, compaction, context, and
  validation latency policy.
- `docs/pi-sdk-dashboard-system-design.md`: Pi Agent Worker, Session, Tool, and
  workspace architecture.
- `docs/technology-selection-and-architecture.md`: worker pool, Control Plane,
  Redis, PostgreSQL, Object Storage, and deployment boundaries.
- `docs/domain-driven-design-structure.md`: Agent Work ownership, Job leases,
  fencing, events, and artifact workflows.
- `docs/dashboard-artifact-contract.md`: source ownership, Manifest boundary,
  validation, Preview, and publication contract.
- `docs/dashboard-skills/skill-system.md`: reviewed progressive Skill workflow
  inherited by root and child Moss Sessions.
- `docs/why-coding-agent-instead-of-genui.md`: source freedom and prohibition on
  required component or layout schemas.

When implementation begins, these documents must be updated where their current
single-Agent assumptions become incomplete. This file remains the sole detailed
contract for Forked Agent Tasks.
