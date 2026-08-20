# Dashboard Artifact Contract

## 1. 目标

本契约定义 Coding Agent 生成的看板如何被管理系统构建、预览、保存和发布，同时保证 `src/` 仍然具有 Vibe Coding 所需的自由度。

核心原则：

> 管理系统约束看板的输入、输出和安全边界，不约束 `src/` 内部如何实现。

看板源码是第一等产物，不转换为低代码 DSL，也不要求映射成固定的图表组件树。

## 2. 必须保留的 Coding Agent 体验

Coding Agent 对 `src/**` 拥有完整编辑权，可以：

- 新建、删除、移动和重命名文件。
- 自由拆分组件、Hooks、工具函数和样式。
- 自由选择页面布局和信息层级。
- 使用 CSS、SVG、Canvas、WebGL 和浏览器原生 API。
- 使用平台预装的组件库与可视化库。
- 实现筛选、联动、钻取、动画和自定义交互。
- 根据对话持续重构已有实现，而不是只能修改 JSON 配置。

管理系统不得：

- 要求每个图表都在 Manifest 中声明。
- 将 `src/` 反向转换成平台私有 DSL。
- 通过可视化编辑器重写 Agent 生成的源码。
- 依赖解析 React 组件树来理解看板。
- 规定固定的组件数量、目录层级或页面布局。

管理系统只关心：

1. 看板能否构建。
2. 看板是否使用合法的数据查询。
3. 看板是否符合运行时和安全边界。
4. 构建产物入口在哪里。

## 3. 目录与所有权

```text
dashboard/
├── dashboard.manifest.json
├── src/
├── public/
├── package.json
├── vite.config.ts
└── dist/
```

| 路径 | 所有者 | 说明 |
|---|---|---|
| `src/**` | Coding Agent | 完全自由生成和重构 |
| `public/**` | Coding Agent | 本地图片、字体和其他静态资源 |
| `dashboard.manifest.json` | Coding Agent + 平台校验 | 声明外部契约，不描述内部 UI |
| `package.json` | 平台 | 固定脚本和已批准依赖 |
| `vite.config.ts` | 平台 | 固定构建和 Runtime 注入方式 |
| `dist/**` | 构建系统 | 不允许 Agent 直接编辑 |

第一版不允许 Agent 直接修改 `package.json` 或安装任意依赖。平台应预装足够通用的依赖，但不能因此限制 `src/` 的组织和实现方式。

后续确有需求时，可以增加显式的 `request_dependency` 流程，由平台审核并更新依赖模板，而不是开放任意 `npm install`。

## 4. Manifest 边界

Manifest 只描述管理系统必须知道的外部依赖，不描述页面布局和图表实现。

第一版示例：

```json
{
  "schemaVersion": 1,
  "title": "销售分析",
  "description": "展示销售趋势和区域表现",
  "entry": "dist/index.html",
  "runtimeVersion": "1",
  "queries": [
    {
      "id": "monthly-sales",
      "parameters": {
        "startDate": "date",
        "endDate": "date"
      }
    },
    {
      "id": "region-ranking",
      "parameters": {}
    }
  ]
}
```

### 4.1 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | Manifest Schema 版本 |
| `title` | 是 | 看板显示名称 |
| `description` | 否 | 看板用途说明 |
| `entry` | 是 | 固定为构建后的入口文件 |
| `runtimeVersion` | 是 | 看板 Runtime API 版本 |
| `queries` | 是 | 页面可能调用的已注册 Query ID 和参数类型 |

### 4.2 Manifest 明确不包含

- 图表类型。
- 图表位置和尺寸。
- 栅格布局。
- 组件树。
- CSS Token 和颜色配置。
- 页面状态管理方式。
- SQL、数据库 URL 或凭据。
- React 组件、Props 或内部事件。

这些内容全部由 `src/` 决定。

## 5. Runtime API

生成代码不能直接连接数据库，也不能自行持有访问令牌。它通过平台提供的 Runtime SDK 查询数据和读取运行上下文。

建议接口：

```ts
interface DashboardRuntime {
  query<T = unknown>(
    queryId: string,
    parameters?: Record<string, string | number | boolean | null>,
  ): Promise<T>;

  getContext(): Promise<DashboardContext>;

  ready(details?: { title?: string }): void;

  reportError(error: unknown): void;
}

interface DashboardContext {
  locale: string;
  timezone: string;
  theme: "light" | "dark";
  mode: "preview" | "published";
}
```

Agent 在源码中通过固定模块使用它：

```ts
import { dashboard } from "@platform/dashboard-runtime";

const rows = await dashboard.query("monthly-sales", {
  startDate: "2026-01-01",
  endDate: "2026-03-31"
});
```

SDK 底层可以使用 iframe `postMessage` 与宿主通信。宿主负责附加当前访问者身份，并将请求转发到 Data Gateway。生成代码不能获得原始数据库凭据或管理后台登录令牌。

Runtime API 是稳定边界，但不规定 Agent 如何在 `src/` 中封装和消费它。

## 6. Query 契约

Manifest 中只保存 Query ID 和参数类型。SQL 或 API 请求定义保存在 Data Gateway，不进入前端产物。

调用流程：

