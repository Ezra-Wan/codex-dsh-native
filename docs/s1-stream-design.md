# S1 原生正文流连接：设计、连接图与验证边界

2026-10-24。实现执行单 S1/S2（TODO-HANDOFF 文首）。基线之上的分支：`feat/sdk-web-profile`（adapter/profile/bridge）、S2 卡片绑定、契约测试。

## 为什么独立 replay 进程不能完成这条链路

瞬态 assistant-stream 帧（start/chunk/end）是**执行进程内**的 cordis 事件（`agent/assistant-stream`），由同进程的 session-controller 折叠进 Web `follow` 推送流（`docs/upstream-source-study.md`）。`scripts/native-replay.mjs` 起的是**另一个进程**：它读同一 DSH_HOME 的持久化日志，durable 事件提交后可见，但执行进程内存中的在途 chunk 永远不会到达它。SDK stdio 协议也不转发流帧（通知面只有 `session.event`/`session.status`，协议边界，同文档）。因此"日志事件及时唤醒"与"replay 页面"都不构成正文流。

## 所选方案：执行进程自身成为官方 UI 宿主（sdk-web profile）

每个 web-embed 任务的执行进程以 **sdk-web profile** 启动：`dsh-base + dsh-sdk-app + dsh-web-app` 三个官方 bundle 叠加（同版本 0.2.1-rc.2，无 fork）。该进程同时是：

- SDK stdio JSON-RPC 服务端（bridge 照旧驱动 prompt/wait/…）；
- 官方 Web 宿主（webserver/gateway/connection/frontend/session-controller 全官方插件）。

**连接图**：

```
Codex 卡片 iframe ──HTTP──▶ 执行进程的官方 Web 栈（本任务专属端口 8801+）
   ▲                            │ follow 推送流（含 cursorless 瞬态帧）
   │ nativeUrl（带 token）        ▼
桥（bridge.mjs）◀──文件── @codex-dsh/web-embed（进程内薄插件，bridge 自有）
   │ URL 落盘 .local/task-urls/<port>.json（token 进程内生成，唯一外部出口）
   └─ ds_start/webEmbed → sdk-web profile + 每任务 --patch overlay（端口+urlFile）
```

瞬态流从执行进程的 agent 事件直达同进程 session-controller 的 follow 流，官方 UI 消费——**正文渲染完全由官方实现承担**，桥不重写任何聊天 DOM，不改模型循环。

## 相对另一条路径的改动面

另一条路是给 SDK stdio 协议加流转发（改 `dsh-sdk-protocol`/`dsh-sdk-client` 或 fork）——违背"固定版本、不 fork 上游"，且协议变更影响面大。本方案改动面：一个 ~40 行自有插件 + profile 组合文件 + 桥的端口/URL 记录 + 卡片按任务换 iframe 源；上游包零修改。

## 关键实测/源码证据

- `dsh-sdk-protocol` `JsonRpcLineTransport.handleLine`：非 JSON 行 `catch { return }` 静默丢弃——进程向 stdout 打印不破坏 SDK 协议，但也拿不到（故用文件通道）。
- `dsh-client-connection`：launch token 是进程内存量（`PROCESS_LAUNCH_TOKENS`），唯一外部出口是 `authenticatedUrl()`；`@codex-dsh/web-embed` 在进程内调用它并落盘。
- `dsh-host-webserver`：`host/port` 可配（patch override 整段 config，字面量覆盖 `!!js` 表达式）；`dsh-web-app`：`openBrowser/printUrl` 可关（profile 层已关，防 stdout 打印）。

## 验证边界（如实）

**离线已证明**（当前代码基线 `c9ed37b`，57/57 测试）：
- 官方折叠契约（`test/official-stream-contract.test.mjs`，对逐字复制的上游实现）：多次瞬态依次可见且有序；成功结算 publish+窗口替换；中断立即退役；重连 baseline 重建在途并续流；双 lane 隔离。
- 桥接线：sdk-web profile 透传、每任务 overlay（端口/插件/urlFile）、URL 采集与 release 清理、webEmbed:false 原样。
- 卡片绑定（fake host + DOM 执行真实模块）：默认挂所选任务专属 URL、切换换源、无任务 URL 回落全局回放。
- 插件通过真实 Cordis 同级服务 provider 组合加载；桥摘要显式 null 撤销经真实 ds_wait 路径到达卡片并清缓存；A/B 往返不复活旧 URL；冷续接重新挂载新世代；任务选项节点实际存在。
- 显式 null 的任务视图保持等待，不展示全局其他会话；没有任务 URL 状态的旧回放链路保留。
- release 停止并等待 URL 读取器，避免旧世代在撤销后回写；世代测试在运行时启动清理完成后模拟插件写 URL。
- 自动弹页覆盖命中官方 `web-runtime` 条目（不是插件名 `web-app`）；每任务 overlay 也强制关闭 openBrowser/printUrl。上游补丁合成器、配置 schema、运行时胶水验证均为纯离线，没有调用浏览器打开回调。

**未证明（需 S3 实验窗口，逐项最小验证）**：
1. **sdk+web 同进程组合的实跑**：三个 bundle 叠加后插件挂载序列无冲突、SDK stdio 握手正常、webserver 按端口监听——离线无法证明，窗口首验（一次 read-only 最小任务即可，不写文件）。
2. **真实瞬态流端到端**：长回复生成中官方 UI 正文多次增长（S3 定义：同一回答结束前 ≥2 次可见增长 + 完成结算时序）。
3. 宿主 iframe 承载任务级 URL（loopback + token）在 Codex 卡片内的实际表现。
4. A/B 并行双进程各自端口/流的实测隔离。
5. 任务级 DSH_HOME 仅隔离持久会话范围：官方界面是否实际选中目标根会话、收起再展开与真实重连仍未证明。未选中则继续实现接收方选择契约。

**已知风险**（如实记录，非阻断）：同进程叠加 web 栈后其他宿主插件的理论 console 输出会进入 stdout（协议层静默丢弃，不炸但不可见）；每任务进程内存/启动时间增加（web 栈常驻）。

## 与约束的关系

本次完成返修只进行了构建与离线测试，测试的临时 stdio MCP 进程禁用自动 Web 启动；未启动展示服务、未重载现有 MCP、未触发真实模型调用。接手时 8801 已有 sdk-web 进程，未终止或重载它。现有 profile 文件及在跑进程也未被本次配置修复热更新：未来任务由修正后的每任务 overlay 关闭自动弹页，init 脚本再次刷新 profile 时会更新正确覆盖。

S3 准备仍需核实系统端口占用、任务 home 的官方配置/凭据来源及调用预算；8801+ 只是本进程内递增分配，不等于系统范围端口已预留。不能把既有 home/profile 目录存在视为实验环境全部就绪。插件 `.error` 标记目前也未被桥消费，诊断仍会退化为 URL 采集超时。
