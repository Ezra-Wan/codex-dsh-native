# 下一模型交接：Codex 内可观察的原生 DSH 协作

更新：2026-10-24（二次），Asia/Shanghai。**主展示链路已按验收方向重构**：observer 卡片改为官方 Web 原实现的容器适配层（iframe + 降级面板；MCP server 启动自动拉起 native-replay，`ds_bridge` 返回 `nativeReplay.url`；布局决策只认 nativeReplay 字段，两种到达顺序不互相隐藏）。验收四缺陷已修 + 回归测试 `test/review-regression.test.mjs`（fixture 已入库 `test/fixtures/`，跨机器可复现）；外部活动保护以 `lastSelfWriteAt` 区分自身写入；`ds_start(backend:'worker')` 显式分流至保留的 deepseek_worker。**`ui/prototype/` 参考实现已整体归档**（chore/retire-prototype，历史在 git），共享资产 `ui/theme.css` 保留。Git 工作流规则落档 `docs/git-workflow.md` + commit-msg 钩子（`git config core.hooksPath .githooks`）。**重要实测发现：ZCode 内嵌浏览器本身就是 MCP Apps 宿主**——宿主能力不再是假设，iframe 嵌入待新 server 重载后实测。

## 目标与工作边界

- 仅在 `D:\@harness\codex-dsh-native-p0` 继续。它是新的独立项目，不回到旧 bridge 堆功能；不修改 `E:\#GMF-Conformer`。
- Codex 与 DeepSeek 分别保留自己的原生 harness、工作区、持久会话和压缩能力；不把 DS 降为一次模型 API 调用。
- 串行任务在同一 Codex 对话流里可观察；并行任务由用户选择在侧边展开，Codex 可同时做独立工作。
- 优先复用官方 DSH 的界面组件与交互，尽量跟随上游，不自行扩建完整多 agent 管理器。
- 用户授权的是继续这一桥接项目，不是修改 Codex 内部程序、旧 DSH 环境或凭据。使用 `dsh_native_p0` 的 `ds_*` 工具；旧 `deepseek_worker` 的 review/callback 流程不属于本项目。

## 已验事实

- [x] 官方 DSH/SDK `0.2.1-rc.2`，完整 `sdk` profile；异步派发、同 ID 会话恢复、独立停止、两个并行运行时。
- [x] 13 项离线检查通过，包含真实 MCP stdio 协议测试。之后本轮仅做真实小测试和文档交接，没有修改实现。
- [x] 用户内置重启后已加载新版 8 个工具。
- [x] 用户确认 `ds_observe` 的执行卡片可在当前 Codex 对话中展开读写记录。
- [x] 本轮两个真实 DSH 会话并行，原生 turn 时间重叠 **8526 ms**。A 用 8526 ms，B 用 9117 ms，各 3 次工具调用，均无工具错误。
- [x] A 的结果 `{lane:'A',sum:42,max:21}`，B 的结果 `{lane:'B',sum:29,max:16}`；父任务独立核对，两边输入未修改且只新增预期结果文件。
- [x] 用户确认 A/B 可切换，但**仍在对话卡片里**。这不能算“侧边展开”通过；也不能据此断言手动 thread entrypoint 一定不支持。
- [ ] 自动刷新、停止/续接按钮的实际界面交互仍未验收。

本轮证据：`.local/parallel-ui-1792665252121/review/acceptance.json`。
会话 A：`32e16b97-f10d-4a96-99a4-15eb79f5296d`；会话 B：`3cf73a7e-720b-486b-a8a9-c644ac3d7774`。结果均已收取、验收，没有未收取的付费任务。
单卡片证据：`.local/ui-check-1792664983899/review/acceptance.json`。
早期失败样本：`.local/demo-1792663550562/review/native-actions.json`；有真实 Windows shell 沙箱 `SetNamedSecurityInfoW failed (Win32 5)`，后续 DS 回读文件成功。该 shell 问题未修复，本轮文件工具测试没有重测它。

## 当前是刷新，不是原生流式 UI

| 层 | 当前实现 | 差距 |
|---|---|---|
| DSH → 后端 | `src/runtime.mjs` 使用官方 `subscribeSessionTree` 订阅并等待原生会话 | 当前消费主要是根会话 `session.event`；没有把原生 assistant stream 帧送到界面 |
| 后端 → 卡片 | `ui/observer.mjs` 每 2000 ms 调用 `ds_wait(timeoutMs:0)` 与带游标的 `ds_events` | 是增量轮询，不是推送；隐藏页面暂停自动读，结束后停止 |
| 展示内容 | `src/trace.mjs` 只投影工具调用/结果、可见消息、回合边界 | 没有逐段文字、工具输出流、原生子会话展开；文本每条最多 8000 字符 |
| 记录来源 | `ds_events` 从 DSH 官方持久化日志读取 | 已提交记录不能替代尚未提交的流式片段 |

