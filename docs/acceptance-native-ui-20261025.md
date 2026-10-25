# 2026-10-25 原生界面续作验收

本轮仅重启隔离第二实例；主实例、旧 `deepseek_worker` 登记与运行中任务未被替换。Codex 安装版本已变为 `26.1021.3705.0`；DSH 执行与前端仍是 `0.2.1-rc.2`。

## 用户实际确认与返修

1. v4：侧边页正常，高度切换有效；流内仅有原生背景。查明隐藏左栏后，正文被 CSS grid 自动排到 0px 第一列。离线检查未发现该布局错误，不能把测试通过当作页面通过。
2. v5：正文显式固定在原生第二列后，用户确认“AB都有正文内容，侧边也都正常”。测试 B 是独立历史，保留 `【隔离验收 B】` 标记，任务 home 中同时存在相同 cwd 的 A/B，不能依靠单一会话碰巧打开。
3. 用户澄清：反直觉按钮来自 Codex；我们的控件不应重复宿主展开/收起。v6 删除自有按钮、内部 collapsed 状态、共享折叠协议，仅保留任务切换与重连。关闭侧边回 inline 时请求标准 `App.requestTeardown()`，不强行把正文隐藏成另一个空白收起态。

MCP 的关闭请求可以被宿主忽略，发出不等于关闭成功，参见 [MCP Apps 官方契约](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html#requestteardown)。OpenAI 的 [插件参考](https://developers.openai.com/plugins/reference)另提供 ChatGPT `window.openai.requestClose()`，不能由此断言 Codex 一定实现该扩展。本项目使用已安装 SDK 的标准方法，没有修改私有宿主代码。

## 新载体的实际正文增长证据

真实任务 `e2cd78f8-52fc-4384-9978-32833233e147`，由第二实例的 `dsh_s3_test.ds_start` 派发。使用正式 `src/server.mjs` 的 `CODEX_DSH_UI=mcp` 路径，不是旧 HTTP iframe，也不是 fixture 回放。任务只读、无工具，`deepseek-v4-flash`、`light`、`effort=off`、`maxTokens=2048`；本轮新增真实任务 **1 次**。

调用后，真正执行该任务的 SDK+Web 进程经原生双向流、MCP、官方 `WorkerTunnel` 到原版 `AppWebEntry`。卡片中的 opt-in 诊断只量取原生 assistant DOM 的字符数、可见框与 `data-streaming` 状态，不用状态文字冒充正文，不复制正文到诊断。

| 北京时间 | 原生正文 DOM | 状态 |
| --- | --- | --- |
| 15:52:14.111 | 6 字符 | 原生 streaming=true |
| 15:52:14.386 | 60 字符 | 原生 streaming=true |
| 15:52:18.168 | 839 字符 | 原生 streaming=true |
| 15:52:18.435 | 895 字符 | 原生 streaming=true |
| 15:52:18.481 | 原生持久日志 turn/end | 真实回合结束 |
| 15:52:18.747 | 904 字符 | 原生 streaming=false |

同一 view、同一 assistant 节点，在原生 turn/end 之前取得 **17 次**正文取样，字符数多次增长；这些取样的对话内正文区域高 **566px**，网格为 `0px 735.333px 0px`。最终 SDK 输出 904 字符，编号从 1 到 40 连续，finish reason=completed；实际原生日志没有工具调用。

这是正在执行的真实任务在 Codex 卡片里的 DOM 证据，已超出之前“官方 Web 收到流帧”与“完成后历史可读”的证明范围。**用户实际确认“如果按照你的要求查验是验收通过”——本轮新载体的真实正文流、精确会话及正文承载核心验收通过。**

用户另观察到：先开流内再开侧边会关闭流内；关闭侧边时流内迅速展开又关闭，直接开侧边再关也如此。标准 teardown 能收掉视图，但仍存在闪回，不能把最终关闭写成无抖动通过。侧边可用添加工作区等原生操作；这支持“原版客户端在运行”的观察，不等于所有操作均有独立验收。

新的产品约束：当前桥接跟进中不应让用户在原生输入框同时发新消息，先隐藏输入区；何时由 Codex 结束/脱离跟进并允许用户正式接管，列为后续状态机工作。流内/侧边布局不决定 peer/sub 身份。

私有证据保留于忽略目录：

- `.local/codex-dev-instance-20261024/bridge-home/review/native-ui-evidence.jsonl`
- `.local/render-stream-review-20261025/review.mjs`（只读核查，不发模型请求）
- `.local/render-stream-review-20261025/summary.json`、`evidence.snapshot.jsonl`（统计与对应哈希快照）
- 原任务持久日志、任务记录和结果仍在隔离 bridge home。

## 交付范围

84/84 离线测试通过；新增真实 Cordis + SlotRegistry 的模式切换/卸载测试，取样不会将隐藏行或状态文字算作 assistant 正文。前端按钮和布局仍必须以实际宿主交互为准。

仍待后续：关闭侧边的短暂闪回、任务所有权与接管；真实原生子 agent、审批/提问、停止/续接/压缩；worker 统一 adapter；OPS 任务能力及只在侧边显示的余额。`ds_wait` 的宿主调用行仍可能出现，没有通过 visibility 元数据假称单行聚合。
