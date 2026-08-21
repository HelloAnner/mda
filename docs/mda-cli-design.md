# MDA CLI Design

## 1. Purpose

MDA provides a command-line client named `mda` as a complete second operating interface alongside the web management UI.

The CLI must support the same Control Plane capabilities as the web UI:

- Dashboard creation and generation.
- One-shot and continuous Agent conversations.
- Conversation resume, fork, inspection, and export.
- Scripted conversation simulation.
- Live Agent text and event streaming.
- Tool calls, arguments, results, errors, and logs.
- Data-source and Query management.
- Dashboard validation, preview, revision, publishing, sharing, and export.
- Job cancellation, retry, diagnostics, and audit inspection.

Core principle:

> The CLI is a client of the same Control Plane API as the web UI. It is not a second implementation of system business logic.

The CLI does not connect directly to PostgreSQL, Object Storage, data sources, or Pi. This preserves identical authorization, revisions, Tool behavior, and security boundaries across both operating methods.

## 2. Executable Name

The executable is:

```bash
mda
```

Examples:

```bash
mda auth login
mda dashboard list
mda dashboard generate --name "Sales Overview" --source sales-prod --prompt "Build a sales dashboard"
mda chat dashboard_123
mda session inspect session_123 --full
mda dashboard export dashboard_123 --format source --output sales-dashboard.tar.gz
```

The CLI package lives in:

```text
apps/cli/
```

It is written in TypeScript and executed or compiled with Bun.

## 3. Client Architecture

```text
┌────────────────────────────────────────────┐
│ mda CLI                                    │
│                                            │
│ command parser  interactive chat  renderer │
│ config/auth     SSE client        exporter │
└─────────────────────┬──────────────────────┘
                      │ HTTPS: REST + SSE
┌─────────────────────▼──────────────────────┐
│ MDA Control Plane                          │
│ Auth, dashboards, sessions, jobs, data,    │
│ revisions, publish, share, audit           │
└─────────────────────┬──────────────────────┘
                      ├─ PostgreSQL
                      ├─ Object Storage
                      ├─ standalone Data Source Service → HTTP APIs / JDBC
                      └─ Redis Job Stream → independent mda-agent image → Pi SDK
```

The CLI may download source and published artifacts, but it never bypasses the Control Plane to retrieve them.

## 4. Domain Terminology

The CLI uses these nouns consistently:

| Term | Meaning |
|---|---|
| Dashboard | Managed dashboard project and its metadata |
| Revision | Immutable source snapshot |
| Publication | Immutable validated build of one Revision |
| Session | One continuous Agent conversation, backed by a Pi AgentSession |
| Job | One accepted prompt and its resulting Agent run |
| Event | Ordered output emitted while a Job runs |
| Tool Call | One Agent invocation of a platform or coding Tool |
| Data Source | Authorized server-side source connection |
| Query Revision | Immutable Agent-authored read-only query |
| Simulation | Scripted sequence of conversation turns and assertions |

A Dashboard may have multiple Sessions. A Session contains multiple user turns and Jobs. A Session may fork into another Session without altering its original history.

## 5. Design Principles

1. **Feature parity**: Every user-facing Control Plane operation must be available through the CLI.
2. **API first**: New functionality is added to the Control Plane contract before adding web or CLI presentation.
3. **Scriptable**: Every non-interactive command supports stable JSON output and meaningful exit codes.
4. **Interactive when useful**: Continuous chat, login, confirmations, and source credentials may use terminal prompts.
5. **Observable**: Agent events, Tool calls, errors, logs, usage, and revisions are inspectable.
6. **Reconnectable**: Live streams resume with durable event cursors after a network interruption.
7. **Secure by default**: Secrets and hidden internal data are never printed, even in verbose mode.
8. **No split brain**: The CLI does not embed a separate Pi runtime or local metadata database.
9. **Bun native first**: Use standard argument parsing, Fetch, Web Streams, filesystem, and terminal APIs before adding a CLI framework.

## 6. Distribution

### 6.1 Compiled Binary

The primary release artifact is a standalone Bun executable:

```bash
bun build --compile apps/cli/src/main.ts --outfile mda
```

Release artifacts should include checksums for supported platforms.

### 6.2 Bun Package

Developers may also run or install the TypeScript package through Bun:

```bash
bun run apps/cli/src/main.ts --help
bun install --global @mda/cli
```

The installed package exposes this `package.json` entry:

```json
{
  "bin": {
    "mda": "./src/main.ts"
  }
}
```

The compiled binary and package use the same source and command registry.

## 7. Internal CLI Structure

```text
apps/cli/src/
├── main.ts
├── commands/
│   ├── auth.ts
│   ├── context.ts
│   ├── tenant.ts
│   ├── dashboard.ts
│   ├── revision.ts
│   ├── publication.ts
│   ├── share.ts
│   ├── chat.ts
│   ├── session.ts
│   ├── job.ts
│   ├── source.ts
│   ├── query.ts
│   ├── simulate.ts
│   ├── audit.ts
│   └── doctor.ts
├── client/
│   ├── api.ts
│   └── sse.ts
├── interactive/
│   └── chat.ts
├── output/
│   ├── human.ts
│   ├── json.ts
│   └── jsonl.ts
├── auth/
├── config/
└── terminal/
```