轮询和阅读本地日志本身不调用模型；这不等于模型整个任务免费，也不代表把大量日志回传给 Codex 没有上下文成本。

## 上游材料：先读这些，避免重新大范围调研

参考版本固定在 DSH `0.2.1-rc.2`，上游源码参考提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。
官方仓库：<https://github.com/deepseek-ai/deepseek-harness>。
已有只读参考片段在 `D:\@harness\codex-deepseek-bridge-connection-fix\.local\research-20261022\dsh`，**只是部分下载文件，不是完整源码检出**。若缺文件，在本项目独立的参考目录获取对应版本；不要在旧工程内开发。

| 上游路径 | 已确认的用途 |
|---|---|
| `packages/client/ui-chat` | 原生聊天布局；`ChatView.tsx` 依赖会话、会话投影、滚动与 slots，不能视为独立 HTML |
| `packages/client/ui-trajectory` | 原生执行轨迹与时序视图，声明为 pure-consumer plugin；适合作为优先评估的最小复用切入点 |
| `packages/client/ui-conversation` | 会话视图注册和组合 |
| `packages/client/ui-session/README.md` | SessionProvider、绑定、状态和交互适配 |
| `packages/client/connection/README.md` | 原生 Web 的 Remote/RPC、事件流、重连、WebSocket `/api/remote.mux` 与认证边界 |
| `packages/api/session-controller/src/assistant-stream.ts` | 原生 assistant stream 的 start/chunk/end、attempt/revision 和重连基线 |

三个 UI 包的 package.json 均标注 MIT；根许可也已核对：<https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/LICENSE>。复用源代码时保留版权和许可文本，并记录来源与提交。当前只读了源码，没有对原生 UI 做截图或视觉一致性验收。

## 优先 TODO：逐项交付，勿同时扩大架构

### 1. 真正验证可选侧边展开

- [ ] 首先检查 Codex 中用户手动打开 `DS 并行任务` thread entrypoint 的路径，和模型调用 `ds_panel` 的效果分别记录。当前只验证了后者，结果是 inline。
- [ ] 核对宿主 capabilities 与官方 `openai/ui` entrypoint/display-mode 规则；不把 fullscreen、内容标签页、Codex 内建子代理侧栏当成同一种能力。
- [ ] 有可用宿主入口就使用；若当前宿主不提供要求的位置，明确写出限制，不靠“工具成功返回”声称完成，不访问私有控制端点绕过。
- [ ] 默认选中活动任务，按需刷新任务列表；当前列表来自全部本机桥接任务，未按聊天隔离，且默认可能选到旧任务。补聊天归属/显式任务范围设计，避免 A/B 与其他聊天串记录。
- 验收：用户能在同一 Codex 页面按需展开/关闭面板、切换 A/B，主对话保持可用；留实际界面证据。

### 2. 复用原生视觉与交互：先做最小组件验证

