# 原版 DSH 前端 + MCP：零模型界面验收（2026-10-24）

**结论：第二实例已实际显示原版界面和历史正文，重连提示消失。**
用户最终目视答复：“看到历史聊天正文，重连提示消失”。这只通过了历史阅读与页面承载；
不是执行中正文流、任务自动选会话或完整产品验收。

## 为什么改路线

先做了 [原生 HTTPS 实验](https-zero-model-20261024.md)。宿主接受 HTTPS frame
来源，但实际页面被“公共页面访问本地网络”保护拦截，故不再沿嵌套 localhost 网页推进。
证书 SPKI 例外已随实验入口撤销，第二实例恢复正常证书检查；Windows 信任库未修改。

本实验把 DSH 发布包的原版前端直接作为 MCP HTML 资源返回。页面、React 组件、Cordis
插件、会话阅读器、样式均来自安装的 `@deepseek-ai/dsh-web-frontend` 与官方插件
`0.2.1-rc.2`，没有手写一套会话 DOM。固定此版本，升级后需重新验收。

只增加外层通信适配：官方 `__DSH_TRANSPORT__.rpc/loadBundle` 接 MCP；MCP 后端
再连接隔离的原生 SDK+Web 运行时。浏览器不直接访问本地 HTTP/HTTPS，不使用内层 iframe，
不改 Codex 私有代码，不关闭本地网络保护，也不谎报 `ownsHost=true`。

## 实际验证和修复

1. 首版空白，实查是两个独立压缩 bundle 被拼入同一模块导致变量重声明。保持独立模块作用域，
   前端等待 MCP ready 后启动；增加实际脚本解析检查。
2. 原版 UI 首次可见，但没有历史、一直重连。原因是适配器给每条逻辑流分别开 WebSocket，
   而 DSH 每个 API operator 只允许一条 socket。改成原生 multiplex 方式共享连接；断线重建
   operator cookie，取消单条流不销毁其他流。
3. 历史报 `Unsupported probe carrier`。原版 generated Remote handle 始终带 uplink，
   历史翻页也使用它。补齐 `item/end/cancel` 双向传输，保留原生错误码，取消时不等待
   挂起的 uplink `next()`。测试针对实际 carrier，不只测试无 uplink 的后台 snapshot。
4. 尝试直接内联所有插件后超过真实 MCP SDK 的 10 MiB stdio 缓冲上限；改为压缩打包原版
   插件和入口，浏览器解压后交给原版模块加载器。最终 HTML 约 6.6 MB，额外检查序列化后
   低于 8 MiB；预载两个官方插件 batch，减少初始 MCP 资产往返。
5. 最终用户确认正文可见、重连提示消失。实验卡片自身的 DOM 诊断也捕捉到 fixture 的
   用户任务和完整 assistant 回答（订单 65 笔、收入 2225 元等），与用户观察相符。
   无截图自动化证据；不是用 iframe load 或工具成功代替目视验收。

## 成本和隔离

- **本轮 DSH 模型调用为 0**：没有 prompt/start/followup 工具；后端明确拒绝
  `session/prompt` 等派发请求。子进程清除继承的 DeepSeek/OpenAI API key，采用独立 home。
- 展示的是仓库已脱敏 fixture，48 条原生历史记录。界面的旧 token 用量与缓存命中率是
  fixture 历史，不是此次实验的新调用成本。
- MCP `dsh_native_ui_probe` 仅登记在第二实例独立配置；监听 `127.0.0.1:19051`。
  独立传输检查用 19061 和另一实验 home。主实例配置、旧 worker 和 8801 服务未改动。
- 当前仍保留第二实例供查看。`dsh_s3_test` 旧实验登记未删除；本轮只使用新的展示探针。

私有证据在 `.local/codex-dev-instance-20261024/`：

- `mcp-ui-probe/report.json`：宿主卡片中的原版正文诊断和真实请求记录；其中无启动 token/cookie。
- `mcp-ui-check/live-carrier-check.json`：真实 MCP carrier 同时通过四条原生流，包含
  `session/follow` 的 48 条记录、带 uplink 的接口、取消一条流后其他请求可用、模型派发被拒绝。
- `offline-tests-native-ui.log`：**66/66**，无跳过；普通 npm test 不启动上述展示服务或模型。

## 复验入口

`scripts/native-ui-mcp-probe.mjs` 是独立、显式启用的实验 MCP server，不接入现有生产 bridge。
必须指定 `DSH_MCP_UI_PROBE_ROOT`、`DSH_MCP_UI_PROBE_PROFILES`，以及独立未占用的
`DSH_MCP_UI_PROBE_PORT`。profiles 指向已准备好的实验安装；不可指向用户会话目录作为 root。
资源 URI 当前为 `ui://dsh-native-mcp-probe/v4.html`，改变页面契约时更新 URI，避免宿主缓存。

`scripts/check-native-ui-probe.mjs` 用同样三个环境变量进行显式零模型传输检查；使用另一
root 和端口，以免与正在显示的卡片抢占。它只证明传输和资源契约，不替代用户观察。

## 尚未通过，下一步不能跳过

- **速度**：用户报告初版打开超过 30 秒，未达标。后端独立检查冷启动 12.6 秒，其中原生
  runtime 约 10.9 秒；另次检查约 9.4 秒，最终界面实验后台约 15.2 秒。
  卡片展开/模型调用工具的调度/用户点击含额外等待，不能将上述后台值冒充端到端耗时。
  页面还会因宿主重建而重新 mount；需要分别测冷启动、热展开、侧栏往返，再做缓存/预热。
- **原生实时正文流**：新载体只读过历史。MCP read 是事件到达即返回、1 秒有界等待的
  原生帧通道，不是状态刷新；仍未证明真实回答在完成前逐段画到此卡片。
- **目标根会话自动选择、A/B 隔离**：目前用户手动点开 fixture；没有完成任务绑定契约。
- **接入现有 ds_start**：正式桥和 observer 仍是旧 HTTP iframe 路线，尚未切换；本实验
  不是一个能派发真实任务的 production adapter。不能重载主实例便声称新路线已接入。
- **完整原版操作**：文件夹选择、写操作和模型派发在零模型探针中故意禁用；部分插件读取
  未开放，会显示功能错误；宿主还拦截 `data:` 字体。原版 UI 可见不代表所有插件都可用。
- 连接恢复、页签/侧栏生命周期、多卡片、背压与队列上限仍需产品化；不要把当前共享探针
  直接当成多任务服务。worker 统一兜底、OPS、小鲸鱼余额和单条任务入口仍未交付。