Use a small command dispatch table and the standard `util.parseArgs` API. Do not add a CLI framework until native parsing becomes a measured maintenance problem.

The CLI imports API and event schemas from `packages/contracts`. It must not duplicate request, response, error, or event types.

## 8. Global Syntax

```text
mda [global options] <command> <subcommand> [arguments] [options]
```

Global options:

```text
--api-url <url>             Override the selected context endpoint
--context <name>            Use a configured context
--tenant <id-or-name>       Override the current tenant
--output <human|json|jsonl> Output mode
--quiet                     Print only the final result
--verbose, -v               Show detailed operational events
--trace                     Show the complete sanitized event stream
--no-color                  Disable ANSI color
--timeout <duration>        Client request timeout
--help, -h                  Show contextual help
--version, -V               Show CLI version
```

Environment variables:

```text
MDA_API_URL
MDA_CONTEXT
MDA_TENANT
MDA_TOKEN
MDA_OUTPUT
MDA_TIMEOUT
NO_COLOR
CI
```

Precedence from highest to lowest:

```text
command option → environment variable → selected context → default
```

## 9. Command Tree

```text
mda
├── auth
│   ├── login
│   ├── logout
│   └── status
├── context
│   ├── list
│   ├── add
│   ├── show
│   ├── use
│   └── remove
├── tenant
│   ├── list
│   ├── show
│   ├── use
│   └── members
├── dashboard
│   ├── list
│   ├── create
│   ├── show
│   ├── update
│   ├── generate
│   ├── validate
│   ├── preview
│   ├── save
│   ├── publish
│   ├── export
│   └── archive
├── revision
│   ├── list
│   ├── show
│   ├── files
│   ├── read
│   ├── diff
│   └── export
├── publication
│   ├── list
│   ├── show
│   ├── open
│   └── download
├── share
│   ├── list
│   ├── create
│   ├── show
│   └── revoke
├── chat
├── session
│   ├── list
│   ├── show
│   ├── inspect
│   ├── start
│   ├── rename
│   ├── send
│   ├── resume
│   ├── fork
│   ├── tree
│   ├── set-model
│   ├── set-thinking
│   ├── compact
│   ├── watch
│   ├── messages
│   ├── tools
│   ├── errors
│   ├── logs
│   ├── stats
│   └── export
├── job
│   ├── list
│   ├── show
│   ├── watch
│   ├── events
│   ├── tools
│   ├── errors
│   ├── logs
│   ├── cancel
│   └── retry
├── source
│   ├── list
│   ├── add
│   ├── show
│   ├── rename
│   ├── update
│   ├── rotate-secret
│   ├── describe
│   ├── test
│   ├── refresh
│   ├── enable
│   ├── disable
│   └── delete
├── query
│   ├── list
│   ├── show
│   ├── explore
│   ├── register
│   ├── test
│   ├── activate
│   └── retire
├── simulate
│   ├── validate
│   ├── run
│   ├── record
│   └── report
├── audit
│   ├── list
│   ├── show
│   └── export
├── completion
├── doctor
└── version
```

Commands are role-aware. Help may show a command the user cannot execute, but invocation returns a stable `FORBIDDEN` error rather than silently hiding capabilities.

## 10. Authentication

### 10.1 Interactive Login

```bash
mda auth login
```

The preferred flow is OIDC device authorization or a browser-based loopback callback:

1. CLI requests a login flow from the Control Plane.
2. CLI displays and optionally opens the authorization URL.
3. User authenticates with the configured OIDC provider.
4. CLI receives a short-lived access token and refresh capability.
5. CLI stores credentials in the operating-system credential store when supported.

If no credential-store integration is available, the first version may use a credential file readable only by the current user. The CLI must explicitly set restrictive file permissions and never place credentials in the ordinary config file.

### 10.2 CI Authentication

Automation uses:

```bash
MDA_TOKEN=... mda dashboard list --output json
```

Environment tokens take precedence over stored interactive credentials and are never persisted.

### 10.3 Commands

```bash
mda auth status
mda auth logout
```

`logout` revokes the refresh credential when supported and removes the local credential entry.

## 11. Contexts

A context selects an API endpoint and optional default tenant.

```bash
mda context add production --api-url https://mda.example.com
mda context add staging --api-url https://staging.mda.example.com
mda context use production
mda context show
mda context list
```

Configuration follows XDG locations:

```text
$XDG_CONFIG_HOME/mda/config.json
```

Fallback:

```text
~/.config/mda/config.json
```

