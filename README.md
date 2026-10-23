# Codex ↔ DSH 原生会话桥接 P0

独立项目，初始实现日期：2026-10-22。

Codex 保留自己的登录、工作区与运行环境；DeepSeek 在官方 DSH 的完整 SDK profile 中工作。桥接负责发任务、保留会话身份、展示原生执行事件、等待结果和中断，不自己实现模型循环、工具体系或上下文压缩。

**当前状态：原生任务执行与事件读取已验证；用户已确认对话卡片可展开读写记录、可切换并行 A/B。两个任务实际重叠运行 8.526 秒，结果独立校验通过。当前显示仍在对话卡片，侧边入口未验收；界面每 2 秒增量轮询，尚非原生流式显示。**

下一模型先读 [TODO-HANDOFF.md](TODO-HANDOFF.md)：包含原生界面复用、流式接入、侧边入口、当前证据和成本约束。

## 使用方式

在 Codex 中启用 MCP 服务 `dsh_native_p0` 后，其工具为：

此机已向 Codex 配置注册 `dsh_native_p0`，原有 MCP 项目保持原配置。首次安装时派发开关默认关闭；开关状态独立保存，使用 `ds_bridge({})` 查看当前值。

| 工具 | 用途 |
|---|---|
| `ds_bridge` | 查看任务，或设置 `enabled: true/false` |
| `ds_start` | 发起任务，立即返回 `agent_id`；调用方继续独立工作 |
| `ds_wait` | 最多等待 50 秒，返回进度或最终结果 |
| `ds_followup` | 同一个任务的后续工作，恢复同一个原生会话 |
| `ds_stop` | 停止这一任务的 DSH 进程，保留原生历史 |
| `ds_events` | 按游标读取原生工具调用、结果、可见回复和回合边界，不调用模型 |
| `ds_observe` | 请求在当前对话中展示一个任务的执行记录，需要宿主支持 MCP Apps |
| `ds_panel` | 声明可由用户打开的会话内容面板入口，供并行任务切换查看 |

桥接默认关闭。调用 `ds_bridge({"enabled":true})` 后才允许发起任务。关闭开关阻止新的任务和续接，不中断正在运行的任务；中断使用 `ds_stop`。

可以直接告诉 Codex：

> 开启原生 DS 桥接。把资料整理交给 light 模式的 DS，我这边继续分析主问题。两边完成后汇总。保留 DS 会话，之后需要时继续使用。

或者：

> 让 DS 用 coding 模式在独立工作区实现这个模块，你负责另一个模块和最后的集成。先发任务再继续自己的工作，不要立即等待，也不要重复实现 DS 正在做的部分。

调用方选择委派关系和任务模式；`light` / `coding` 是预算预设，不决定模型的上下级，也不限制模型只能处理某一类任务。同一 DSH 会话不可同时执行两次桥接请求；并行任务使用不同会话。

## 同一个 Codex 页面内可观察

验收目标：串行任务在对话流内持续展示 DS 的实际动作；并行任务允许用户按需展开侧边内容面板，Codex 继续工作。不能把只有最终总结的工具调用当作完成，也不以另开独立监控网站替代此要求。

`ds_observe` 关联 `ui://dsh-native/observer.html`，视图通过 MCP Apps 读取事件；`ds_panel` 使用官方 `openai/ui` 的 thread entrypoint。相同视图显示时间、工具名称、文件路径、调用参数、结果、可见回复和异常。自动读取间隔为 2 秒，不消耗模型请求。工具失败后即使 DS 给出答案，任务仍标为 `completed_with_warnings`，不会丢掉失败记录。

支持停止当前任务、任务结束后续接同一会话；运行中插入指令尚不支持。事件来自根会话的官方持久化日志，不展示推理内容或原始提供商请求；尚未展开 DSH 内部再派生的子会话。当前任务选择器显示这套本机桥接的任务，尚未实现按 Codex 聊天归属过滤。

**接入边界：** 官方 thread entrypoint 是会话内容标签页，不能据此声称已接入 Codex 内建子代理侧栏。用户使用内置重启后，当前聊天已加载全部 8 个工具，包含 `ds_events`、`ds_observe`、`ds_panel`。本项目没有宿主热重载接口，由 Codex 重新加载 MCP。本次卡片展示的验收依据是用户实际确认，而非仅凭协议测试。

