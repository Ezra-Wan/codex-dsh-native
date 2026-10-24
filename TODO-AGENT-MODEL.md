# Agent 模型 TODO：子 agent（原生模块）+ peer（拷贝工作区）+ 用户接管

创建：2026-10-23，Asia/Shanghai。独立于 [TODO-HANDOFF.md](TODO-HANDOFF.md)（那边管观察链路与宿主验收）；本文管**agent 组织模型**。设计定稿见当日对话，事实核查基于官方包 README（`dsh-subagent` / `dsh-tool-subagent` / `dsh-subagent-spawn-in-process` / `dsh-client-ui-subagent`）。

2026-10-24 最新交互与插件要求统一见 [TODO-HANDOFF.md 文首](TODO-HANDOFF.md)：每任务单条 `dsh-xxx` 状态、区分“同步工作区”与原生子 agent、单击展开实际执行会话的 DSH 原生逐段流；OPS 在任务运行环境中始终可用，余额仅在侧边展开时可用。本文件的角色/工作区流程沿用原约定，展示项不得继续复活已归档的手写原型。

## 角色定义（一句话版）

- **子 agent**：DSH 原生 spawn-in-process 后代，活在**一个** Codex 驱动的根会话内；进程内并行、共享派生工作区、仅 DS 父会话可续聊（人/Codex 均不可直接跟进）；不进普通侧栏列表（原生已如此）。
- **peer**：bridge 根会话（现有机制），**拷贝式独立工作区**（先 worktree/拷贝再书写）；Codex 与用户互斥驱动；父不在时用户可在 8792 独立续聊推进，留痕供恢复的 Codex 阅读。

## 工作区布局

```
X/             Codex 专属
X__<task>/     子 agent 任务根会话的派生产物区（一批子共享，可归档）
X-peer-<n>/    peer 拷贝区（git worktree 优先；非 git 才整目录拷贝）
```

会话命名：`[X·sub] <短名>` / `[X·peer] <短名>`（bridge name 字段加前缀）。

## 级别（按实现顺序；每级可独立交付）

### L1 · peer 拷贝式工作区（bridge 零改动）
- [x] 流程规范入库：worktree 优先、拷贝兜底、快照基线声明、merge-back 与清理（README + 本文）。
- [x] 离线干跑：在 `.local` 建真实 git worktree 验证流程可执行（不起 DS）。
- [ ] **真实验证闸门（花额度）**：DS 在 worktree 内 workspace-write 实写一次（Windows 沙箱有 `SetNamedSecurityInfoW` 前科，必须实测）。
- 验收：Codex 按规范即可给 peer 发独立可写区；bridge 不需要任何新配置。

### L2 · 子 agent 启用（runtime patch）
- [x] `subagents: true` 参数：`ds_start` 可选启用；patch YAML 三件套（`dsh-subagent` + `spawn-in-process` + `tool-subagent(provider: spawn, toolName: subagent)`），由 bridge 写入 `.local/patches/` 并以绝对路径传给 SDK（`patches: string[]` 已核实）。
- [x] 离线验证：patch 组合下 SDK runtime 可启动、会话可初始化、正常关闭（无模型调用）。
- [ ] **真实验证闸门（花额度）**：一次最小任务实测 `subagent` 工具暴露 + 后代事件到达形态。
- 边界：`ds_followup` 永不接受子会话 id（子 id 不入 agent 记录，仅入 children 清单）。

### L3 · 后代观测（数据层）
- [x] bridge 记录子会话清单：`session.event` 通知里 sessionId ≠ 根 id 的，记入 `record.children`（session_id、lastEvent、lastAt），随任务持久化。
- [x] `ds_wait`/`ds_bridge` 摘要携带 children；`ds_events` 接受子会话 id（复用现有 `readNativeEvents`，子会话有独立持久文件已由官方文档证实）。
- [x] 单测：fake runtime 发后代通知 → children 更新；子会话事件可分页读。
- [ ] **真实闸门**：子会话文件落盘路径/命名实测（决定子 agent 浏览器取数方式）。

### L4 · 用户接管探测与留痕
- [x] followup 活跃探测：目标会话日志 2 分钟内有外部写入 → 拒绝并提示"用户侧推进中"。
- [x] takeover 检测：会话中 `kind=user` 的 user/message 数 > bridge 发起的 turn 数 → `userTakeover`（计数 + 最近时间）随摘要返回，提示 Codex 先读 handoff。
- [x] handoff 约定：用户在 8792 结束接管时把摘要写进会话（普通消息即可，takeover 检测保证 Codex 必然看到）；无需新协议字段。
- [x] 单测：伪造近期 mtime → followup 拒绝；伪造多 user 消息 → userTakeover 置位。
- [ ] 8792 常驻 + 隔离 home 凭据配置（用户操作：在隔离 home 登录一次；不碰本地 home 凭据）。

### L5 · 角色与展示（数据层；UI 依赖 TODO 1 宿主验收）
- [x] `ds_start` 增加 `role: 'sub' | 'peer'`，入 record/摘要；`sub` 任务提示使用 `X__<task>` 派生区、`peer` 任务使用拷贝区——由调用方按规范选择，bridge 只记录。
- [ ] Codex 端展示（流内轻卡 vs 侧栏按钮、子 agent 浏览器可放大占满侧栏）：依赖 TODO 1 的宿主能力实测后实现；数据层已就绪。
- [ ] 子 agent 浏览器（工作区 → 任务会话 → 子会话树，只读观察）：待 L3 真实闸门后做取数，UI 复用 DSH 原实现并按需适配；遵循单条任务入口和原生流要求，不再依赖已归档原型渲染器。

## 全局边界（不变）

- 只动本项目 `.local` 隔离 home；不修改旧 `D:\@harness\dsh` 与其凭据。
- 子 agent 语义锁死：bridge 永不提供"直接跟进子会话"的接口。
- 真实闸门项都要花 DeepSeek 额度，逐项做最小调用，不重复已验证内容。
