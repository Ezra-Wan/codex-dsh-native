# 以替代旧 worker 为目标的本轮验收（2026-10-25）

目标：日常任务优先使用原生 DSH，同一套接口可选择旧 `deepseek_worker`；原生交付失败后可以明确转交，状态不明时不重复派发。原安装、服务、历史与主 Codex 配置均保留。

最新接续：用户已重新打开第二实例并返回实际显示内容，worker 基础降级观察窗目视通过。原生冷历史/子会话 UI 仍待确认。权限修复未获确认、未执行；目前继续零模型界面验收。此前因用户暂无时间关闭第二实例的收尾记录保留为历史。

## 已交付与实测依据

| 能力 | 证据与边界 |
| --- | --- |
| 双后端任务接口 | `ds_start(backend:worker)` 已从手动提示变为真正 MCP adapter；`ds_wait/events/followup/stop/review/observe/panel` 按持久身份路由。wrapper UUID 和真实 `worker_agent_id` 分开，不冒充 native session_id。 |
| 不确定状态 | 丢 start 回执只按唯一任务标记查询，不重发；丢 followup 回执需要验明 worker 的新 revision_round。已派发后的 wait 读取断线标为 unknown，不能误判成 not_sent。离线真实 STDIO fixture 已覆盖。 |
| worker 预算与验收 | 实际安装的 worker 没有逐任务 maxTokens。显式不支持的 cap 派发前拒绝；省略时明确返回 `budgetControl:worker-policy`、maxTokens:null 和警告。保留真实 issue_id、review phase、三次返修上限，不另造验收账本。 |
| 失败转交 | `ds_fallback` 关闭原 native SDK 后派发；completed 交付必须另给基于产物的 rejectionReason。running、unknown、用户主动 interrupted 均拒绝。原生会话退休，重复 fallback 返回同一 wrapper；不把旧 prompt 全量自动重放。 |
| 原生文件工作 | 实际原生任务 `6037441a-73fc-4c35-80c2-8ba574d14416` 读取随机标签及 [13,29,47]，生成 result.txt；父控制器实读文件，确认标签、89、无额外文件。maxTokens=1024、effort=off、workspace-write、sdk-web。 |
| 冷续接 | 上述任务重建 MCP 进程后同 ID 续接，在禁止工具的后续任务中准确回忆随机标签。原生会话没有被摘要替代。 |
| 并行与停止 | `1db5c542-a6e5-49b4-a16c-093a783585bf` 与 `e928fd53-4baa-40b2-bfb4-1fa92dcb55de` 同时启动；B 到 request/header 时调用 ds_stop 得到 interrupted，A 继续运行。 |
| 真正原生子 agent | A 真实调用 subagent、list_agents、send_message；子会话 `9497b8c6-52f7-4861-8c0c-f922738aea62` 的原生日志可独立读到 CHILD_ECHO_7259。不是 role:sub 标签。父回复加了说明句，没有遵守精确只返回标记的要求，因此原始 controls-acceptance.json 仍失败；独立只读审计确认机制，不篡改该失败记录。原生子会话的宿主内点击查看尚未目视确认。 |
| 真实 worker 兜底 | wrapper `5c4d3caf-3334-4434-a110-ab647677e6f1` → worker `0483a240-f387-4c71-ba35-349ee8c13eed`。从真实产物不合格的 native 任务转交；实读 result.txt 验证、取得真实工具记录、重复 fallback 未产生第二任务，真实 dsh_review(pass) 成功。worker 返修续接/停止的本轮证据为离线协议验证，不能扩大成真实模型验收。 |
| 冷历史零 prompt 重挂 | 真实 native 历史通过 native_bootstrap 重新加载原版前端资产。前后 session/turn/status/final 一致，原生日志没有新增用户 prompt、assistant 消息或 turn；0 新模型任务。此项是运行时和载体证明，新增重挂体验仍需宿主目视验收。 |
| 小型代码改动与命令 | native `ce0afdef-0754-4970-9a0f-3c6285e2374c` 修复 sum 初值，测试文件逐字节不变，父控制器独立执行 3 项测试通过。但 native pwsh 初始化失败（SetNamedSecurityInfoW / Win32 5），故原生整项验收失败。剩余“执行同一条测试命令”转交 wrapper `e209c832-26de-4544-8631-10bed5f50c2f` → worker `2c93238d-d723-4882-b637-e4018cb0b83e`；读回真实 tool/result event19121，isError:false、pass3。原生失败保留，worker 兜底有效，不能称已完全替代。 |

本轮真实新增共 7 个根任务（5 native、2 worker）及 1 个原生子会话，另有同 native ID 冷续接；任务数不等于模型请求数或账单。子会话存在后续消息。蓝屏后的恢复及重挂复验没有新增模型；之后的小型代码验收新增 native、worker 各一项。

## 实跑抓到并修复的执行配置缺口

首次 sdk-web 文件任务 `9860d3f8-3a46-4a10-bd71-27b9d49f23f1` 只有 working_directory，DS 明确表示不能读写文件；协议 turn 仍 completed，实际 result.txt 不存在。这次验收失败，随后真实转交 worker，不能把协议结束解释成任务验收通过。