界面验收还需确认：运行期间自动更新与错误展示；并行时可手动展开、切换任务且不串记录；停止与续接作用于正确会话。对话内卡片和读写记录展开已由用户确认，其余交互尚未验收。参考：[OpenAI MCP UI 扩展规范](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)、[官方界面接入说明](https://developers.openai.com/plugins/build/chatgpt-ui)。

## 两种默认预算

| 参数 | light | coding |
|---|---:|---:|
| 每次模型请求的输出上限 | 8,192 tokens | 32,768 tokens |
| 返回给 Codex 的最终文本上限 | 4,000 字符 | 12,000 字符 |
| 原生会话与自动压缩 | 保留 | 保留 |
| 原生工具与工作区 | 保留 | 保留 |
| 默认模型 | deepseek-v4-flash | deepseek-v4-flash |

`model`、`provider`、`effort`、`maxTokens` 可在新建任务时指定。上下文窗口取决于模型；提高输出上限不会扩大上下文窗口，也不能证明编码效果更好。这里的数值只是首版可调整默认值，没有宣称达到最优成本。

这两种模式使用相同完整 SDK profile，**没有切换到 sdk-minimal**。简短的交付文本与生成上限分别控制。完整最终答案保存在返回的 `resultPath`，原生历史由 DSH 保存，不把全部工具日志重复传给 Codex。达到生成上限的回答标为失败，保留部分答案供续接处理。

`maxTokens` 是单次请求上限，不能当作整个任务的费用上限。`usage` 汇总本轮根会话中有 usage 的已提交模型回复，包括原生报告的缓存字段；不涵盖压缩、失败尝试和后代会话，因此不当作完整账单。缓存命中由服务端决定，会话复用不能保证命中。

## 原生能力与当前边界

复用官方 `@deepseek-ai/dsh-sdk-client` 和同版本 `@deepseek-ai/dsh`。默认 profile 由 `dsh-base` + `dsh-sdk-app` 组成，保留原生工具、沙箱、会话存储、自动压缩和工具结果裁剪。关闭桥接进程后，下一次续接调用官方 `resumeSession`，不会拼装历史文本来冒充恢复，也不会在恢复失败时偷偷新建会话。

每个运行任务使用独立 SDK 进程，支持 `read-only` / `workspace-write`，不提供扩大为全盘访问的工具选项。任务工作区需要绝对路径。默认单个 MCP 连接最多 2 个活动任务和 2 个驻留运行时；空闲 120 秒释放运行时，历史继续保存。

同一桥接进程内，两个写入任务不得同时使用相同工作区，应选择独立 worktree。桥接不能检测 Codex 自己或另一个 Codex 聊天中的并发写入，调用方仍须分配不重叠的文件或工作区。这一规则不是全局文件锁。

P0 已具备“Codex 发任务 → 自己继续工作 → 按需等待 → 集成结果”的并行机制。**尚未实现已结束 Codex 回合的自动唤醒**，调用方不能在仍有未收取结果时声称整体任务完成。当前 MCP 工具在同一个 Codex 聊天内显示结果；**尚未嵌入 DSH 原生 Web UI，也没有完整映射 Web 端人工确认、手动 `/compact` 等交互**。默认配置中存在自动压缩，并不代表本轮短任务已触发实际压缩测试。

官方 SDK 没有单独的中途取消接口；`ds_stop` 关闭该任务专属运行时，原生会话仍可恢复，已修改的文件不会回滚。新的本地 SDK profile 不自动继承旧 Web profile 的 OPS、Memos 或其他插件。插件应在这个独立 profile 中逐项安装和验证，不能仅因旧环境装过便宣称新环境也具备。

## 安装与配置

Node.js 22+。此机实际验证版本为 Node.js 24.18.0。

```powershell
Set-Location -LiteralPath 'D:\@harness\codex-dsh-native-p0'
npm ci
npm run build
npm run doctor
npm test
```

参考同目录 `codex-mcp.example.toml` 添加到 Codex 配置。`env_vars = ['DEEPSEEK_API_KEY']` 只传递环境变量名称，不写入密钥值。凭据由 DSH 消费；doctor 仅显示变量是否存在。如果 Codex 未继承该环境变量，需要从已配置变量的环境启动，或在隔离的 DSH_HOME 中自行配置原生凭据。

可以在工具外操作开关：

```powershell
node src/server.mjs --enable
node src/server.mjs --disable
node src/server.mjs --status
```

本项目状态默认在 `.local`，原生 DSH_HOME 位于 `.local/dsh-home`。使用 `CODEX_DSH_BRIDGE_HOME` 可为另一套环境指定不同状态目录。安装不升级或迁移旧的 `D:\@harness\dsh`，不调用旧 bridge 的 review 状态机。

MCP 配置新增后，需要由 Codex 重新加载服务；当前已开始的聊天不保证动态出现新工具。可从设置重新加载，或在重新打开应用后的聊天中使用。

## 验证

2026-10-22，本机已完成：

- 13 项自动检查：真实 stdio MCP 握手与开关、界面资源和入口元数据、默认禁用、异步并行、容量限制、同工作区写入冲突、同 ID 冷恢复、丢失历史不替换、输出截断不误报、独立中断、运行时所有权、返回长度、工具失败保留及可见事件过滤。
- 真实 DeepSeek 调用：原生文件工具读取 JSON、计算并写出结果；第二个会话同时执行；桥接进程关闭后，原 session ID 恢复并正确回忆上一轮的随机标记与结果。
- 已确认完整 SDK profile 包含原生 compaction 和 tool-result-pruner；未用大上下文触发压缩测试，未测跨会话完整账单和缓存收益。

复现真实调用会消耗 DeepSeek 额度：`npm run smoke`。该检查只在本项目 `.local/smoke-*` 中创建一次性工作区，不使用科研项目或已有 DSH 会话。

最近一次真实验证记录：`.local/smoke-1792662827549/`。两条并行会话，其中主验证会话为 `d8fe7612-2d87-42b1-8d0e-b0655ba0606b`，已完成进程重启后的续接。

另一次对话现场演示：`.local/demo-1792663550562/`，会话 `bc243aa7-57aa-47b5-b219-c73a6a45c5ed`。DS 汇总 65 单、收入 2225 元，客单价 34.23 元，最高收入日周五；父任务独立校验数值通过。但原生 PowerShell 校验出现 `SetNamedSecurityInfoW failed (Win32 5)`，DS 随后读取文件检查。这说明产物正确不能代替执行过程可观察。该沙箱问题未修复，演示没有做后续上下文续接。

新增 `ds_events` 已通过真实 MCP 分页读回这次演示的 18 条可见事件，包含 6 次工具调用和 1 次工具失败，证据为 `review/observer-acceptance.json`。这是原生日志回放验证；实时界面、宿主布局和交互仍待验收。

重启后的界面小测试：`.local/ui-check-1792664983899/review/acceptance.json`。会话 `a87de710-cab5-4c2e-bb9d-df546c70d212` 用 8.808 秒完成读取输入、写入结果、回读检查，共 3 次工具调用、0 次工具错误。父任务独立校验总和 45、均值 15、最大项乙，输入未修改且只新增预期文件。用户在当前 Codex 对话中确认“出现执行卡片，可展开读写记录”。本轮只验证该显示范围，没有测试并行侧边面板、自动刷新、停止或续接按钮，也没有重测此前的 Windows shell 沙箱异常。

## 跟随上游

当前锁定 DSH 与 SDK `0.2.1-rc.2`、MCP SDK `1.32.1`，提交 lockfile。`npm run check-updates` 只检查，不自动安装。SDK 的 npm `latest` 标签当前落后于 DSH，不能分别执行两次无版本安装；必须核实对应 DSH 版本的 SDK 是否发布。

升级时同时调整 DSH 与 SDK 的版本，安装后跑离线检查和真实闭环，再切换使用。第一版不 fork DSH、不复制它的 agent loop，也不在启动时自动升级。这样尽量跟随上游，同时保留可重复的环境。

上游 UI 复用的契约研究与三路比较见 [docs/upstream-ui-reuse.md](docs/upstream-ui-reuse.md)；离线轨迹原型见 `ui/prototype/`（`npm run prototype` 后打开 127.0.0.1:8791），来源与许可见 `ui/prototype/NOTICE.md`。

## 开发流程（git）

`main` 是稳定分支；基线提交打 tag `v0.1.1-baseline`。每项工作从 `main` 切出 `feature/<主题>` 或 `docs/<主题>` 分支，提交信息用 `type: 中文主题`（feat/fix/docs/test/chore），自审 diff 后以 `--no-ff` 合回 `main` 并删除特性分支。界面与协议证据保存在 `.local/<主题>-<时间戳>/review/`（git 忽略 `.local`，跨机器交接需显式复制脱敏证据）。

## 为什么先选择这一条

官方 SDK 已提供可恢复原生会话和完整 profile；薄 MCP 适配就能检验你最关心的委派、上下文与并行成本。现有 hcom、CCB 等更适合继续比较跨终端通信和唤醒；若它们能稳定提供 Windows + DSH 的同类闭环，应优先接适配器，而不是扩大本项目。

在 DSH 中安装 GPT 订阅适配插件仍是合理替代方案，但它运行的是 DSH 的模型接口，不能单凭“用了 GPT”就等同于保留 Codex 自己的 harness。本 P0 不声称“多代理调度”本身有创新；后续价值需要通过原生能力保留、少重读上下文和真实成本对照验证。

参考：[DSH 官方 SDK](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/client)、[官方 SDK profile](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/sdk-app)、[Codex MCP 配置](https://learn.chatgpt.com/docs/extend/mcp)。
