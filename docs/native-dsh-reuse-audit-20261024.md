# 原生 DSH 在 Codex 内承载：现成实现与复用审计

日期：2026-10-24。性质：源码和发布资产审计，不是第三方产品安装或宿主实测。

## 产品要求与结论

用户要的是：在 Codex 内按需呈现真正的 DSH 原生视图，并保留所选执行环境中的查看细节和操作能力。并行独立任务、DSH 原生子 agent 均须保留；对话流内和侧边只是承载位置与使用体验，不能倒过来用布局完成代替能力完成。

找到直接竞品，不能再把“其他 harness 在 Codex 中运行”当成没有人做过的方向。**CodexHost 与 Harness Mix 已有相关实现；但已核对的 DSH 适配都是把原生事件投影成 Codex 展示项，不等于把 DSH 原版界面及任意插件界面完整搬进 Codex。**

针对严格的原版 DSH 要求，更合适的现成资产是三部分：官方前端与传输扩展点、DSH-for-Vscode 的原生 UI 导航接收端、dsh-mcp-apps 的视图生命周期处理。仍须组合适配并在本机 Codex 中验收；没有找到已经证明本需求全部成立的即装即用项目。

## 直接竞品：值得优先对照，不能按 README 宣布同等能力

### CodexHost

- 仓库：[BytePioneer-AI/codex-host](https://github.com/BytePioneer-AI/codex-host)，审计提交 `82e4839808ae692ac5cd0c23339c3db8e7a043c9`。
- `packages/adapters/deepseek-harness/src/modern/session.ts` 的 `#projectAssistantChunk` 将原生正文、思考映射成 Host 展示项；`src/projection.ts` 将工具结果转为 HostToolOutput，并按 limit 截断。它执行真正的 DSH，会话与上下文可以由 DSH 所有，但展示采用 Codex 侧数据模型。
- [版本验证记录](https://github.com/BytePioneer-AI/codex-host/blob/82e4839808ae692ac5cd0c23339c3db8e7a043c9/docs/harnesses/deepseek/dsh-version-validation.md)明确列出本项目所用 `0.2.1-rc.2` 及相同 upstream commit；这是作者的验证记录，本轮没有复跑其 CLI 或 Desktop 实验。
- `packages/desktop-control/src/renderer-cdp-control-session.ts` 实际使用 `Runtime.evaluate`、`Page.addScriptToEvaluateOnNewDocument` 扩展桌面渲染层；并非普通 MCP 工具注册即可获得其全部宿主能力。与本项目既有“不改 Codex 私有宿主来绕过”的边界分开评估，不能暗中切换路线。
- 值得借鉴：版本化 DSH 协议、原生压缩/修订/恢复语义、流和工具投影、独立会话协作。没有据此证明 OPS 或余额插件原生 UI 等价。
- 当前 checkout 根 `package.json` 标注 `LGPL-3.0-only`；不能因为 Harness Mix NOTICE 提及早期 MIT 版本，就把当前代码按早期许可直接复制。

### Harness Mix

- 仓库：[emo-xiaoyu/harness-mix](https://github.com/emo-xiaoyu/harness-mix)，审计提交 `b3e4b54d6a3a5043875b38cc39005bee7d2f1c85`。
- [dsh.js](https://github.com/emo-xiaoyu/harness-mix/blob/b3e4b54d6a3a5043875b38cc39005bee7d2f1c85/src/main/adapters/dsh.js)的 `projectWireEvent` 映射正文、思考和工具；`MAX_TOOL_TEXT = 24_000`。因此不是无损的 DSH 原版查看器。
- `dsh-web-host.js` 对接原生 Web Remote、认证和 multiplex；`dsh-subagents.js` 调用原生 `subagents/list`、对应子会话的 `session/follow`，不是把第二次普通调用重命名为子 agent。这部分是有价值的身份与父子关系参考。
- `src/native-ui/desktop-control/src/renderer-cdp-control-session.ts` 同样通过 CDP 注入渲染层。不能把其侧边/子会话体验视作普通 MCP Apps 在当前 Codex 必然拥有的能力。
- README/NOTICE 中出现的旧 DSH 版本不能直接作为本项目 `0.2.1-rc.2` 兼容证明；采用前逐项核对运行分支。

**采用判断**：如果产品接受统一使用 Codex 的展示和操作模型，这两项应先进入隔离对照实验，避免再造完整调度器。如果要求 DSH 原版组件及选定插件功能，这两项可以提供执行/会话层参考，不能直接判为替代完成。

## 最贴近原版界面复用的实现

### DSH-for-Vscode：真的嵌原版前端，并有原生 UI 导航接收端

- 仓库：[k2124732496-lab/DSH-for-Vscode](https://github.com/k2124732496-lab/DSH-for-Vscode)，源码提交 `b27a67e7a7498d1fea5ee0975c056aee96c8dc26`，源码包版本 `0.1.9`。
- `src/sidebar.ts` 是原版页面的 iframe 容器，加少量状态、错误和工具栏，没有重写 DSH 聊天界面。
- **发布版与 main 不一致**：本轮另外从官方 Marketplace 下载 [KAZUHA.dsh-for-vscode](https://marketplace.visualstudio.com/items?itemName=KAZUHA.dsh-for-vscode) 的 `0.2.0` VSIX，只读解包，没有安装或执行。其接收端 API 已变化，不能照抄 main 的旧接口。
- 发布资产 `extension/dsh/workspace-sync-client.js` 注册真正的 DSH 客户端模块，注入 `workspaces/sessions/uiWorkspace`，等待列表 ready，调用 `ctx.uiWorkspace.connectWorkspace(workspace.workspaceId)`，然后 `ctx.uiWorkspace.openSession(sessionId)`。异步之后重新检查目标，防止旧目标覆盖新目标。
- 这给出我们缺少的**接收方真实导航实现**。但该插件按工作区匹配并可能创建会话；本项目必须改为定位已经派发的精确 `session_id`，不能直接复制其创建逻辑，否则同工作区 A/B 仍可能错选或多造会话。
- 发布版还带 Cookie 与 WebSocket 代理网关；它依旧依赖浏览器访问 localhost，**不能解决本机 Codex 已实测的本地网络访问拦截**。可参考认证处理，不能拿其 VS Code 成功推导 Codex iframe 成功。
- VSIX：55,210 bytes，SHA-256 `B0E4C91D02CDB92B7C2F2AEC008C10C259E1D9562E3F0FA8A3806A6D2E16BE92`。本地只读副本位于 `.local/research-native-embed-20261024/`。复制前应取得对应版本源码并保留来源与许可记录。

### 官方 DSH：已有面向外壳的传输扩展，不应继续另造完整协议

- 固定上游：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317)，即本项目 `0.2.1-rc.2`。
- 官方客户端 `ClientTransportHooks` 提供 `rpc/fetch/openStream/loadBundle` 等外壳接缝；本项目已经用 `__DSH_TRANSPORT__` 做出了用户确认可读历史正文的零模型探针。它是继续推进原版 UI 的已有基础。
- [experimental/webworker-runtime/src/client/client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/webworker-runtime/src/client/client.ts)已有 `WorkerTunnel`：普通请求、响应流、双向逻辑流、取消、bundle 加载，以及远端错误和承载故障的区分。`transport/frames.ts`、`transport/tunnel.ts` 与相应测试也可参考。优先拆取这些协议处理或依其契约扩展现有载体，不要只做文本队列和状态轮询。
- **不能整包盲拷**：worker 服务端有“页面拥有 worker”下的直接 API/权限处理假设。Codex widget 连接外部执行进程不具有同等所有权，不能设置 `ownsHost` 或绕过拒绝来假装本地完整权限。
- 原版 `ui-conversation/ui-layout/ui-renderer/ui-session/ui-slots` 提供组件组合与 slots。按需显示原生部分视图应从这些模块接缝选取；本轮仅确认存在，不声称已经完成可单独挂载的会话视图。

### dsh-mcp-apps：已有切换承载位置而不重建视图的代码

- 仓库：[openma-ai/dsh-mcp-apps](https://github.com/openma-ai/dsh-mcp-apps)，审计提交 `320bfb575579e2feacf8d9274120cea6210e743f`。
- `packages/web/src/client/McpAppView.tsx` 使用真实 AppBridge、PostMessageTransport，固定 iframe/bridge 引用，改变 display mode 和 host context。对应测试验证切换不 remount。
- 它的宿主是 **DSH**；fullscreen 在其自有 CSS 中作为侧边面板呈现。可以复用生命周期和协议思路，**不能把这段 CSS 放进 Codex iframe 就控制 Codex 外层侧边栏**。本机 Codex 支持的显示模式与是否保留视图仍需实际验收。

## 已排除为核心替代的相近项目

| 项目与审计提交 | 实际作用 | 未满足的核心点 |
| --- | --- | --- |
| [CLI-Subagents](https://github.com/lunati228/CLI-Subagents)，`5855915d9c1164804cfe2095738f280c7b5f2b0e` | 原生 CLI 任务与 Codex relay agent；模板实际配置 GPT relay | 未提供 DSH runtime 或原版 DSH UI；不是纯协议零额外模型中继 |
| [deepseek-harness-for-codex](https://github.com/Seann0824/deepseek-harness-for-codex)，`12174fcf17bfd760509340b9e34418c7c1213e3f` | 真 DSH 任务与外部 Web 链接 | 已查生产源码没有 MCP HTML UI resource；返回服务根 URL 不等于精确会话选中 |
| [dsh-chatgpt-bridge](https://github.com/jiezeng2004-design/dsh-chatgpt-bridge)，`b78a575e886de1644db5273df88907bd2f2163fa` | ChatGPT 经 MCP 操作 DSH 任务、goal 和审批 | 已查源码是工具控制平面，未发现原版 UI 承载资源 |

## 下一次实现应直接使用的组合

1. **原版前端与执行环境对齐**：使用任务正在运行的 runtime/profile，保留官方组件、模块、样式和所选插件。先固定版本，避免只读取另一份回放环境。
2. **传输采用 MCP 载体**：沿用已显示历史正文的探针，参照官方 tunnel 补齐真正使用到的双向流、取消、重连、动态资源与错误传播；浏览器不直接访问 loopback。端点能力按所选 profile 的功能逐项提供，不能长期沿用只读探针白名单又宣称功能等价。
3. **接收端定位真实会话**：参照 VS Code 发布版的官方客户端注入方式，输入精确根会话身份；区分并行根任务与原生子会话。A/B 共用 cwd 也必须选对。导航异步结果需要过期保护。
4. **按需挂载原生视图**：先让选定会话和子会话原生详情可用，再做原生模块的范围裁剪；复用稳定视图生命周期，验证内联/侧边往返不重连、不丢位置、不抽动。不要为控制布局重写聊天 DOM。
5. **功能等价按范围验收**：正文结束前持续增长、工具输入输出、审批/提问、停止/续接、压缩、并行隔离与子 agent、选定版本 OPS，以及只在侧边展开时显示的余额。OPS 的执行能力不得依赖视图展开。文件选择/附件/终端/预览等若纳入范围，各自验证真实端点、资源与权限；未支持项明确列出，不能用欢迎页或纯历史正文代表全部可用。

当前只证明本项目探针能在 Codex 显示原版历史正文；并未证明上述运行时功能。本轮没有安装这些第三方产品、执行其安装脚本、启动展示服务、重载 MCP、调用模型或改动两个 Codex 实例。没有新增测试通过数；源码审计也不计为宿主验收。