根因：官方 Web bundle 禁用 host 的文件、shell、skills、compaction 等条目，由网页会话创建流程安装每 agent preset；官方 SDK 的 createSession 绕过该工厂。简单组合 SDK+Web 得到原版界面，但不等于 SDK agent 具备完整工具。

现通过条目 ID 恢复官方 SDK 的执行组件，保留其原始配置和沙箱，未手写工具或模型循环。shell 仍遵守系统平台条件。委派开关作用于已有条目，避免重复注册 spawn provider。真实文件任务与子 agent 已证明可用；压缩组件的挂载通过实际版本组合检查，但未用长上下文触发压缩、未验证压缩收益。

## 蓝屏后的恢复

Windows 系统事件记录重启于北京时间 17:28:50，BugCheck 0x50。没有定位到具体驱动或进程，不能据此认定或排除 DSH 相关性。

中断发生于冷历史重挂：该 native wrapper JSON（2422 字节）及锁 owner.json（19 字节）全为 NUL，原生压缩日志、两轮最终文本和 result.txt 完好。损坏原件与 SHA256 保存在隔离运行目录 crash-recovery-20261025，依据原始请求脚本、验收报告和原生日志恢复元数据；原 usage/部分精确 wrapper 时间无法恢复，明确留空。未重发模型。所有相关旧 native 进程已不存在，损坏锁先归档才重新取得所有权。

状态库新增：临时文件 flush 后才 rename、上一份有效 JSON 备份、损坏 primary 不覆盖有效 backup。备份恢复的任务先变 unknown，native 禁止盲目 followup/openView，worker 先核对真实远端；开关从备份恢复时默认关闭派发。这减少本次观察到的损坏风险，不声称能抵御任何硬件/文件系统故障或已证明强制断电无损。

## 当前首要缺口：Windows 命令沙箱

已核对安装版本：旧 worker 的 DSH 是 `0.1.5-rc.1`、sandbox-local 是 `0.1.5-rc.3`，新桥为 `0.2.1-rc.2`。新版 ACL 实现新增 Low mandatory label 与相关目录权限要求，官方包说明明确要求调用者对工作区具备 WRITE_OWNER；这与旧版只改 DACL 不同。现有目录由当前用户拥有，但缺少其直接 FullControl 条目。这是有源码依据的诊断方向，尚不能代替实际修复后验证。

已读官方 `node_modules/@deepseek-ai/dsh-sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/SKILL.md`。它要求单次用户确认后，在原沙箱外运行原版脚本；仅修改 `code-workspace`，保存 DACL 备份/恢复命令，不改 owner/deny、不手工扩大权限。**该确认正在等待用户回答，尚未执行**。其余目录及主 Codex 配置不变。禁止为了让测试绿而复制旧版安全实现、去掉新检查或切 danger-full-access。

准备好的精确路径/脚本 SHA256 见私有 `permission-repair-plan.json`。获准后只按其 Path/AllowRoot/Out 运行一次，以 verification 记录为准，再用零模型 confined 命令复查；拒绝或修复失败则保留 worker 兜底，不擅自扩大根目录。

## 复核与剩余项

- 完整离线检查 **106/106**，覆盖真实 STDIO 路由、回执不确定性、验收与续接、独立停止、跨后端写入冲突、视图 stale 响应、零 prompt 恢复、状态损坏保护。
- 原生正文真实流与 A/B 的用户目视验收沿用 [前一份报告](acceptance-native-ui-20261025.md)，不由本轮单元测试重新认定。
- 第二实例已补 `CODEX_DSH_WORKER_CONFIG`；主实例未重载、未切换 UI、未删 MCP。
- `worker-observe-probe.mjs` 只读展示真实已完成的 worker 任务，不提供模型派发/续接工具。用户已确认卡片显示“旧 worker 兜底”、completed、worker ID、最终结果 `proof-55a6a4b0-7 89`、read/write/present 等工具记录；与实际 input/result/worker record 核对一致。此次通过仅覆盖基础摘要显示，不包括执行中变化、逐条完整输入输出、停止交互或原生正文流；部分 tool/result summary 为空，不应夸成详情已可查看。
- 下一项：原生冷历史/子会话导航零模型目视检查；权限修复依旧待确认，获准后再按官方脚本运行并复查 native 命令。命令问题解决前保留 worker，不安排主实例默认迁移。
- 待补：真实 worker 修订续接/停止场景、审批/问题、长上下文压缩、OPS、侧边余额、任务总费用守卫、接管授权状态机。Codex 自动唤醒、调用行聚合与侧边关闭闪回仍是已知边界。

私有实测目录（不会入库凭据或原始请求头）：

- `.local/codex-dev-instance-20261024/replacement-1792919672954/`：首次缺工具失败、真实 worker 兜底与 fallback-acceptance.json。
- `.local/codex-dev-instance-20261024/replacement-1792919983896/`：原生文件/冷续接 acceptance.json、并行停止 controls-acceptance.json、明确保留格式失败的 controls-audit.json、蓝屏归档、cold-view-acceptance.json、code-acceptance.json、worker-command-evidence.json 及权限修复待确认计划。
