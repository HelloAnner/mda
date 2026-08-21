# Pi SDK-Based Dynamic Dashboard Management System Design

## 1. Conclusion

The system is technically feasible, and the Pi SDK is well suited to serve as the Coding Agent core for generating and modifying dashboards.

The system should define clear responsibilities:

- **Pi Coding Agent**: Generates, modifies, builds, and validates dashboard code through conversation.
- **Management system**: Manages users, tenants, data sources, dashboard metadata, versions, publishing, sharing, and permissions.
- **Dashboard runtime**: Displays published dashboards and queries data through the standalone Data Source Service.

Pi should not simultaneously act as the database, permission system, dashboard hosting platform, and online query runtime.

## 2. Relationship Between the Pi SDK and Pi Coding Agent

Based on `@earendil-works/pi-coding-agent 0.84.2`, Pi has the following main layers:

```text
pi-ai
  └─ Model and provider abstraction

pi-agent-core
  └─ Minimal agent loop: Message → LLM → Tool → LLM

pi-coding-agent SDK
  └─ Agent loop + coding tools + sessions + skills + extensions
     + compaction + retry + system prompt

Pi CLI / TUI
  └─ Adds a terminal editor, shortcuts, commands, and presentation around the SDK
```

Therefore:

- The Pi SDK is not a reduced or stripped-down Coding Agent.
- By default, `createAgentSession()` provides essentially the same Coding Agent behavior as terminal Pi.
- `createAgentSessionRuntime()` is the more complete session runtime layer. It supports creating, resuming, forking, and importing sessions, and it is also the layer used by Pi's built-in interactive, print, and RPC modes.
- The main difference between the terminal application and the web management system is the interaction shell: the terminal uses a TUI, while the management system must display Agent events through SSE or WebSocket.
- If one dashboard only needs one continuous session, the first version can use `createAgentSession()`. Use `createAgentSessionRuntime()` when a Worker must switch, resume, or fork sessions.

The lower-level minimal Agent runtime is `pi-agent-core`. This system should not use it directly because doing so would require reimplementing Sessions, Coding Tools, Skills, Extensions, Compaction, Retry, and related capabilities.

## 3. Overall Architecture

```text
┌───────────────────────────────────────────┐
│ Web Management System                     │
│ Chat / Dashboards / Data / Versions / Share│
│                         + Preview iframe   │
└─────────────────────┬─────────────────────┘
                      │ SSE / WebSocket
┌─────────────────────▼─────────────────────┐
│ Control Plane                             │
│ Auth, tenants, ACL, dashboard metadata,   │
│ published revisions, sources, links, jobs │
└─────────────────────┬─────────────────────┘
                      │ Agent Job
┌─────────────────────▼─────────────────────┐
│ Isolated Agent Worker                     │
│ Pi SDK AgentSession                       │
│ cwd = isolated workspace for dashboard    │
│ Skill + allowlisted tools                 │
│ Generate / build / validate / submit       │
└────────────┬────────────────────┬─────────┘
             │                    │
   Source/build artifacts   Data Source Service
             │                    │
      Object Storage       HTTP APIs / JDBC sources
```

The access path after publishing is:

```text
Viewer → Immutable published frontend bundle → Data Source Service → Live data source
```

Pi participates only in dashboard design and modification. Viewing or automatically refreshing a published dashboard does not invoke Pi. The frontend bundle is immutable, but its authorized runtime queries return current source data through the standalone Data Source Service.

The Docker Compose deployment uses separate `mda-main` management and `mda-agent` Coding Agent images, backed by PostgreSQL, Redis, and Object Storage. See `docs/docker-compose-deployment-architecture.md`.

## 4. Agent Worker

Each dashboard should have an independent workspace and Pi Session:

```text
/workspaces/{tenantId}/{dashboardId}/
```

The Worker is responsible for:

1. Creating or restoring the dashboard's `AgentSession`.
2. Receiving user messages and calling `session.prompt()`.
3. Subscribing to text, Tool calls, build progress, errors, and other events.
4. Forwarding events to the management UI through SSE or WebSocket.
5. Generating and modifying dashboard source code in the workspace.
6. Calling controlled tools for data queries, builds, previews, and publishing.
7. Saving Session state and an automatic Draft Checkpoint when a file-changing job finishes.

An `AgentSession` must not be shared across tenants or dashboards. Concurrent modifications to the same dashboard should be serialized to prevent simultaneous writes to one workspace.

In production, the Agent Worker should run in a separate container, VM, or micro-VM rather than directly inside the management API process.

## 5. Dashboard Artifact Design: Code Plus Manifest

A purely declarative JSON dashboard configuration is easy to manage but limits flexibility. Generating an entirely arbitrary web project is flexible but difficult to manage, publish, and secure.

Use a hybrid model:

```text
dashboard/
├── src/                       # Freely editable by the Agent
├── dashboard.manifest.json    # Understood by the management system
└── package.json               # Fixed dependencies and build command
```

