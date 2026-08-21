# Live Data, Saving, and Refresh Contract

## 1. Goal

This contract defines how MDA saves dashboards while keeping their data live and automatically refreshed.

Core principle:

> Published code is immutable; published data is live.

A Publication contains a versioned frontend bundle and immutable Query Revision bindings. It does not contain permanently frozen query results unless the user explicitly creates a snapshot export or snapshot share.

The Coding Agent controls when data refreshes and how refresh state is presented. The platform supplies reliable, secure, presentation-neutral query and refresh primitives. The platform-maintained Skill should guide the Agent to use `dashboard.watch()` for data expected to change while a page remains open unless the user explicitly requests manual or snapshot behavior.

## 2. Static Artifact Does Not Mean Static Dashboard

MDA separates code lifecycle from data lifecycle:

```text
Dashboard code
  → saved as immutable Revision
  → built as immutable Publication
  → changes only after a new publish

Dashboard data
  → fetched through the Data Gateway at runtime
  → reflects current authorized source data
  → may refresh without rebuilding or republishing
```

The frontend bundle may be served as static files from Object Storage or a CDN. The running page remains dynamic because it calls the Dashboard Runtime and Data Gateway.

Viewing or refreshing a published Dashboard never invokes Pi.

## 3. Responsibility Boundaries

### 3.1 Coding Agent

The Coding Agent controls:

- Which queries the page executes.
- Which query results refresh automatically.
- Refresh intervals requested by the page.
- Query parameters and when they change.
- Manual refresh controls.
- Loading, refreshing, stale, and failure presentation.
- Whether the last successful result remains visible after an error.
- Every component and interaction under `src/**`.

### 3.2 Dashboard Runtime

The Dashboard Runtime controls:

- Safe query transport through the Viewer Host.
- Request cancellation.
- Preventing overlapping refreshes for one watcher.
- Pausing refresh while the page is hidden when requested.
- Refreshing when the page regains focus when requested.
- Retry delay and jitter within server policy.
- Propagating result freshness and structured errors.
- Stopping all work when the Dashboard is unmounted.

### 3.3 Data Gateway

The Data Gateway controls:

- Authentication and authorization on every execution.
- Query Revision resolution.
- Bound parameters.
- Read-only source execution.
- Minimum refresh intervals and quotas.
- Server-side cache policy.
- Result limits and timeouts.
- Audit records and metrics.

None of these layers chooses components, charts, layouts, or controls.

## 4. Saving Model

MDA distinguishes a Draft Checkpoint, Dashboard Revision, and Publication.

### 4.1 Draft Checkpoint

A Draft Checkpoint protects in-progress Agent work from loss.

It contains:

- `src/**`.
- `public/**`.
- Dashboard Manifest.
- Current Query Bindings.
- Template and Runtime versions.
- Workspace metadata.

The platform automatically creates a Draft Checkpoint:

- After a successful Agent Job settles and changed files exist.
- Before an Agent Runner exits normally.
- Before validation or publishing begins.
- Before switching the Session to a different base Revision.

A long-running Job may create periodic internal checkpoints, but they are operational recovery points rather than user-visible Dashboard Revisions.

### 4.2 Explicit Save

A user or Agent save operation promotes the current Draft Checkpoint into an immutable Dashboard Revision.

```text
Draft Checkpoint
  → save
  → immutable Dashboard Revision
```

An explicit save records:

- Revision ID.
- Parent Revision ID when applicable.
- Source and Manifest digest.
- Query Revision bindings.
- Template and Runtime versions.
- Author and originating Session.
- Save message and timestamp.

Saving does not publish and does not freeze current query results.

### 4.3 Publication

Publishing builds and validates a saved Dashboard Revision.

A Publication contains:

- Dashboard Revision ID.
- Immutable built bundle.
- Manifest digest.
- Runtime version.
- Immutable Query Revision bindings.
- Validation result.
- Build digest.
- Publishing identity and timestamp.

A Publication does not contain live credentials or direct source connections.

### 4.4 Data Refresh Does Not Create Revisions

These actions do not modify source and therefore do not create Dashboard Revisions:

- Runtime query execution.
- Automatic polling.
- Manual refresh.
- Cache revalidation.
- Source rows being inserted, updated, or deleted.