Example:

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "apiUrl": "https://mda.example.com",
      "tenant": "acme"
    }
  }
}
```

No access or refresh token appears in this file.

## 12. Tenant Commands

```bash
mda tenant list
mda tenant show acme
mda tenant use acme
mda tenant members acme
```

`tenant use` updates the selected context. It does not grant membership or alter server-side authorization.

## 13. Dashboard Commands

### 13.1 List and Show

```bash
mda dashboard list
mda dashboard list --status draft --limit 50
mda dashboard show dashboard_123
```

Human output shows name, state, active Revision, active Publication, Session count, and modification time. JSON output returns the full API object.

### 13.2 Create

```bash
mda dashboard create --name "Sales Overview"
mda dashboard create --name "Sales Overview" --source sales-prod
```

Creating a Dashboard does not automatically start an Agent Job unless a prompt is supplied.

### 13.3 Update

```bash
mda dashboard update dashboard_123 --name "Executive Sales" --description "Sales and regional performance"
```

Only supplied metadata fields change. Source changes continue to use Agent conversations and immutable Revisions.

### 13.4 Generate

`dashboard generate` is the high-level non-interactive generation command:

```bash
mda dashboard generate \
  --name "Sales Overview" \
  --source sales-prod \
  --prompt "Create an executive sales dashboard"
```

It composes these server operations:

1. Create or select a Dashboard.
2. Start or select a Session.
3. Submit the prompt as an Agent Job.
4. Stream progress unless `--detach` is used.
5. Return the resulting Dashboard, Session, Job, Preview, and Revision identifiers.

Supported input:

```bash
mda dashboard generate --prompt "Build a dashboard"
mda dashboard generate --prompt-file prompt.md
printf '%s' 'Build a dashboard' | mda dashboard generate --stdin
```

Useful options:

```text
--dashboard <id>       Generate into an existing Dashboard
--name <name>          Name for a new Dashboard
--source <id>          Authorized Data Source; repeatable
--prompt <text>        User prompt
--prompt-file <path>   Read prompt from file
--stdin                Read prompt from stdin
--model <id>           Select an allowed model
--thinking <level>     Select an allowed reasoning level
--wait                 Wait for completion; default in a TTY
--detach               Return after Job creation
--preview              Build a Preview after the Agent settles
--validate             Validate the resulting Revision
--publish              Publish after successful validation
--output <mode>        Human, JSON, or JSONL
```

`--publish` must not publish an unrecorded mutable workspace. The server saves and validates a Revision first.

### 13.5 Validate

```bash
mda dashboard validate dashboard_123
mda dashboard validate dashboard_123 --revision revision_456
```

The command streams build and validation events and exits non-zero on failure.

### 13.6 Preview

```bash
mda dashboard preview dashboard_123
mda dashboard preview dashboard_123 --revision revision_456 --open
```

It prints a short-lived Preview URL. `--open` uses the operating system's default browser.

### 13.7 Save

```bash
mda dashboard save dashboard_123 --message "Refine regional breakdown"
```

This creates an immutable source Revision from the current Draft workspace.

### 13.8 Publish

```bash
mda dashboard publish dashboard_123 --revision revision_456
mda dashboard publish dashboard_123 --revision revision_456 --open
```

Publishing requires an idempotency key generated by the CLI unless explicitly supplied.

### 13.9 Archive

```bash
mda dashboard archive dashboard_123
```

Archive is preferred over destructive deletion. It requires confirmation in a TTY and `--yes` in non-interactive mode.

## 14. Dashboard Export

The CLI supports exporting source and published artifacts without exposing credentials.

```bash
mda dashboard export dashboard_123 --format source
mda dashboard export dashboard_123 --format bundle --publication publication_789
mda dashboard export dashboard_123 --format complete --output dashboard.tar.gz
```

Formats:

| Format | Content |
|---|---|
| `source` | Manifest, `src/`, `public/`, template metadata, and lockfile metadata |
| `bundle` | One immutable published `dist/` bundle |
| `complete` | Source Revision plus matching published bundle and safe metadata |
| `manifest` | Manifest and Query Binding metadata only |

Options:

```text
--revision <id>
--publication <id>
--format <source|bundle|complete|manifest>
--archive <tar.gz|zip>
--output <path>
--force
--verify
```

The default output file is derived from the Dashboard name and Revision.

Exports exclude:

- Data-source credentials.
- Model credentials.
- Internal service tokens.
- Unredacted Agent logs.
- Pi Session history unless separately requested through `session export`.

When `--verify` is used, the CLI validates the server-provided checksum after download.

A bundle export contains the immutable frontend artifact and Query Binding metadata, not frozen query results. Live data still comes from an authorized MDA Runtime and Data Gateway unless the user explicitly requests a clearly labeled snapshot export mode.

## 15. Revision Commands

```bash
mda revision list --dashboard dashboard_123
mda revision show revision_456
mda revision files revision_456
mda revision read revision_456 src/App.tsx
mda revision diff revision_455 revision_456
mda revision export revision_456 --output revision.tar.gz
```

`revision diff` supports:

```text
--stat              Summary only
--name-only         Changed paths only
--path <glob>       Filter paths
--format <unified|json>
--color <auto|always|never>
```

Diff output is computed from immutable source snapshots. It does not depend on a currently running Agent workspace.

## 16. Publication and Share Commands

```bash
mda publication list --dashboard dashboard_123
mda publication show publication_789
mda publication open publication_789
mda publication download publication_789 --output dist.tar.gz
```

Share links:

```bash
mda share create --publication publication_789 --access authenticated
mda share create --publication publication_789 --access public --expires 7d
mda share list --dashboard dashboard_123
mda share show share_123
mda share revoke share_123
```

Authenticated shares use live data by default. A public-live share requires explicitly approved public Query Revisions; a snapshot is an explicit, clearly labeled alternative. The CLI cannot override server policy.

## 17. Continuous Conversation

### 17.1 Interactive Chat

```bash
mda chat dashboard_123
```

The command:

1. Finds the latest resumable Session for the Dashboard or offers to create one.
2. Opens an interactive prompt.
3. Streams Agent text, Tool activity, builds, and errors.
4. Keeps all turns in the same Session until the user starts or selects another Session.
5. Preserves the Session on exit so a later CLI or web interaction can resume it.

Explicit Session selection:

```bash
mda chat dashboard_123 --session session_123
mda chat dashboard_123 --new-session
mda chat dashboard_123 --resume latest
```

### 17.2 Interactive Display

Default display:

```text
You › Add a regional filter