Example Manifest:

```json
{
  "title": "Sales Analysis",
  "dataSources": ["sales-prod"],
  "queries": ["monthly-sales", "region-ranking"],
  "filters": ["dateRange", "region"],
  "entry": "dist/index.html"
}
```

The Manifest describes information the management system must understand:

- Dashboard name and entry file.
- Data sources in use.
- Registered data queries.
- Global filters.
- Build output and runtime version.
- Permissions required for publishing.

The Agent remains free to implement page layouts, chart combinations, interactions, and visual styles.

The system must fix only these boundaries:

- Data access protocol.
- Identity and tenant boundaries.
- Build command.
- Publishing format.
- Runtime security policy.

The first version should use one fixed frontend build template with a broad set of optional, pre-approved UI and visualization dependencies. The Agent is not required to use any particular component or charting library, but it cannot install arbitrary packages. Expand the reviewed dependency catalog only when the existing options demonstrably cannot meet business requirements.

## 6. Responsibilities of Skills and Tools

### 6.1 Skills: Soft Rules

Skills guide the Agent on:

- Dashboard technology stack and directory structure.
- Visual style, responsiveness, and accessibility rules.
- Chart selection principles.
- Loading, empty-data, and error states.
- Prohibiting secrets in frontend code.
- Requiring builds and previews after modifications.
- Using `dashboard.watch()` for data expected to change while a page remains open, unless the user requests manual refresh.
- Presenting refreshing, stale, and failure states clearly without requiring specific components.
- Using the system-provided data-source tools.

Skills are model instructions, not security boundaries. A model may misunderstand or violate a Skill, so security requirements cannot rely on Skills alone.

### 6.2 Tools: Hard Capabilities and Boundaries

Provide the Agent with controlled tools such as:

```text
list_data_sources
  List data sources authorized for the current tenant and dashboard.

describe_data_source
  Return fields, types, relationships, and available metrics.

query_data_source
  Execute a controlled HTTP request or JDBC read-only SQL exploration operation.

validate_dashboard
  Validate the Manifest, source structure, dependencies, and security rules.

build_preview
  Build the dashboard and produce a preview artifact.

publish_dashboard
  Save an immutable revision and return the publishing result.
```

`publish_dashboard` can be a structured terminating Tool that uses `terminate: true` to end the Agent flow, avoiding the need to parse publishing results from natural-language responses.

When many data sources are available, use Pi's dynamic Tool activation so that only connectors needed by the current task are exposed to the model.

## 7. Standalone Data Source Service

HTTP API and JDBC credentials remain inside the standalone Data Source Service's secret boundary. They must never be written into prompts, dashboard source code, the Control Plane, or the browser.

Data Tools and the Data Source Service must enforce:

- Read-only database accounts.
- User, tenant, dashboard, and data-source authorization.
- Query timeouts.
- Maximum row and response-size limits.
- Validation of SQL, API parameters, and file paths.
- Query auditing.
- Result truncation to protect model context.
- No connection passwords or access tokens in Agent responses.

Separate two types of queries:

1. **Design-time exploratory queries**: The Agent uses `query_data_source` to inspect schemas and sample data while generating a dashboard.
2. **Runtime registered queries**: Publishing pins validated Query Revisions. The dashboard frontend submits only a Query ID and allowed parameters, never arbitrary SQL. One-time queries and automatic polling return current source data without an Agent Job.

This preserves flexibility during generation while preventing published pages from executing arbitrary HTTP requests or database queries.

The service owns Data Source CRUD, rename, configuration and Schema Revisions, HTTP and JDBC connectors, Query Revisions, health, events, and audit records. Other modules use versioned APIs and never access its tables or credentials. See `docs/data-source-management-module.md`.

## 8. Saving, Versioning, and Sharing

A Pi Session stores conversation history and must not be the sole storage for dashboard product data.

| Content | Storage |
|---|---|
| Conversation, Tool calls, Agent context | Pi Session JSONL |
| Dashboard source and Manifest | Workspace snapshot or Object Storage |
| Build artifacts | Object Storage / CDN |
| Dashboard, versions, permissions, share links | Management system database |

Recommended lifecycle:

```text
Conversation-driven changes
  → Autosave Draft Checkpoint
  → Save immutable Revision
  → Build and validate
  → Publish immutable frontend artifact with Query Bindings
  → Runtime queries continue reading live data
```

Saving and publishing should be separate:

- **Autosave**: Store a recoverable Draft Checkpoint after a successful file-changing Agent Job.
- **Save**: Promote the current Draft into an immutable source Revision while allowing later Draft edits.
- **Publish**: Build and validate an immutable frontend artifact with pinned Query Revision bindings.
- **Share**: Configure an ACL or sharing token for a published revision.

Saving and publishing do not freeze ordinary query results. Runtime refresh does not create source Revisions.

