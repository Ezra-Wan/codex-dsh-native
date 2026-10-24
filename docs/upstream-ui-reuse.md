# 上游 UI 复用：契约研究与路线选择

对应 [TODO-HANDOFF.md](../TODO-HANDOFF.md) 优先项 2 的前半部分：先看 `ui-trajectory` / `ui-chat` 的 exports、依赖及 provider 契约；若组件必须依赖完整客户端，比较三条路并记录成本。

调研日期：2026-10-23。初版来源为 npm 发布物（本项目 `sdk` profile 已安装，与锁定版本一致）；同日已补做上游源码精读（稀疏检出 pinned commit 到 `.local/reference/dsh-upstream`），实现级结论以 [upstream-source-study.md](upstream-source-study.md) 为准，本文保持路线选择与依赖面结论。

## 版本与来源

- 锁定版本：`@deepseek-ai/dsh` / `dsh-sdk-client` `0.2.1-rc.2`；上游提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。
- 以下 UI 包全部来自 `node_modules/@deepseek-ai/`，版本均为 `0.2.1-rc.2`，`license: MIT`，package.json 的 `repository.directory` 指向上游 `packages/client/*`。
- 已知上游另有 `0.2.1-rc.3`（npm 可见）。按交接约束不自动升级；升级时按 README「跟随上游」成对核实并跑离线检查。

## 包契约（实测 node_modules，非凭 README 猜测）

| 包 | 自述 | exports | 浏览器加载方式 | inject 依赖（package.json `dsh.client.inject`） |
|---|---|---|---|---|
| `dsh-client-ui-trajectory` | 轨迹账本 + 时序概览；**pure-consumer 插件，无 service** | `.`（宿主侧 `apply(){}` 空实现）、`./client`、`./src/*`（发布物中未含 src 目录）、locale JSON | `lib/client.js` 是 `window.__ModuleLoader__.load({...})` 注册块 | api-session-controller、client-locale、**ui-conversation**、ui-renderer、ui-session |
| `dsh-client-ui-chat` | Chat 会话视图、节点定义与渲染器 | 同上结构 | 同上 | 额外需要 ui-input-trigger、ui-layout、ui-settings、api-workspace-controller 等（inject 列表更长） |
| `dsh-client-ui-conversation` | 会话装配：shell、composer、**view 环（ViewMap）**、导航 | 同上结构 | 同上 | ui-layout、ui-renderer、ui-session、ui-settings、ui-workspace、client-file-upload |
| `dsh-client-ui-session` | SessionProvider、绑定与交互 Hook；不拥有传输层 | 同上结构 | 同上 | 依赖 client remoteAccess service |

关键事实：

1. **trajectory 的浏览器入口不是普通 ESM 模块**。`lib/client.js` 首行为 `window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-client-ui-trajectory", factory: (require) => {...} })`，其内部 `require("react")`、`require("@tanstack/react-virtual")`、`require("@deepseek-ai/dsh-client-ui-primitives")` 均由客户端模块注册表提供。npm 树中**没有独立的 `react` 包**——react 打在 `dsh-client-modules` / `dsh-web-frontend` 的运行时里。
2. **trajectory 是会话视图环里的一个标签页**，不是独立组件树。其类型声明（`lib/types/client/index.d.ts`）写明："register the trajectory view tab"，`inject` 需要conversation slot、registries、Session 分页与 locale service。单独挂载它等于先搭起 conversation shell 的最小子集。
3. **数据契约与本项目同源**。trajectory README 自述为 "pure projection"：从共享 Session window 的原始事件组装业务记录，工具记录起始于持久化的 `tool/call` 事件——与 `src/trace.mjs` 从官方持久化日志读到的正是同一批事件。这意味着展示层换轨不会改变数据来源。
4. 视图能力（折叠、虚拟滚动、错误留痕、流式跟随尾部、时间概览）在上游是围绕 react + react-virtual + 会话分页实现的；这些是展示概念，不是事件契约本身。

## 三条路线比较

| | A. 官方组件 + 薄适配 | B. 原生 Web 整体嵌入 | C. 按许可移植最小展示组件 |
|---|---|---|---|
| 依赖 | 需引入客户端模块运行时（`__ModuleLoader__`、react、primitives）、conversation/session/locale 服务，以及 Session Controller 传输（本项目桥接直接持有 SDK 进程，**没有** webserver/remote.mux，需另起或模拟） | 完整 `dsh-web-frontend` + `dsh-host-webserver`；MCP Apps 卡片内 iframe/CSP/认证边界未经验证 | 无框架依赖；沿用现有卡片的 CSS 变量与事件结构 |
| 会话归属 | 归属转向客户端运行时的 Session 窗口；与桥接的任务所有权并存，需两套生命周期 | Web 实例与 SDK 运行中会话的同一性没有保证（交接已警示不能假定另开实例可控制同一会话） | 留在桥接：任务记录即 `ds_events` 游标 |
| 维护/升级 | 跟随上游最紧；每次升级需复验整条注入链 | 同左，且受宿主 CSP 变化影响 | 跟随事件契约（持久化格式版本化）与展示概念；升级成本低 |
| 与验收目标的距离 | 最小可行也要先跑通模块注册表 + 会话分页模拟，才能开始验收"窄面板/暗色/折叠" | 超出 P0 边界 | 直接进入界面验收 |

**结论（2026-10-24 验收后更新，取代下方初版）**：主展示链路 = **官方 Web 原实现的容器适配**——`ui/observer.mjs` 重写为容器卡片（iframe 承载 `scripts/native-replay.mjs` 启动的官方 Web，MCP server 启动时自动拉起，`ds_bridge` 返回 `nativeReplay.url`）；嵌入不可用时降级为任务状态面板。原路线 C（`ui/prototype/` 自写渲染）**降级为参考实现/回归样例，不在主链路**——此变更源于 2026-10-24 验收（`.local/acceptance-review-20261024/REVIEW.md`）：不应以复制令牌/图标替代组件复用。若未来需要裁剪组件路线（原生 React 组件 + 薄适配），仍需先解决模块运行时与连接栈（见下表 A 行），本文件保留当初的比较供那时参考。

## 证据与本决策的可复核性

- 包版本/exports/inject：`node_modules/@deepseek-ai/dsh-client-ui-*/package.json`（0.2.1-rc.2）。
- 模块加载方式：`dsh-client-ui-trajectory/lib/client.js` 首行；react 无独立 npm 包（`ls node_modules/react` 不存在）。
- 事件同源：`src/trace.mjs` 读 `@deepseek-ai/dsh-session-persistence-jsonl`；trajectory README "The view is a pure projection … from the shared Session window"。
- 本决策不声称"视觉一致"：对照原生界面截图的验收仍未做（交接明确要求先有真实对照再称一致）。