- [x] 获取对应版本完整源码，先看 `ui-trajectory` / `ui-chat` 的 exports、依赖及 provider 契约，优先直接复用组件，保留升级路径。（2026-10-23：以 node_modules 内 0.2.1-rc.2 发布物为来源——exports 声明 `./src/*` 但 src 未随包发布；浏览器入口 `lib/client.js` 是 `window.__ModuleLoader__` 注册块，react 非独立 npm 包。结论：`docs/upstream-ui-reuse.md`。同日已稀疏检出上游源码到 `.local/reference/dsh-upstream`（pinned `687f282e`）并精读 trajectory/session-controller 实现，见 `docs/upstream-source-study.md`）
- [x] 用已有真实记录做离线适配原型，先显示一段“读 → 写 → 校验失败 → 恢复”的轨迹，验证窄面板、暗色、折叠、错误、长结果和自动滚动。（2026-10-23：`ui/prototype/`，`npm run prototype` 后访问 127.0.0.1:8791；真实 fixture 由生产 `readNativeEvents` 提取（demo 会话含 pwsh 失败+读回恢复，ui-check 会话读→写→校验通过），另有标注合成的长结果压力样本。截图证据 `.local/prototype-evidence-20261023/`，验收记录 `review/acceptance.json`，测试 18/18）
- [x] 外观按 DSH 真实设计重做（2026-10-23 应用户要求）：设计令牌取自 `dsh-client-ui-theme`（403 个 `--dsw` 变量，亮/暗两套），组件几何取自上游 `TrajectoryCell/TurnHeader.module.css`；用户/上下文/技能/回复/工具/异常彩色标签。仅保留必要控件，删全部开发提示；主题跟随系统。
- [x] 版式改为无界对话形式（2026-10-23 用户反馈：偏好对话视图而非轨迹卡片，附原生亮/暗截图）：渲染层按 `ui-chat` 源码重做——用户右气泡（`MessageItem` bubble 规格）、过程行发丝线分隔无卡片（`TurnProcessNodeView`）、回合折叠为「已完成，用时 N」状态行、助手文本自由流式。
- [x] 过程组与 markdown 对齐（2026-10-23 用户并排对比二次反馈）：过程行之间**无**分割线（此前根据 `TurnProcessNodeView` 的 border-bottom 误判为每行有线——该组件实际只渲染回合状态行）；组头按 `ChatGroupSeat` 实现（活动图标悬停/展开交换为箭头、`processTitle` 文案合成「已读取文件，已写入文件，执行了命令等」）；成员行使用上游真实图标（SVG 路径逐字复制自 primitives）；助手回复改用**同一 mdast 引擎**渲染（devDeps + `scripts/build-prototype.mjs` 打包为 `markdown.bundle.mjs`），样式整份复制 `MarkdownText.module.css`（`ui/prototype/markdown.css`）。证据截图 15。
- [ ] **版本对齐待办**：用户本机原生 App 实测 `dsh --version` = `0.2.0-rc.2`，本项目运行时与外观参考 pin 在 `0.2.1-rc.2`（上游另有 rc.3）。按交接规则不自动升级；成对升级时需同时核对外观参考版本——用户的验收截图出自 0.2.0-rc.2，像素级对照应以该版本复核。
- [x] **原生本体回放适配器已验证**（2026-10-23，应用户"copy+适配器"要求）：`npm run native-replay`（`scripts/native-replay.mjs`）用官方 `dsh --profile web`（0.2.0-rc.2）+ 本项目隔离 `.local/dsh-home` 启动原生 Web，bridge SDK（0.2.1-rc.2）写的会话被官方 UI 完整渲染（会话列表/对话/轨迹时间线，证据截图 19-21）。实测 0.2.0-rc.2 读 0.2.1-rc.2 会话格式兼容。零模型调用、不触碰旧环境。**这同时是 TODO 1 侧边面板的 Route B 候选**（iframe 嵌带 token 的本地 URL），宿主 CSP/iframe 能力待实测；原型（`ui/prototype/`）保留用于无进程依赖的卡片内嵌场景。
- [x] 外观层改为**逐字复制上游**（2026-10-23 用户确认可直接复制，MIT）：`theme.css` 由 `scripts/extract-theme.mjs` 从主题包提取整套令牌（statics 268 / 亮 113 / 暗 113），标题栏与「对话/轨迹」视图签按 `ConversationRoot.module.css` 复制（76px 头、13px/16px 签、品牌蓝活动条），对话内容字号对齐上游 `--dsh-content-font-size`（14px/22px，实测已一致），轨迹签恢复卡片账本（`ledger-view.mjs`，TrajectoryCell 几何）。证据截图 12-14。**后续 `ds_observe` 卡片沿用：无界对话版式 + theme.css 令牌 + 标题栏双签结构。**
- [ ] 对照原生界面截图/实际操作后再称为视觉一致。不能只换 CSS 或做打字动画就声称原生能力一致。（令牌与几何已是上游原值，仍无与原生界面的并排对照截图）
- [x] 若组件必须依赖完整客户端，简短比较三条路：官方组件+薄适配；原生 Web 整体嵌入；按许可移植最小展示组件。记录依赖、维护与会话归属成本，再选最小可行方案。（2026-10-23：P0 选 C 并记录 A/B 的推迟理由，见 `docs/upstream-ui-reuse.md`）
- 整体嵌入原生 Web 需处理连接、认证、iframe/CSP、工作区与运行时归属；不能假定另开 Web 实例就能控制 SDK 正在运行的同一个会话。不要把凭据放入 UI 工具结果或持久化页面。
- 验收：复用来源可追踪、没有重写模型循环、真实记录显示完整、Codex 内实际可见。（前三项 2026-10-23 已满足：NOTICE.md 记录来源、只消费 ds_events 同源可见事件、离线回放完整显示；最后一项待把原型接入 `ds_observe` 卡片后在宿主内验收）