Agent › I will inspect the current query and update the dashboard.

  describe_data_source   sales-prod                    ✓ 120ms
  query_data_source      regional-sales                ✓ 340ms
  edit                   src/components/Filters.tsx    ✓
  build_preview                                         ✓ 2.1s

Preview: https://preview.example/...
Agent › Added the regional filter and linked it to the charts.
```

Display levels:

| Level | Behavior |
|---|---|
| Default | Assistant text plus compact Tool and build status |
| `--verbose` | Tool arguments, summarized results, file changes, usage, retries |
| `--trace` | Complete sanitized platform event stream |
| `--quiet` | Final assistant text and final identifiers only |

### 17.3 Chat Commands

Interactive commands begin with `/`:

```text
/help
/status
/session
/messages
/tools
/errors
/logs
/stats
/preview
/validate
/save [message]
/publish
/steer <message>
/follow-up <message>
/compact [instructions]
/new
/resume <session-id>
/fork [entry-id]
/abort
/clear
/quit
```

These commands call Control Plane APIs. They are not injected into the Agent as ordinary user text.

### 17.4 Streaming Messages

When an Agent Job is active:

- `/steer <message>` queues a steering message for the active run.
- `/follow-up <message>` queues a message after the active run settles.
- Ordinary text waits for the interactive prompt unless the user explicitly selects one of these behaviors.

Non-interactive equivalents:

```bash
mda session send session_123 --message "Focus on accessibility" --behavior steer
mda session send session_123 --message "Then build a preview" --behavior follow-up
```

### 17.5 Signals

- First `Ctrl+C` during an active Job requests cancellation.
- Second `Ctrl+C` exits immediately after restoring terminal state.
- `Ctrl+D` exits an idle chat without deleting the Session.
- Terminal resize affects rendering only and never the event stream.

## 18. Session Commands

### 18.1 List, Start, and Resume

```bash
mda session list --dashboard dashboard_123
mda session start --dashboard dashboard_123
mda session rename session_123 "Regional redesign"
mda session resume session_123
mda session fork session_123 --entry entry_456
mda session tree session_123
mda session set-model session_123 approved-model-id
mda session set-thinking session_123 high
```

`resume` opens interactive chat by default. Use `--no-interactive` to print Session state only.

`tree` displays the stored conversation branches, labels, compaction points, and current leaf. Model and thinking changes apply to later turns and must use server-approved values.

### 18.2 Send a Turn

```bash
mda session send session_123 --message "Replace the table with a custom comparison view"
mda session send session_123 --file prompt.md
printf '%s' 'Improve mobile layout' | mda session send session_123 --stdin
```

By default, a TTY waits and streams the Job. Automation may use `--detach` and then `job watch`.

### 18.3 Show and Inspect

```bash
mda session show session_123
mda session inspect session_123 --full
```

`show` provides a summary:

- Session ID and name.
- Dashboard and tenant.
- Pi provider, model, and reasoning level.
- Creation and last activity times.
- Current branch and parent Session.
- Message, Job, Tool-call, and error counts.
- Token usage and cost.
- Current source Revision and Preview.

`inspect --full` displays the complete authorized timeline:

- User and assistant messages.
- Surfaced thinking events when available and policy allows them.
- Tool calls, arguments, results, duration, and errors.
- Builds, previews, Revisions, and Publications.
- Retries, compaction, cancellation, and branch events.
- Model usage and cost by turn.
- Changed files and artifact references.

The CLI cannot expose hidden provider reasoning that the model or policy does not make available. `--full` means all stored, authorized operational details, not secrets or private chain-of-thought.

To replay the Session timeline and follow its currently active Job:

```bash
mda session watch session_123
mda session watch session_123 --since 120 --output jsonl
```

`session watch` ends when the current Job settles. It does not wait indefinitely for a future user turn.

### 18.4 Messages

```bash
mda session messages session_123
mda session messages session_123 --role user
mda session messages session_123 --since entry_456
mda session messages session_123 --output json
```

### 18.5 Tool Calls

```bash
mda session tools session_123
mda session tools session_123 --name query_data_source
mda session tools session_123 --errors-only
mda session tools session_123 --include-input --include-result
```

Human output truncates large inputs and results. `--full` requests complete sanitized content when the user is authorized.

### 18.6 Errors

```bash
mda session errors session_123
mda session errors session_123 --include-recovered
mda session errors session_123 --output json
```

Errors include:

- Model/provider failures.
- Tool failures.
- Data Gateway errors.
- Build and validation errors.
- Sandbox/process errors.
- Retry and compaction failures.
- Cancellation causes.

### 18.7 Logs

```bash
mda session logs session_123
mda session logs session_123 --job job_456
mda session logs session_123 --level error
mda session logs session_123 --follow
```

Logs are sanitized server-side before storage. The CLI never has an option to reveal credentials or raw authorization headers.

### 18.8 Statistics

```bash
mda session stats session_123
```

Statistics include:

- User and assistant message counts.
- Agent Job count and duration.
- Tool calls grouped by name and status.
- Input, output, cache-read, and cache-write tokens.
- Total model cost.
- Build count, duration, and failures.
- Query count, duration, and returned rows.
- Source files changed.

### 18.9 Compact

```bash
mda session compact session_123
mda session compact session_123 --instructions "Preserve query and source decisions"
```

Compaction is an Agent operation and creates normal Session events.

### 18.10 Export Conversation

```bash
mda session export session_123 --format jsonl
mda session export session_123 --format json
mda session export session_123 --format html
mda session export session_123 --format markdown
```

Formats:

| Format | Purpose |
|---|---|
| `jsonl` | Lossless stored Session entries and event references |
| `json` | Structured Session tree and summary |
| `html` | Human-readable standalone conversation report |
| `markdown` | Reviewable text with Tool and error summaries |

Options:

```text
--output <path>
--include-tools
--include-results
--include-logs
--include-usage
--branch <entry-id>
--redaction <default|strict>
```

Session exports never include credentials. Tool results remain subject to authorization and redaction policy.

## 19. Job Commands

A Job represents one prompt run and is the primary unit for live events and cancellation.

```bash
mda job list --dashboard dashboard_123
mda job show job_456
mda job watch job_456
mda job cancel job_456
mda job retry job_456
```

### 19.1 Watch

```bash
mda job watch job_456
mda job watch job_456 --verbose
mda job watch job_456 --output jsonl
```

`watch` reconnects with the last received event sequence after transient network failures.

### 19.2 Events

```bash
mda job events job_456
mda job events job_456 --since 120
mda job events job_456 --type tool.completed
mda job events job_456 --output jsonl --full
```

This is the lowest-level supported operational view. It returns stable platform events, not undocumented Pi event objects.

### 19.3 Tool Calls, Errors, and Logs

```bash
mda job tools job_456 --include-input --include-result
mda job errors job_456
mda job logs job_456 --follow
```

### 19.4 Retry

```bash
mda job retry job_456
```

Retry creates a new Job linked to the failed Job. It does not mutate or pretend to resume an already terminal Job.

Only retryable terminal failures may be retried automatically. A validation failure normally requires a new conversation turn instead.

## 20. Data Source Commands

### 20.1 List and Show

```bash
mda source list
mda source show sales-prod
mda source describe sales-prod
```

`describe` returns factual schema information only. It never returns chart, control, or component instructions.

### 20.2 Add

```bash
mda source add http --name customer-api --config customer-api.json
mda source add jdbc --name sales-prod --config sales-jdbc.json
```

Secrets are entered through a hidden terminal prompt or supplied through a secure secret reference. Password flags are not supported because they leak through shell history and process listings.

Non-interactive automation uses a secret-manager reference:

```bash
mda source add jdbc \
  --name sales-prod \
  --config sales-jdbc.json \
  --secret-ref secret://mda/sales-prod
