# 基于 Pi SDK 的动态看板管理系统设计

## 1. 结论

该系统在技术上可行，Pi SDK 适合作为看板生成与修改的 Coding Agent 内核。

系统应明确划分职责：

- **Pi Coding Agent**：通过对话生成、修改、构建和验证看板代码。
- **管理系统**：负责用户、租户、数据源、看板元数据、版本、发布、分享和权限。
- **看板运行时**：负责展示已经发布的看板，并通过受控的数据网关查询数据。

Pi 不应同时承担数据库、权限系统、看板托管平台和线上查询运行时。

## 2. Pi SDK 与 Pi Coding Agent 的关系

基于 `@earendil-works/pi-coding-agent 0.84.2`，Pi 的主要分层如下：

```text
pi-ai
  └─ 模型与 Provider 抽象

pi-agent-core
  └─ 最小 Agent Loop：消息 → LLM → Tool → LLM

pi-coding-agent SDK
  └─ Agent Loop + coding tools + session + skill + extension
     + compaction + retry + system prompt

Pi CLI / TUI
  └─ 在 SDK 外增加终端编辑器、快捷键、命令和展示
```

因此：

- Pi SDK 不是弱化版或阉割版 Coding Agent。
- `createAgentSession()` 默认可以获得与终端 Pi 基本相同的 Coding Agent 行为。
- `createAgentSessionRuntime()` 是更完整的会话运行层，支持新建、恢复、分叉和导入会话，也是 Pi 内置交互、打印和 RPC 模式使用的层级。
- 终端应用和 Web 管理系统的主要区别是交互外壳：终端使用 TUI，管理系统需要通过 SSE 或 WebSocket 展示 Agent 事件。
- 如果只需要一个看板对应一个连续会话，第一版使用 `createAgentSession()` 即可；需要在同一 Worker 内切换、恢复或分叉会话时再使用 `createAgentSessionRuntime()`。

真正更底层的最小 Agent 运行时是 `pi-agent-core`。本系统不建议直接使用它，否则需要重新实现 Session、Coding Tools、Skills、Extensions、Compaction 和 Retry 等能力。

## 3. 总体架构

```text
┌─────────────────────────────────────┐
│ Web 管理系统                         │
│ Chat / 看板列表 / 数据源 / 版本 / 分享 │
│                 + Preview iframe     │
└──────────────────┬──────────────────┘
                   │ SSE / WebSocket
┌──────────────────▼──────────────────┐
│ Control Plane                       │
│ 登录、租户、ACL、看板元数据、发布版本   │
│ 数据源注册、分享链接、任务调度           │
└──────────────────┬──────────────────┘
                   │ Agent Job
┌──────────────────▼──────────────────┐
│ 隔离的 Agent Worker                 │
│ Pi SDK AgentSession                 │
│ cwd = 当前看板独立 workspace          │
│ Skill + allowlisted tools           │
│ 生成代码 / 构建 / 验证 / 提交看板       │
└─────────┬──────────────────┬────────┘
          │                  │
   看板源码/构建产物       Data Gateway
          │                  │
   Object Storage        数据库/API/文件
```

看板发布后的访问链路：

```text
访问者 → 已发布的静态看板 → Data Gateway → 数据源
```

Pi 只参与看板的设计和修改阶段。访问者查看已发布看板时不应再次调用 Pi，否则会增加延迟、成本和不稳定性。

## 4. Agent Worker

每个看板应拥有独立的工作目录和 Pi Session：

```text
/workspaces/{tenantId}/{dashboardId}/
```

Worker 的职责包括：

1. 创建或恢复该看板对应的 `AgentSession`。
2. 接收用户消息并调用 `session.prompt()`。
3. 订阅文本、Tool 调用、构建进度和错误等事件。
4. 将事件通过 SSE 或 WebSocket 转发给管理界面。
5. 在工作目录中生成和修改看板源码。
6. 调用受控工具完成数据查询、构建、预览和发布。
7. 在任务结束后保存 Session 和工作区状态。

一个 `AgentSession` 不应被多个租户或多个看板共享。同一看板的并发修改应串行处理，避免同时写入同一工作区。

生产环境中，Agent Worker 应运行在独立容器、虚拟机或微虚拟机中，而不是直接运行在管理系统 API 进程中。

## 5. 看板产物设计：代码与 Manifest 结合

只生成声明式 JSON 看板配置容易管理，但会损失灵活性；完全生成任意 Web 项目虽然自由，但难以管理、发布和保证安全。

推荐采用混合模式：