Pi's built-in Session sharing shares a conversation, not a business dashboard, so it cannot replace dashboard sharing in the management system.

Authenticated Publications use live data by default. Anonymous live sharing requires Query Revisions explicitly approved for public execution. Snapshot sharing remains an explicit, clearly labeled alternative; anonymous viewers never inherit the creator's database permissions.

## 9. Security Boundaries

### 9.1 Pi Has No Built-In Sandbox

Pi's built-in file tools, `bash`, and Extensions have the operating-system permissions of the Pi process. Project Trust only controls whether project resources are loaded; it is not a runtime sandbox.

Production requires operating-system-level isolation:

- Docker or another container runtime.
- A VM or micro-VM.
- A policy-controlled remote sandbox.

The Worker should mount only the current dashboard workspace, receive only necessary short-lived credentials, and have unnecessary network access disabled.

### 9.2 Disable Default Resource Discovery

By default, `createAgentSession()` may discover Skills, Extensions, Context Files, and configuration from the host and project directories. A multi-tenant system should use an explicit `ResourceLoader`:

- Load only platform-maintained Skills.
- Load only platform-maintained Extensions.
- Configure an explicit Tool allowlist.
- Never load `.pi/extensions` from user workspaces.
- Do not allow generated code to gain privileges by reloading resources.

### 9.3 Isolate Generated Pages

Generated pages may contain broken or malicious JavaScript. Preview and shared pages should:

- Run on a separate origin or inside a sandboxed iframe.
- Use a strict CSP.
- Restrict `connect-src` to the designated Data Gateway.
- Never share cookies or Local Storage with the management application.
- Have no access to the management application's DOM.

### 9.4 Protect Session Data

A Pi Session may contain prompts, schemas, sample data, and Tool output. Therefore:

- Sessions must be isolated by tenant and protected by ACLs.
- Session files must not be exposed directly to share-link viewers.
- Logs and Tool output must not retain data-source credentials.
- Dashboard sharing exposes only published artifacts, not Agent sessions.

## 10. Choosing Between SDK and RPC

### SDK

Suitable for TypeScript Workers running on Bun's Node-compatible runtime:

- Type safety.
- Direct access to `AgentSession` state and events.
- Programmatic configuration of Tools, Skills, Extensions, and the ResourceLoader.
- No additional stdin/stdout JSONL protocol to maintain.

The first version should use the SDK directly inside an isolated Worker.

### RPC

Suitable when:

- The integration is written in another language or requires a subprocess boundary.
- Pi should run as an independent subprocess.
- A language-neutral JSONL protocol is required.

RPC provides a process boundary but is not itself a security boundary. The RPC process must still run in a container or another sandbox.

## 11. Minimum Proof of Concept

The first version should implement only:

1. One fixed frontend build template with optional, pre-approved visualization libraries.
2. Managed HTTP and JDBC read-only Data Sources through the standalone Data Source Service.
3. One independent Docker Worker running the Pi SDK.
4. Chat events streamed to the browser through SSE.
5. Live build output displayed in an iframe.
6. Three core hard-boundary tools: `validate_dashboard`, `build_preview`, and `publish_dashboard`.
7. Immutable revisions and read-only share links.
8. An independent Workspace, Session, and serial job lock for each dashboard.
9. Live runtime queries and polling-based automatic refresh without invoking Pi.

The first version should not implement:

- Multiple frontend frameworks.
- Arbitrary package installation.
- A plugin marketplace.
- Multi-Agent collaboration.
- Concurrent multi-user editing of one dashboard.
- Public sharing of live sensitive data.

## 12. Next Steps

Before implementation, define two contracts:

1. The Schema for `dashboard.manifest.json`.
2. The input and output Schemas for data-source, build, validation, and publishing Tools.

These contracts determine how the management system controls dashboards while preserving the flexibility of Agent-generated code.

## 13. Research Basis

This design is based on the following Pi documentation and examples:

- `docs/sdk.md`: SDK, `AgentSession`, `AgentSessionRuntime`, Tools, Skills, and Sessions.
- `docs/extensions.md`: Custom Tools, event interception, dynamic Tools, structured output, and permission control.
- `docs/session-format.md`: JSONL Sessions, session trees, and SessionManager.
- `docs/rpc.md`: Headless mode, event streaming, and the Extension UI protocol.
- `docs/security.md`: Project Trust, security boundaries, and the lack of a built-in sandbox.
- `docs/containerization.md`: Container, Gondolin, and OpenShell isolation patterns.
- `examples/sdk/12-full-control.ts`: Disabling default discovery and configuring the runtime explicitly.
- `examples/extensions/structured-output.ts`: Terminating structured-output Tools.
- `examples/extensions/dynamic-tools.ts`: Dynamic Tool registration.
- `examples/extensions/permission-gate.ts`: Tool-call interception.

Package version reviewed: `@earendil-works/pi-coding-agent 0.84.2`, licensed under MIT.