A new Revision is required only when source, Manifest, Query Bindings, template version, or another artifact input changes.

## 5. Runtime Query API

One-time runtime query:

```ts
interface DashboardRuntime {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    queryId: string,
    parameters?: QueryParameters,
    options?: QueryOptions,
  ): Promise<QueryResult<T>>;
}

type QueryParameterValue = string | number | boolean | null;
type QueryParameters = Record<string, QueryParameterValue>;

interface QueryOptions {
  signal?: AbortSignal;
  freshness?: "allow-cache" | "live";
}
```

`allow-cache` permits a result that complies with the server's bounded cache policy. `live` requests revalidation against the source but remains subject to authorization, rate, and source limits.

The browser cannot use `live` to bypass a server-enforced minimum interval.

## 6. Runtime Watch API

The Runtime provides an optional framework-neutral watcher for automatic refresh.

```ts
interface DashboardRuntime {
  watch<T extends Record<string, unknown> = Record<string, unknown>>(
    queryId: string,
    parameters: QueryParameters | (() => QueryParameters),
    options: QueryWatchOptions,
    listener: (event: QueryWatchEvent<T>) => void,
  ): QueryWatcher;
}

interface QueryWatchOptions {
  intervalMs: number;
  immediate?: boolean;
  refreshOnFocus?: boolean;
  pauseWhenHidden?: boolean;
  freshness?: "allow-cache" | "live";
}

interface QueryWatcher {
  refresh(): Promise<void>;
  stop(): void;
}

type QueryWatchEvent<T extends Record<string, unknown>> =
  | {
      type: "result";
      result: QueryResult<T>;
      reason: "initial" | "interval" | "focus" | "manual" | "parameters";
    }
  | {
      type: "error";
      error: RuntimeQueryError;
      willRetry: boolean;
      nextRetryAt?: string;
    };
```

Example:

```ts
const watcher = dashboard.watch(
  "monthly-sales",
  () => ({ startDate, endDate }),
  {
    intervalMs: 30_000,
    immediate: true,
    refreshOnFocus: true,
    pauseWhenHidden: true,
    freshness: "live"
  },
  (event) => {
    if (event.type === "result") {
      render(event.result);
    } else {
      showRefreshError(event.error);
    }
  }
);

// On page teardown:
watcher.stop();
```

The API does not prescribe React Hooks, components, stores, or visual states. The Coding Agent may wrap it in any source-level abstraction.

## 7. Watcher Behavior

### 7.1 Immediate Execution

`immediate` defaults to `true`. The watcher executes once when created and then follows its refresh policy.

### 7.2 No Overlapping Requests

One watcher runs at most one request at a time.

If another interval occurs while a request is active, the Runtime coalesces it into at most one pending refresh rather than starting an overlapping request.

### 7.3 Parameter Changes

When `parameters` is a function, the Runtime evaluates it immediately before each request.

If parameters change while a request is active, the Runtime may abort the stale request before starting the next one. Results from an obsolete parameter set must not be delivered as the latest result.

### 7.4 Page Visibility

When `pauseWhenHidden` is `true`:

- Interval polling pauses while the document is hidden.
- The current request may finish unless explicitly aborted.
- The watcher may refresh once when the document becomes visible.

This is the recommended default for ordinary dashboards.

### 7.5 Focus Refresh

When `refreshOnFocus` is `true`, the watcher requests one refresh after the window regains focus, subject to the minimum interval.

### 7.6 Manual Refresh

`watcher.refresh()` requests a refresh and uses the same authorization, coalescing, and rate policy as interval refresh.

A manual refresh control is optional and entirely implemented by the Coding Agent.

### 7.7 Stop

`stop()` is idempotent. It cancels timers, aborts active transport when possible, removes visibility listeners, and prevents future listener calls.

## 8. Runtime Policy

The Data Gateway returns effective runtime policy when a Query Revision is registered or described.

```ts
interface QueryRuntimePolicy {
  live: boolean;
  supportsPolling: boolean;
  minRefreshIntervalMs: number;
  defaultCacheTtlMs: number;
  maxExecutionTimeMs: number;
  maxRows: number;
  maxResponseBytes: number;
}
```