```

### 20.3 Rename, Update, Test, and Refresh

```bash
mda source rename sales-prod production-sales
mda source update production-sales --description "Production sales reporting"
mda source rotate-secret production-sales --secret-ref secret://mda/sales-prod-v2
mda source test production-sales
mda source refresh production-sales
```

`test` validates connectivity and read-only behavior. `refresh` creates a new source Schema Revision after successful introspection.

### 20.4 State and Deletion

```bash
mda source disable production-sales
mda source enable production-sales
mda source delete production-sales --yes
```

Delete is soft during the retention period and is blocked while retained Publications or Query policy require the source. Rename and edit preserve the stable Data Source ID.

## 21. Query Commands

### 21.1 List and Show

```bash
mda query list --source sales-prod
mda query show monthly-sales
mda query show monthly-sales --revision 3
```

### 21.2 Explore

```bash
mda query explore sales-prod --sql-file query.sql
printf '%s' 'SELECT region, sum(amount) FROM sales GROUP BY region' \
  | mda query explore sales-prod --stdin
```

Exploration runs through the same read-only Data Gateway policy as Agent Tools.

### 21.3 Register

```bash
mda query register \
  --source sales-prod \
  --name monthly-sales \
  --sql-file monthly-sales.sql \
  --parameters parameters.json
