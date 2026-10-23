# 上游源码精读笔记（DSH @ 687f282e）

2026-10-23。应用户要求补做：不再停留于 npm 发布物的 README/类型，直接翻上游仓库源码。参考检出在 `.local/reference/dsh-upstream`（稀疏检出，pinned commit `687f282e8625c6b8d11ff58211a90524be2e4317`，git 忽略），另读了旧工程遗留片段中的 `packages/api/session-controller/src/*`（同一提交的文件）。本笔记只记录**从源码验证过**的事实。

## 一、TODO 3 先决问题：assistant 流的契约（源码验证）

问题：assistant stream 是否暴露、属于何种通知、能否恢复？

1. **流帧的本体**：`dsh-agent` 定义 `AssistantStreamFrame`（`runtime-types.d.ts`）：`start` / `chunk` / `end`，携带 `attemptId`、`revision`（Agent 生命周期内单调，重试从 1 重启）、`turn`、`step`，chunk 另有密集零基 `index` 与 `time`。它是**进程内**事件：cordis 事件名 `agent/assistant-stream`，发布于运行时子进程内。
2. **SDK 协议不转发它**：`dsh-sdk-protocol` 的通知映射只有 `'session.event'` 与 `'session.status'`；`dsh-sdk-client` 的 `subscribeSessionTree` 返回的也是这两种通知。**在当前桥接的传输层（SDK stdio）里拿不到逐段流帧**——这不是实现疏漏，是协议边界。
3. **对 Web 客户端的暴露**：`dsh-api-session-controller` 的 `follow` 是 `mode: 'stream'` 的 Remote：*"a complete opening snapshot followed by gap-free durable event frames and optional cursorless assistant-stream frames"*。即：开场快照 + 无间隙持久事件帧 + **无游标的 assistant-stream 帧**。
4. **瞬态与结算**：客户端契约定义 `assistant/live-chunk` 事件——"`seq` orders the transient row between durable Session seqs"但"admitted outside durable cursor algebra"，即**只用于展示、不入持久化、不占游标代数**。durable `assistant/message` 到达时通过 `settle-assistant` 变更**原子地取代同 attempt 的全部瞬态行**；被打断/失败/放弃的 attempt 立即退役瞬态行（`ClientAssistantStream` 折叠器：`publish` / `settlement` / `abandonment` / `transient` / `rebaseline`）。
5. **断线恢复**：会话控制器内的 `SessionAssistantStreamAccumulator` 为每个已接受 revision 物化一个**重连 baseline**（`revision`、活跃 `attemptId`、`startedAfterSeq`、`nextIndex`、累积流快照）；重连方用 `replace(entries, baseline)` 重建在途段落。revision 不连续即丢弃重建——帧丢失不做缝补。

**对 TODO 3 的结论**：在"跟随上游、不扩架构"的约束下，显示链路有两条真实选项——(a) 引入 session-controller 的连接栈（`dsh-client-connection`/网关）获取 `follow` 推送流，这属于路线 A 的工程量；(b) 维持持久化事件的有界拉取作为降级（交接已明确"若宿主只支持拉取……不要只把 2 秒改成 100 ms"）。**不存在第三条"在 SDK stdio 通知里开箱拿到流帧"的路**。若做 (a)，瞬态行必须按 settlement 语义渲染：流片段可被 durable 事件整体替换，不可当已提交记录。

## 二、ui-trajectory 实现：记录组装的真实规则

读过的文件：`trajectory-event-projection.ts`、`trajectory-record.ts`、`trajectory-snapshot-builder.ts`、`trajectory-tool-definition.ts`、`trajectory-assistant-definition.ts`（节选）、`trajectory-virtual-rows.ts`、`TrajectoryTable.tsx`（跟随机制节选）。

1. **记录种类是封闭集合** `system | user | context | compacted | message | tool | subtool`；`user/message` 按 `source.kind` 分生产者（`contextProducer`：user / runtime-context / skill-catalog / agent-instructions…），未知 kind 以 durable kind 原样显示，不吞掉。
2. **回合归属**：`user` 记录的回合取"其后最近的 assistant"（`indexFollowingAssistants`/`enclosingUserTurn`）——与原型"无 turn 号的前置输入归入随后的第一个回合"一致，源码证实。
3. **工具生命周期**（`trajectory-tool-definition.ts`）：
   - 配对：`tool/call` 开记录（`role: 'start'`，id=callId），`tool/result` 按 `message.source.callId` 合并，args 从调用侧惰性复用；**孤儿结果保留可见**（name 置空、call=null）。
   - **中断合成**：回合/步关闭时仍未返回的调用，投影为合成 `tool-result`：`isError: true`、`error: { name: 'Interrupted', code: 'interrupted' }`、`seq = 关闭点 - 0.8`。**不存在永久 pending 行**。
   - PTC 子调用构成树（`tool/ptc-dispatch-start`/`tool/ptc-dispatch`），`MAX_DEPTH = 256` 带环检测。
4. **错误显示规则**（`displayFailure`）：结构化失败保留 `code`+`message`，**但 `code === 'AUTH'` 时 message 清空**——"Provider AUTH messages may echo a masked or partially preserved credential. Keep the raw diagnostic in the Session log, but never retain it in UI state."。这是展示层必须复制的安全规则。
5. **流式助手**：`assistant/live-chunk` 折叠为 partial（在途消息），`assistant/message` 结算，`assistant/attempt` 结算计时；`interrupted` 标记使记录状态为 error。TTFT/吞吐只在有 token 时间戳与 usage 时计算，不虚构。
6. **快照组装**（`TrajectorySnapshotBuilder`）：finalized 节点与 `runningCalls`（在途）分离；回合结束错误回填到该回合最后一个 assistant 请求；会话结束边界把运行中的 compaction 置为 error。
7. **记录身份**：`trajectoryRecordId` = recordId → `kind+callId` → `kind+seq` → index，**跨 prepend 稳定**（为历史分页服务；P0 只追加，暂不受益）。
8. **尾部跟随**：由虚拟器持有（`followsTableTail` + `BOTTOM_FOLLOW_THRESHOLD_PX = 2` + `followOnAppend: 'auto'`），交互点显式置 false；内容型流帧保持行 key 与高度、不重复写尾部滚动。原型的"意图驱动挂起"（滚轮向上/翻页键/向上拖滚动条；程序性写入打时间戳）是同一语义的无虚拟器最小实现。

## 三、据此对原型做的修正（已合入）

- `src/trace.mjs`：`user/message` 投影增加 `sourceKind`（可见元数据，非推理内容）。
- `ui/prototype/records.mjs`：任务记录按生产者分类；回合关闭时的在途调用合成为 `interrupted`（附 `interruptedAt`），渲染为错误样式，不再有永久"等待结果"。
- 测试与 fixture 同步更新（18/18 通过，浏览器复核三类标签正确显示）。

**已知未做**（记录备查）：AUTH 错误脱敏需结构化 `error` 字段——当前固定版本的持久化事件里 `tool/result` 无 `data.error`（已实测旧记录），待遇到携带该字段的 v2 事件时在 `visibleEvent` 一并投影并按规则清空 message；PTC 子调用树、compaction 记录、请求头快照暂不在 P0 范围。