The page may request an interval greater than or equal to `minRefreshIntervalMs`. If it requests a smaller interval, the Runtime uses the enforced minimum and exposes the effective value in diagnostics.

The Coding Agent may use the policy to choose sensible behavior, but the policy contains no presentation recommendation.

## 9. Data Source Description Changes

`describe_data_source` includes runtime capabilities:

```ts
interface DataSourceRuntimeCapabilities {
  live: boolean;
  modes: Array<"query" | "poll">;
  minRefreshIntervalMs: number;
}

interface DataSourceDescription {
  // Existing factual source fields and entities.
  runtime: DataSourceRuntimeCapabilities;
}
```

Example:

```json
{
  "id": "sales-prod",
  "name": "Production Sales",
  "kind": "postgres",
  "schemaRevision": 12,
  "runtime": {
    "live": true,
    "modes": ["query", "poll"],
    "minRefreshIntervalMs": 10000
  },
  "entities": []
}
```

This describes source capability only. It does not tell the Agent whether to render a refresh button, status label, chart, table, or any other component.

## 10. Query Tool Changes

The design-time Tool set remains:

```text
list_data_sources
describe_data_source
query_data_source
register_query
test_query
```

Automatic page refresh does not call Pi and does not invoke these Tools at runtime.

### 10.1 `describe_data_source`

Add runtime capabilities to the result:

```text
live
supported refresh modes
minimum refresh interval
```

### 10.2 `register_query`

Return the effective runtime policy with the immutable Query Revision:

```json
{
  "id": "monthly-sales",
  "revision": 3,
  "result": {
    "columns": []
  },
  "runtimePolicy": {
    "live": true,
    "supportsPolling": true,
    "minRefreshIntervalMs": 10000,
    "defaultCacheTtlMs": 5000,
    "maxExecutionTimeMs": 10000,
    "maxRows": 5000,
    "maxResponseBytes": 5242880
  }
}
```

### 10.3 `test_query`

Return the same freshness metadata used at runtime so the Agent can verify behavior:

```text
fetchedAt
sourceUpdatedAt when available
cache status
execution duration
truncation status
```

### 10.4 No Refresh Tool

Do not add a `refresh_dashboard_data` Agent Tool. Runtime refresh is normal application behavior and must not consume model turns or require an Agent Session.

## 11. Query Result Freshness

```ts
interface QueryResult<T extends Record<string, unknown> = Record<string, unknown>> {
  rows: T[];
  meta: {
    columns: QueryResultColumn[];
    rowCount: number;
    truncated: boolean;
    durationMs: number;
    fetchedAt: string;
    sourceUpdatedAt?: string;
    cache: {
      hit: boolean;
      storedAt?: string;
      expiresAt?: string;
    };
  };
}
```

Meanings:

- `fetchedAt`: Time the Data Gateway completed the request.
- `sourceUpdatedAt`: Source-provided freshness time when it can be determined accurately.
- `cache.hit`: Whether the returned data came from the bounded server cache.
- `cache.expiresAt`: Latest time at which the cached value remains valid under policy.
- `truncated`: Whether source rows exceeded the result limit.

The platform must not invent `sourceUpdatedAt` when the source cannot provide it.

## 12. Server-Side Cache

Caching is optional but, when enabled, must be bounded and authorization-safe.

The cache key includes at least:

```text
tenant
viewer authorization scope
Dashboard Publication or Preview Revision
Query Revision
normalized parameters
trusted row-level context
```

A cached result must never be shared across incompatible viewer or tenant authorization scopes.

Rules:

- Cache TTL is finite.
- `live` revalidates when server policy permits.
- Cache failures fall back to authorized source execution.
- Cache entries contain no credentials.
- Query retirement or permission revocation invalidates affected entries.
- Published code never assumes a cache exists.

Redis is not required initially. A small in-process cache is acceptable only for single-instance development. Production may begin without a result cache and add one after query load justifies it.

## 13. Retry and Backoff

The Runtime retries only errors classified as transient, such as temporary network failures, source unavailability, or rate limiting.

It does not retry:

- Authorization failure.
- Invalid parameters.
- Missing Query Binding.
- Retired Query Revision.
- Invalid query definition.