```text
dashboard/
├── src/                       # Agent 可以自由修改
├── dashboard.manifest.json    # 管理系统必须能理解
└── package.json               # 固定依赖和构建命令
```

Manifest 示例：

```json
{
  "title": "销售分析",
  "dataSources": ["sales-prod"],
  "queries": ["monthly-sales", "region-ranking"],
  "filters": ["dateRange", "region"],
  "entry": "dist/index.html"
}
```

Manifest 负责描述管理系统需要理解的信息：

- 看板名称和入口文件。
- 使用的数据源。
- 已注册的数据查询。
- 全局筛选条件。
- 构建结果和运行时版本。
- 发布所需的权限信息。

Agent 仍可以自由实现页面布局、图表组合、交互和视觉风格。

系统需要固定的边界包括：

- 数据访问协议。
- 身份和租户边界。
- 构建命令。
- 发布格式。
- 运行时安全策略。

第一版应使用一个固定的前端模板、组件库和图表库，不允许 Agent 任意安装 npm 依赖。只有当固定依赖确实无法满足业务需求时，再增加受审核的依赖目录。

## 6. Skill 与 Tool 的职责

### 6.1 Skill：软规范

Skill 用于指导 Agent：

- 看板技术栈和目录结构。
- 视觉风格、响应式和无障碍规范。
- 图表选择原则。
- Loading、空数据和错误状态的展示方式。
- 禁止在前端保存密钥。
- 修改后必须执行构建和预览。
- 如何使用系统提供的数据源工具。

Skill 属于模型指令，不是安全边界。模型可能误解或违反 Skill，因此安全要求不能只依赖 Skill。

### 6.2 Tool：硬能力和硬边界

建议为 Agent 提供以下受控工具：

```text
list_data_sources
  列出当前租户和看板被授权使用的数据源。

describe_data_source
  获取字段、类型、关联关系和可用指标。

query_data_source
  执行受控的只读探索查询。

validate_dashboard
  校验 Manifest、源码结构、依赖和安全规则。

build_preview
  构建看板并生成可预览产物。

publish_dashboard
  保存不可变版本并返回发布结果。
```

`publish_dashboard` 可以设计为结构化、终止型 Tool，通过 `terminate: true` 结束 Agent 流程，避免从自然语言回复中解析发布结果。

数据源数量较多时，可以使用 Pi 的动态 Tool 激活能力，只将当前任务需要的连接器暴露给模型。

## 7. 数据源与 Data Gateway

数据库、API 和文件凭据只保存在服务端凭据系统中，不写入 Prompt、看板源码或浏览器。

数据工具和 Data Gateway 必须执行以下限制：

- 使用只读数据库账号。
- 校验用户、租户、看板和数据源授权。
- 设置查询超时。
- 限制最大返回行数和响应体积。
- 对 SQL、API 参数和文件路径进行校验。
- 对查询行为进行审计。
- 对结果进行截断，避免占满模型上下文。
- 不向 Agent 返回连接密码和访问令牌。

建议区分两类查询：

1. **设计期探索查询**：Agent 在生成看板时通过 `query_data_source` 查看 Schema 和样例数据。
2. **运行期注册查询**：发布时保存经过校验的查询定义，看板前端只提交 Query ID 和允许的参数，不直接提交任意 SQL。

这样可以保留生成阶段的灵活性，同时避免已发布页面执行任意数据库查询。

## 8. 保存、版本和分享

Pi Session 保存的是对话历史，不应作为看板产品数据的唯一存储。

| 内容 | 保存位置 |
|---|---|
| 对话、Tool 调用、Agent 上下文 | Pi Session JSONL |
| 看板源码和 Manifest | Workspace 快照或 Object Storage |
| 构建产物 | Object Storage / CDN |
| 看板、版本、权限、分享链接 | 管理系统数据库 |

推荐生命周期：

```text
对话修改
  → Draft workspace
  → 保存 Revision
  → 构建并验证
  → Publish immutable revision
  → 分享链接指向该 revision
```

保存和发布应分开：

- **保存**：记录当前草稿版本，允许继续修改。
- **发布**：构建并验证，生成不可变产物。
- **分享**：给已发布版本配置 ACL 或分享 Token。

Pi 自带的 Session 分享功能分享的是对话，不是业务看板，不能替代管理系统的看板分享能力。

公共分享建议默认使用数据快照，或者只允许访问明确标记为公开的数据集。匿名分享链接不能继承看板创建者的数据库权限。

## 9. 安全边界