```text
src 代码
  → dashboard.query(queryId, parameters)
  → iframe host
  → Data Gateway
  → 权限校验
  → 已注册查询
  → 数据源
```

发布时必须确认：

- Query ID 存在。
- 当前看板被授权使用该 Query。
- 参数名称和类型匹配。
- Query 对发布场景和访问者有效。

页面中的筛选器、联动方式和数据转换逻辑仍由 `src/` 自由实现。

## 7. 构建契约

平台只规定统一命令和输出：

```bash
npm run build
```

构建成功后必须生成：

```text
dist/index.html
```

除入口和 Runtime 注入外，平台不对 Bundle 内部结构作要求。

Agent 可以在 `src/` 中使用：

- 单页或多视图结构。
- 任意组件拆分方式。
- CSS Modules、普通 CSS 或平台预装的样式方案。
- 平台预装的 ECharts、D3、Canvas 等能力。
- 自定义 SVG、图表和交互实现。

是否采用 React Router、全局状态库或其他组织方式，不进入 Artifact Contract。

## 8. 验证契约

`validate_dashboard` 只验证边界，不评价代码风格和页面实现方式。

必须验证：

1. `dashboard.manifest.json` 符合 Schema。
2. `npm run build` 成功。
3. `dist/index.html` 存在。
4. Manifest 中的 Query ID 均存在并已授权。
5. Query 参数符合定义。
6. 未使用未批准依赖。
7. 源码中没有明显硬编码密钥。
8. 页面没有声明不允许的外部网络地址。
9. Runtime API 版本受平台支持。

不应验证：

- 组件数量。
- 文件数量。
- 图表必须来自某个组件库。
- 页面必须使用固定栅格。
- CSS 类名或目录命名风格。
- Agent 是否采用平台偏好的内部架构。

静态验证不是安全边界。外部网络访问、文件权限和数据访问仍必须由 CSP、iframe、Data Gateway 和 Worker Sandbox 强制限制。

## 9. Preview 契约

预览使用当前 Draft 构建产物，并运行在隔离 iframe 中。

```text
Agent 修改 src
  → build_preview
  → 构建 dist
  → Preview URL
  → iframe 刷新
```

预览模式下：

- 使用当前编辑者的受限数据权限。
- `DashboardContext.mode` 为 `preview`。
- 构建错误和 Runtime 错误回传给 Agent。
- 管理系统展示文件 Diff、Tool 调用和构建状态，保留 Coding Agent 的可观察性。

管理系统不通过修改源码来实现预览，也不在预览后格式化或重写 `src/`。

## 10. 保存与发布

保存 Revision 时必须保留 Agent 生成的原始源码：

```text
Revision
├── dashboard.manifest.json
├── src snapshot
├── public snapshot
├── template version
└── build metadata
```

发布时：

1. 从指定 Revision 构建。
2. 执行 Manifest、Query 和安全验证。
3. 保存不可变的 `dist/` 产物。
4. 记录源码 Revision 与发布产物的对应关系。
5. 分享链接固定指向一个 Published Revision。

平台不能只保存编译后的 `dist/`。保留源码才能继续通过 Coding Agent 对话修改、查看 Diff、回滚和重新构建。

## 11. 安全边界与源码自由度

以下限制不会降低 Vibe Coding 的核心自由度：

| 限制 | 原因 |
|---|---|
| 只能修改当前看板 Workspace | 租户隔离 |
| 不允许直接访问数据库 | 凭据和数据安全 |
| 网络请求只能经过 Runtime/Data Gateway | 防止数据外泄 |
| 只能使用已批准依赖 | 构建稳定性和供应链安全 |
| 必须输出统一入口 | 便于预览和发布 |
| 必须声明 Query ID | 权限审计和运行时校验 |

这些规则只限制系统边界。`src/` 内部仍然是普通、完整、可持续重构的前端代码项目。

## 12. 生命周期

```text
draft → validated → published → archived
```

- **draft**：Coding Agent 可以持续修改 `src/` 和 Manifest。
- **validated**：指定 Revision 已通过构建和边界验证。
- **published**：生成不可变发布产物。
- **archived**：停止对外访问，但保留源码与历史版本。

验证状态属于具体 Revision。Draft 继续修改后，需要重新验证才能发布。

## 13. 第一版验收条件

使用一个示例销售数据源完成以下流程：

1. 用户通过对话要求生成销售看板。
2. Coding Agent 自由创建多个组件、样式和数据处理文件。
3. 看板通过 Runtime API 获取数据。
4. Agent 可以通过后续对话重构布局或替换图表实现。
5. `validate_dashboard` 不依赖解析组件树即可完成验证。
6. Preview iframe 正常显示并支持交互。
7. 保存 Revision 后仍能查看完整源码和 Diff。
8. 发布页面不调用 Pi，只调用 Data Gateway。
9. 分享链接固定访问已发布 Revision。
10. 管理系统从未将 `src/` 转换成低代码 DSL。

## 14. 后续设计

本契约确定后，下一步设计 Data Gateway 与 Query Contract，包括：

- Query 的注册和版本。
- 参数 Schema。
- 设计期探索查询。
- 发布期查询审核。
- 访问者权限和行级权限。
- 查询超时、行数限制和缓存。