Retry behavior:

- Exponential backoff.
- Bounded maximum delay.
- Random jitter to avoid synchronized refreshes.
- Reset after a successful result.
- Stop immediately when the watcher stops.
- Respect server-provided retry timing.

The Coding Agent receives retry state through `QueryWatchEvent` and decides how to present it.

## 14. Stale Data and Errors

The Runtime does not erase the last successful result when a later refresh fails.

It emits an error event containing:

```ts
interface RuntimeQueryError {
  code: string;
  message: string;
  retryable: boolean;
  occurredAt: string;
  lastSuccessfulFetchAt?: string;
}
```

The generated source may continue displaying the previous result, replace it, annotate it as stale, or show another experience. That presentation decision belongs to the Coding Agent.

The aesthetics Skill should encourage clear refreshing, stale, and failure states without requiring any specific component.

## 15. Authorization on Every Refresh

Every automatic and manual refresh repeats authorization checks.

The server verifies:

1. Dashboard Publication or Preview Revision.
2. Query Binding and pinned Query Revision.
3. Tenant and viewer identity.
4. Share mode.
5. Query permission.
6. Trusted row-level context.
7. Query state and source state.

A watcher does not receive a permanent data-source credential. Revoking access affects the next refresh without republishing the Dashboard.

## 16. Rate and Resource Protection

The server enforces:

- Minimum interval per Query Revision.
- Maximum concurrent queries per tenant and viewer.
- Maximum concurrent executions against one Data Source.
- Statement timeout.
- Row and response-size limits.
- Request cancellation where supported.
- Global emergency disable for an unhealthy source.

Repeated manual refresh cannot bypass these controls.

When many viewers open the same Dashboard, bounded cache and request coalescing may reduce duplicate source execution, but only within compatible authorization scopes.

## 17. Preview Behavior

Preview uses live data by default.

```text
Preview bundle
  → Dashboard Runtime
  → editor identity
  → Preview Revision Query Binding
  → Data Gateway
  → current source data
```

Preview refresh follows the same runtime policy as a Publication, but authorization uses the current editor and Preview Revision.

Changing source code rebuilds the Preview. Changing only source rows does not rebuild it; the next query or watcher refresh shows the new data.

## 18. Published Behavior

A normal Publication uses live data by default.

```text
Immutable frontend bundle
  + immutable Query Revision bindings
  + live authorized query execution
  = dynamic published Dashboard
```

Source data changes appear on the next query execution according to Runtime policy. No Agent Job, source Revision, build, or publish is required.

Changing SQL or Query parameters in the Manifest does require a new Query Revision, Dashboard Revision, validation, and Publication.

## 19. Sharing

### 19.1 Authenticated Sharing

Authenticated viewers receive live data according to their current permissions and row-level context.

### 19.2 Public Live Sharing

Anonymous live execution is allowed only when:

- The Query Revision is explicitly approved for public execution.
- The Data Source permits public use.
- Row-level policy does not depend on a private user identity.
- Rate and abuse controls are configured.
- The Publication is explicitly published in public-live mode.

An anonymous viewer never inherits the creator's permissions.

### 19.3 Snapshot Sharing

Snapshot sharing remains an explicit alternative for data that cannot be queried publicly.

A snapshot share must be visibly identified as a snapshot and include its capture time. It is never presented as automatically refreshed live data.

Live sharing is the normal model for authorized Dashboards. Snapshot sharing is an intentional mode, not the definition of a published Dashboard.

## 20. Observability

Each runtime execution records:

- Dashboard and Publication or Preview Revision.
- Query ID and Query Revision.
- Tenant and authorization scope identifier.
- Refresh reason: initial, interval, focus, manual, or parameters.
- Requested and effective interval when applicable.
- Cache hit or miss.
- Source execution duration.
- Returned row count and bytes.
- Truncation.
- Success or sanitized error code.

Do not log raw sensitive parameters by default.

Metrics include:

- Query requests by refresh reason.
- Cache hit ratio.
- Source execution latency.
- Refresh throttling count.
- Concurrent query count.
- Timeout and retry count.
- Watcher error rate.

## 21. Runtime Message Protocol

When the Dashboard Runtime communicates through iframe `postMessage`, every request includes:

- Protocol version.
- Request ID.
- Query logical name.
- Parameters.
- Requested freshness.
- Refresh reason.

It does not include:

- SQL.
- Data Source ID selected by the browser.
- Tenant ID selected by the browser.
- Viewer ID selected by the browser.
- Query Revision selected by the browser.
- Credentials.

The Viewer Host derives trusted publication, identity, and Query Binding context before calling the Control Plane.

Responses are matched by request ID. Stale responses from cancelled or superseded requests must not replace newer data.

## 22. Security

- Runtime messages are validated against TypeBox schemas.
- Host and iframe origins are checked.
- Query parameters are bound, never interpolated.
- Refresh intervals are clamped to server policy.
- Query results remain scoped to the current viewer.
- Cache keys include authorization scope.
- Preview and published iframes receive no permanent source credential.
- CSP blocks direct source and arbitrary network access.
- Revocation is enforced on the next execution.

Automatic refresh adds traffic, not authority.

## 23. First-Version Scope

The first version implements:

- Live PostgreSQL query execution.
- One-time `dashboard.query()`.
- Polling-based `dashboard.watch()`.
- Manual refresh through `QueryWatcher.refresh()`.
- Visibility pause and focus refresh.
- No-overlap and cancellation behavior.
- Minimum refresh intervals.
- Freshness metadata.
- Structured refresh errors.
- Draft autosave checkpoints.
- Explicit immutable Dashboard Revisions.
- Immutable Publications backed by live Query execution.

The first version does not implement:

- Change Data Capture.
- Database-triggered push updates.
- WebSocket source subscriptions.
- Cross-tab refresh coordination.
- Offline data persistence.
- Background refresh after the page closes.
- Required Redis caching.

Polling is the simplest mechanism that satisfies automatic refresh. A future push transport may be added behind the same presentation-neutral Runtime contract when a real source requires it.

## 24. Tests

### 24.1 Runtime Unit Tests

Test:

- Immediate query.
- Interval refresh.
- No overlapping requests.
- Parameter changes.
- Cancellation.
- Visibility pause.
- Focus refresh.
- Manual refresh.
- Retry classification and backoff.
- Stop cleanup.
- Stale response rejection.

### 24.2 Data Gateway Integration Tests

Test:

- Authorization on every refresh.
- Query Revision resolution.
- Minimum interval enforcement.
- Bound parameters.
- Freshness metadata.
- Timeout and cancellation.
- Result limits.
- Cache isolation between tenants and viewers.
- Permission revocation between two refreshes.

### 24.3 Browser Tests

Test with Playwright:

1. Publish a Dashboard with a watcher.
2. Change a source row without rebuilding.
3. Wait for the next allowed refresh.
4. Verify the page receives the updated result.
5. Hide the page and verify polling pauses when configured.
6. Restore focus and verify one refresh occurs.
7. Revoke viewer access and verify the next refresh fails safely.

### 24.4 Saving Tests

Test:

- Agent Job changes create a Draft Checkpoint.
- Explicit save creates an immutable Dashboard Revision.
- Refresh does not create a Revision.
- Publication builds from a saved Revision.
- Source data changes do not change artifact digests.
- Query Binding changes require a new Revision and Publication.

## 25. Acceptance Criteria

The contract is satisfied when:

1. A user can save and later resume a generated Dashboard.
2. Completed Agent changes are automatically checkpointed.
3. Explicit save creates an immutable source Revision.
4. Publishing creates an immutable frontend bundle with immutable Query Bindings.
5. Published Dashboards query current authorized data without invoking Pi.
6. Source data changes appear without rebuilding or republishing.
7. Generated source can opt into automatic refresh with `dashboard.watch()`.
8. The Coding Agent controls interval choice and every visual refresh state.
9. The platform enforces minimum intervals, authorization, limits, and cancellation.
10. Hidden pages can pause polling and refresh after focus returns.
11. Failed refreshes expose structured errors without deleting the last successful result.
12. Public live data requires explicit approval.
13. Snapshot sharing is explicit and clearly labeled.
14. No runtime or Tool response specifies components, charts, controls, or layouts.
15. Refresh traffic never receives more authority than an ordinary query.