### 3. 将显示链路改为真实事件流

- [x] 先核对所固定 SDK 的通知契约：assistant stream 是否暴露、属于何种通知、能否恢复；从官方类型/实现验证，不能根据名称猜接口。（2026-10-23 源码验证：SDK stdio 协议通知只有 `session.event`/`session.status`，流帧只在运行时进程内的 `agent/assistant-stream` cordis 事件与 session-controller 的 `follow` 推送流（含 cursorless assistant-stream 帧 + 重连 baseline + settlement 语义）中存在。结论与依据见 `docs/upstream-source-study.md`——要做真推送只能引入连接栈（路线 A 工程量），否则持久化事件有界拉取是唯一降级。npm 已出现 `0.2.1-rc.3`，仍锁 rc.2，升级需成对核实）
- [ ] 后端保留原生事件身份、session/turn/seq 与必要 attempt/revision；显示端消费可见文字与工具生命周期。过滤推理内容、请求头和凭据；不要原样转发 provider 原始数据。
- [ ] 在当前 MCP Apps 宿主实际支持的范围里选择推送方式。若宿主只支持拉取，评估事件到达即返回的有界长轮询作为降级，并明确仍非推送；不要只把 2 秒改成 100 ms。
- [ ] 持久日志用于断线补读；处理丢帧、重复、重连、结束与最后一批结果的竞态、多个卡片订阅释放和背压。
- [ ] 不让流式观察额外调用 DS 或 Codex；长日志只在展开时读取，避免把完整历史塞回父模型。
- 验收：长回复结束前就有可见片段，工具起止及时显示，断线恢复不丢不重；记录实际延迟。只出现完成后的整段消息不算通过。

### 4. 后续必要项，暂不抢占前面三项

- [ ] 界面停止/续接与会话隔离验收；停止当前是关闭该会话专属 SDK 进程，不是暂停，不回滚文件。
- [ ] 原生派生子会话、手动压缩与人工交互的映射；当前只观察根会话。
- [ ] 单独修复/定位 Windows shell 沙箱异常，不能靠关闭沙箱掩盖。
- [ ] OPS 等插件在新独立 profile 中逐项验证；旧 Web 装过不代表新 profile 已有。KV cache 命中以 usage 为准，会话复用不保证命中。
- [ ] 升级 DSH 与 SDK 时成对核实版本并跑兼容性检查；不要启动时自动升级或替换原生 history。

## 成本与接手步骤

本轮只新增两个 light 任务，每请求输出上限 2048；总计 8 次已提交模型回复，usage 为 inputTokens 3668、cacheReadTokens 53888、outputTokens 769、totalTokens 58325。这些是原生返回字段，不能当作未缓存输入量或完整账单；不含压缩、失败尝试、后代会话。

接手时先读本文件，然后按所选 TODO 读取最少必要源码。用现有真实记录做回放，优先离线协议和界面验证；有具体新行为待验证时再做一次小额真实调用。避免反复启动相同任务证明已通过的功能。

**Git 流程（2026-10-23 起）**：`main` 为稳定分支（基线 tag `v0.1.1-baseline`）；每项工作开 `feature/<主题>` 或 `docs/<主题>` 分支，提交用 `type: 中文主题`，自审 diff 后 `--no-ff` 合回 `main`，合并后删除特性分支。界面证据放 `.local/<主题>-<时间戳>/review/`。历史：`3b6a1c1` 基线 → `5a96bc6` 契约研究 → `0af4f16` 轨迹原型 → 交接文档更新。

项目入口：`src/server.mjs`；运行时：`src/runtime.mjs`；状态：`src/bridge.mjs`；投影：`src/trace.mjs`；界面：`ui/observer.mjs` / `ui/observer.html`。`npm test` 会先构建 UI。更新服务代码后使用 Codex 的 MCP 重载；已加载进程不会自动采用新源码。

当前派发开关已开启，无未收取任务。`.local` 与 `dist` 被 git 忽略；交接若跨机器，显式复制需要的脱敏测试证据，不复制凭据。项目仍处于未提交的初始工作区，不要假定 git HEAD 包含这些文件。

官方界面规范：<https://github.com/openai/mcp-extensions/blob/main/docs/spec.md>；此前已核对，但新实现前仍应按实际宿主能力验收。