### 9.1 Pi 没有内置 Sandbox

Pi 的内置文件工具、`bash` 和 Extensions 都拥有 Pi 进程的系统权限。Project Trust 只控制项目资源是否加载，不是运行时 Sandbox。

生产环境必须使用操作系统级隔离：

- Docker 或其他容器。
- 虚拟机或微虚拟机。
- 受策略控制的远程 Sandbox。

Worker 只挂载当前看板工作目录，只获得必要的短期凭据，并限制不必要的网络访问。

### 9.2 禁止默认资源发现

`createAgentSession()` 默认可能发现主机和项目目录中的 Skills、Extensions、Context Files 和配置。多租户系统应使用显式 `ResourceLoader`：

- 只加载平台维护的 Skill。
- 只加载平台维护的 Extension。
- 显式配置 Tool allowlist。
- 禁止加载用户工作区中的 `.pi/extensions`。
- 不允许生成代码通过重载资源获得额外权限。

### 9.3 生成页面隔离

生成页面可能包含错误或恶意 JavaScript。预览和分享页面应：

- 部署在独立域名，或使用 sandbox iframe。
- 配置严格 CSP。
- 限制 `connect-src` 到指定 Data Gateway。
- 不与管理后台共享 Cookie 和 Local Storage。
- 不获得管理后台 DOM 权限。

### 9.4 Session 数据保护

Pi Session 可能包含 Prompt、Schema、样例数据和 Tool 输出，因此：

- Session 必须按租户隔离并执行 ACL。
- 不应把 Session 文件直接暴露给分享访问者。
- 日志和 Tool 输出中不得保存数据源凭据。
- 分享看板只分享已发布产物，不分享 Agent 会话。

## 10. SDK 与 RPC 的选择

### SDK

适用于 Node.js/TypeScript Worker：

- 类型安全。
- 可直接访问 `AgentSession` 状态和事件。
- 可编程配置 Tools、Skills、Extensions 和 ResourceLoader。
- 不需要维护额外的 stdin/stdout JSONL 协议。

本系统第一版推荐在隔离 Worker 内直接使用 SDK。

### RPC

适用于：

- 管理系统不是 Node.js 技术栈。
- 希望将 Pi 作为独立子进程运行。
- 需要语言无关的 JSONL 协议。

RPC 提供进程边界，但本身不是安全边界；RPC 进程仍应运行在容器或其他 Sandbox 中。

## 11. 最小验证版本

第一版只实现：

1. 一个固定的前端模板和图表库。
2. 一个只读数据源。
3. 一个运行 Pi SDK 的独立 Docker Worker。
4. Chat 事件通过 SSE 推送到浏览器。
5. 使用 iframe 展示实时构建结果。
6. 提供 `validate_dashboard`、`build_preview` 和 `publish_dashboard` 三个核心硬工具。
7. 保存不可变版本，并生成只读分享链接。
8. 每个看板使用独立 Workspace、Session 和串行任务锁。

第一版暂不实现：

- 多前端框架。
- 任意 npm 包安装。
- 插件市场。
- 多 Agent 协作。
- 多人同时编辑同一看板。
- 公共分享访问实时敏感数据。

## 12. 下一步

开始编码前应优先确定两个契约：

1. `dashboard.manifest.json` 的 Schema。
2. 数据源、构建、验证和发布 Tool 的输入输出 Schema。

这两个契约决定管理系统如何控制看板，同时也是保留 Agent 生成灵活性的核心边界。

## 13. 调研依据

本设计基于以下 Pi 文档和示例：

- `docs/sdk.md`：SDK、`AgentSession`、`AgentSessionRuntime`、Tools、Skills、Sessions。
- `docs/extensions.md`：自定义 Tool、事件拦截、动态 Tool、结构化输出和权限控制。
- `docs/session-format.md`：JSONL Session、树形会话和 SessionManager。
- `docs/rpc.md`：无头模式、事件流和 Extension UI 协议。
- `docs/security.md`：Project Trust、安全边界和无内置 Sandbox。
- `docs/containerization.md`：容器、Gondolin 和 OpenShell 隔离方式。
- `examples/sdk/12-full-control.ts`：关闭默认发现并显式配置完整运行环境。
- `examples/extensions/structured-output.ts`：终止型结构化 Tool。
- `examples/extensions/dynamic-tools.ts`：动态注册 Tool。
- `examples/extensions/permission-gate.ts`：Tool 调用拦截。

当前调研包版本：`@earendil-works/pi-coding-agent 0.84.2`，许可证为 MIT。