```

The server validates the statement and creates an immutable Query Revision.

### 21.4 Test and Retire

```bash
mda query test monthly-sales --revision 3 --params params.json
mda query activate monthly-sales --revision 3
mda query retire monthly-sales --revision 2
```

Query output is ordinary structured data. The CLI does not recommend components or visualizations.

## 22. Simulated Conversations

A Simulation executes a scripted conversation against the real Control Plane and Agent path. It is useful for regression testing, demos, evaluation, and CI.

Simulation does not mean a mocked conversation by default. The model may remain nondeterministic, so assertions focus on observable behavior and artifacts rather than exact prose.

### 22.1 Scenario Format

Use JSON to avoid adding a YAML parser and to allow validation through TypeBox/JSON Schema.

```json
{
  "schemaVersion": 1,
  "name": "sales-dashboard-generation",
  "setup": {
    "createDashboard": true,
    "dashboardName": "Simulation Sales Dashboard",
    "sources": ["sales-fixture"],
    "model": "approved-default"
  },
  "turns": [
    {
      "message": "Create an executive sales dashboard",
      "expect": {
        "status": "succeeded",
        "tools": [
          "describe_data_source",
          "register_query",
          "build_preview"
        ],
        "noToolErrors": true,
        "files": [
          "src/**",
          "dashboard.manifest.json"
        ]
      }
    },
    {
      "message": "Add a mobile-friendly regional filter",
      "expect": {
        "status": "succeeded",
        "validation": "passed",
        "noErrors": true
      }
    }
  ]
}
```

### 22.2 Validate

```bash
mda simulate validate scenarios/sales-dashboard.json
```

This validates the scenario schema without starting a Dashboard or Agent Job.

### 22.3 Run

```bash
mda simulate run scenarios/sales-dashboard.json
mda simulate run scenarios/sales-dashboard.json --output json
mda simulate run scenarios/*.json --concurrency 2
```

Options:

```text
--keep-dashboard          Keep generated Dashboard after the run
--publish                 Allow publishing steps
--model <id>              Override an allowed scenario model
--concurrency <n>         Maximum concurrent scenarios
--fail-fast               Stop after the first failed scenario
--report <path>           Write a structured report
--timeout <duration>      Per-turn timeout
--output <human|json|jsonl>
```

Simulation concurrency is bounded by server policy. The CLI cannot override tenant Agent quotas.

### 22.4 Assertions

Supported first-version assertions:

```text
Job terminal status
Required or forbidden Tool names
No Tool errors
No Agent errors
Required changed paths
Manifest Schema validity
Dashboard validation status
Preview availability
Publication availability
Query Binding presence
Maximum cost or token usage
Maximum turn duration
Assistant text includes a non-sensitive substring
```

Do not make exact assistant prose the default assertion because it is brittle across valid model outputs.

### 22.5 Record

```bash
mda simulate record session_123 --output scenario.json
```

`record` creates a scenario skeleton from an existing Session:

- User messages become turns.
- Tool calls become suggested Tool assertions.
- Source IDs are included when authorized.
- Generated expectations are conservative and require review.
- Assistant prose is not recorded as an exact assertion.

### 22.6 Report

```bash
mda simulate report simulation_run_123
mda simulate report simulation_run_123 --format html --output report.html
```

A report contains:

- Scenario and turn status.
- Session and Job links.
- Tool-call timeline.
- Errors and retries.
- Token usage and cost.
- Changed files and Revisions.
- Validation, Preview, and Publication results.
- Assertion failures.

## 23. Audit Commands

```bash
mda audit list --dashboard dashboard_123
mda audit list --actor user_123 --since 24h
mda audit show audit_456
mda audit export --since 2026-01-01 --output audit.jsonl
```

Audit access is role restricted. Exported records remain sanitized and may omit sensitive Query parameter values.

## 24. Output Modes

### 24.1 Human

Default for a TTY. Uses compact tables, colors, progress lines, and readable errors.

### 24.2 JSON

```bash
mda dashboard show dashboard_123 --output json
```

Prints exactly one JSON value to stdout. Progress and diagnostics go to stderr.

### 24.3 JSONL

```bash
mda job watch job_456 --output jsonl
```

Prints one stable event object per line. It is the preferred mode for streaming automation.

### 24.4 Quiet

Prints only the principal final value, such as an ID, URL, or path.

```bash
publication_id=$(mda dashboard publish dashboard_123 --quiet)
```

### 24.5 stdout and stderr

- Requested data and final results go to stdout.
- Progress, warnings, and diagnostics go to stderr.
- JSON and JSONL stdout never contains spinners or ANSI codes.
- Fatal errors go to stderr and use a non-zero exit code.

## 25. Event Rendering

Stable event envelope:

```ts
interface CliEvent {
  sequence: number;
  timestamp: string;
  type: string;
  tenantId: string;
  dashboardId?: string;
  sessionId?: string;
  jobId?: string;
  data: unknown;
}
```

Common event types:

```text
job.queued
job.started
assistant.delta
assistant.completed
tool.started
tool.updated
tool.completed
tool.failed
build.started
build.completed
validation.completed
preview.ready
revision.saved
publication.created
agent.retrying
agent.compacting
job.cancelled
job.failed
job.completed
```

The CLI renderer depends on these platform events, not directly on Pi's internal event union. Unknown event types are retained in JSON/JSONL and displayed generically in human mode, allowing forward-compatible clients.

## 26. Tool Call Visibility

Tool records contain:

```ts
interface ToolCallView {
  id: string;
  name: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  input?: unknown;
  result?: unknown;
  error?: ApiError;
}
```

Visibility rules:

- Default human output shows Tool name, target summary, status, and duration.
- `--verbose` shows sanitized inputs and summarized results.
- `--full` shows complete authorized results subject to server truncation policy.
- `--trace` includes every Tool lifecycle event.
- Secrets are removed before data reaches the CLI.
- Large outputs include truncation metadata and an authorized artifact reference when available.

## 27. Error and Log Behavior

Human error example:

```text
QUERY_INVALID: Column "revenue_total" does not exist
Job: job_456
Tool: register_query
Retryable: no
Hint: run `mda job errors job_456 --full`
```

JSON error example:

```json
{
  "code": "QUERY_INVALID",
  "message": "Column \"revenue_total\" does not exist",
  "requestId": "request_123",
  "retryable": false,
  "details": {
    "jobId": "job_456",
    "tool": "register_query"
  }
}
```

Logs support:

```text
--level <debug|info|warn|error>
--since <timestamp-or-duration>
--until <timestamp>
--follow
--search <text>
--output <human|json|jsonl>
```

Server-side sanitization is authoritative. The CLI cannot disable redaction.

## 28. Exit Codes

| Code | Meaning |
|---:|---|
| 0 | Success |
| 1 | Unclassified operation failure |
| 2 | Invalid CLI usage or local input |
| 3 | Authentication or authorization failure |
| 4 | Resource not found or state conflict |
| 5 | Validation, build, or publishing failure |
| 6 | Agent or Tool failure |
| 7 | Network, timeout, or server availability failure |
| 8 | Operation cancelled |
| 9 | Simulation assertion failure |

Scripts should prefer structured error `code` values over exit codes when they need detailed branching.

## 29. Confirmation and Non-Interactive Safety

Commands requiring confirmation:

- Archive Dashboard.
- Revoke Share Link.
- Disable or remove Data Source.
- Retire an active Query Revision.
- Cancel an active Job.
- Publish to a protected environment when policy requires approval.

TTY mode prompts for confirmation. Non-interactive mode fails unless `--yes` is supplied.

The CLI never prompts when stdin is not a TTY unless the command explicitly requested interactive input.

## 30. API Compatibility

The CLI sends its version and supported contract version with every request.

```text
X-MDA-CLI-Version
X-MDA-Contract-Version
```

At startup or through `mda doctor`, the CLI checks the server metadata endpoint.

Compatibility rules:

- Patch differences are accepted.
- Additive minor server features are ignored by older clients.
- A contract-major mismatch fails before a mutating operation.
- Unknown JSON fields are ignored.
- Unknown event types are preserved and rendered generically.

## 31. Completion

```bash
mda completion bash
mda completion zsh
mda completion fish
```

Completion scripts are generated from the command registry so help and completion cannot drift independently.

Dynamic completion may suggest authorized Dashboard, Session, Source, and Query identifiers only when explicitly enabled because shell completion can trigger network requests.

## 32. Doctor

```bash
mda doctor
```

Checks:

- CLI version.
- Selected context.
- API reachability.
- Contract compatibility.
- Authentication status and expiry.
- Tenant access.
- SSE connectivity.
- Local config and credential-file permissions.
- Download directory writability.

`doctor` does not inspect server-side credentials or execute a model request.

## 33. Performance and Resilience

- Ordinary metadata requests use finite client timeouts.
- Artifact downloads stream to disk instead of buffering entire archives.
- Downloads write to a temporary path and rename atomically after checksum verification.
- SSE reconnects use exponential backoff with a bounded delay.
- Event reconnect sends the last durable sequence.
- Mutating requests include idempotency keys.
- Interactive terminal state is restored through `finally` and signal handlers.
- CLI retries safe reads automatically but never repeats a mutation without an idempotency key.

## 34. Security

The CLI must:

- Validate HTTPS by default.
- Require an explicit development flag for insecure local TLS.
- Never accept passwords as command-line arguments.
- Never log access or refresh tokens.
- Store credentials separately from configuration.
- Use restrictive permissions for credential and export files.
- Sanitize terminal control characters in server-provided text.
- Prevent path traversal in downloaded archive names.
- Verify artifact checksums when supplied.
- Respect server-side authorization and redaction.

`--trace` exposes operational detail, not secrets. It must remain safe enough for an authorized user to attach to a support ticket after applying the selected redaction policy.

## 35. Feature Parity Matrix

| Capability | Web | CLI |
|---|:---:|:---:|
| Login and tenant selection | Yes | Yes |
| Dashboard CRUD and archive | Yes | Yes |
| One-shot generation | Yes | Yes |
| Continuous conversation | Yes | Yes |
| Steering and follow-up | Yes | Yes |
| Session resume and fork | Yes | Yes |
| Full message inspection | Yes | Yes |
| Tool-call inspection | Yes | Yes |
| Errors, logs, usage, and cost | Yes | Yes |
| Data-source management | Yes | Yes |
| Query exploration and registration | Yes | Yes |
| Revision diff and export | Yes | Yes |
| Preview and validation | Yes | Yes |
| Publish and share | Yes | Yes |
| Dashboard export | Yes | Yes |
| Scripted conversation simulation | Optional UI | Yes |
| Raw JSONL event stream | No | Yes |
| Audit export | Limited UI | Yes |

A server feature is not complete until its API contract is usable by both the web client and `mda`, unless it is inherently terminal-specific.

## 36. Testing

### 36.1 Unit Tests

Use `bun test` for:

- Argument parsing and command dispatch.
- Config precedence.
- Output formatting.
- Error-to-exit-code mapping.
- Redaction and terminal escaping.
- Scenario validation.
- Event rendering.

### 36.2 Contract Tests

Run the CLI against a deterministic Control Plane fixture for every command group. Validate requests and responses through shared TypeBox schemas.

### 36.3 Integration Tests

Test against a real development stack:

- OIDC login fixture.
- Dashboard generation Job.
- SSE disconnect and resume.
- Continuous Session turns.
- Tool, error, and log inspection.
- Source description and Query execution.
- Revision, Preview, Publication, and export download.
- Cancellation and retry.

### 36.4 Simulation Tests

Maintain at least one checked-in scenario that:

1. Creates a Dashboard.
2. Describes a sample source.
3. Generates dashboard source.
4. Registers a Query.
5. Builds a Preview.
6. Continues the same Session with a second turn.
7. Validates and publishes.
8. Exports source and conversation records.

### 36.5 Snapshot Scope

Snapshot only stable human formatting. Do not snapshot timestamps, IDs, model prose, or token counts without normalization.

## 37. First Implementation Slice

Implement in this order:

1. Global parsing, help, contexts, and authentication.
2. Shared API client and error handling.
3. `dashboard list`, `create`, `show`, and `generate`.
4. SSE client and `job watch`.
5. `chat` and Session persistence across CLI restarts.
6. `session inspect`, `tools`, `errors`, `logs`, and `stats`.
7. `dashboard validate`, `preview`, `save`, `publish`, and `export`.
8. Source and Query commands.
9. Simulation commands.
10. Share, audit, completion, and doctor commands.

The first vertical slice is complete when this works:

```bash
mda auth login
mda dashboard generate \
  --name "Sales Overview" \
  --source sales-fixture \
  --prompt "Build a polished sales dashboard"
mda chat <dashboard-id>
mda session inspect <session-id> --full
mda dashboard export <dashboard-id> --format complete
```

## 38. Acceptance Criteria

The CLI design is satisfied when:

1. The executable is named `mda`.
2. The CLI uses the same Control Plane contracts as the web client.
3. It can generate a Dashboard with one command.
4. It supports continuous multi-turn conversation in one Session.
5. A Session can be resumed after the CLI exits.
6. Sessions can be listed, inspected, forked, compacted, and exported.
7. Every Tool call, sanitized input, result, duration, and error is inspectable.
8. Job events can be streamed and replayed as JSONL.
9. Logs, usage, cost, retries, builds, and errors are visible.
10. Dashboards, source Revisions, and published bundles can be exported.
11. Scripted simulations can run in CI and fail on behavioral assertions.
12. Source and Query operations preserve the presentation-neutral Data Gateway contract.
13. Interactive output is readable while JSON and JSONL remain stable for scripts.
14. Secrets never appear in output, logs, exports, or shell history.
15. Browser disconnects and CLI restarts do not lose durable conversation history.
