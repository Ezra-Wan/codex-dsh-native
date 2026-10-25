# 已安装插件的只读核对（2026-10-25）

**这是接入前的原安装清单。** 随后新增隔离 OPS 安装、实际工具调用与独立常驻鲸鱼，现状以 [本轮验收](ops-balance-concurrency-20261025.md) 为准；下文实装版本仍对应原 Web profile。

## 确切包与版本

原 Web profile：`D:/@harness/dsh/profiles/web`。

| 插件 | 实装版本 | 许可 | 包声明 / 当前边界 |
| --- | --- | --- | --- |
| `dsh-ops` | 0.3.0 | MIT AND Apache-2.0 | peer DSH `^0.2.0-rc.2`、Cordis `^4.0.4`；本版仅 Windows x64。与新桥 DSH0.2.1-rc.2 的实际组合仍需验证，不能只看 caret 范围便勾兼容。 |
| `dsh-whale-widget` | 0.4.2 | MIT | 是 DSH Web/desktop 版本；后续根据用户常驻浮窗要求复用了 MIT 的 Codex 桌面适配线，不冒称已把此包装入 SDK。原包没有声明 peer 范围，不能推导任意 DSH 版本可用。 |
| `@memtensor/memos-local-plugin` | 本次仅确认 manifest 引用 `^2.0.20` | 未核 | 不在本轮安装范围，不复制原配置。 |

以上是本机安装事实，不是 npm 最新版本调查。包仓库元数据指向 `T-Auto/dsh-ops` 和 `MeteorNOX/DeepSeek-Balance-Whale-Widget`。

## OPS 接入要点

- 默认开启的 shell/file、默认关闭的 background/PTC 是四个组件，不应因为插件名有 OPS 就把后台或 PTC 一并打开。
- 已安装说明称 file 为固定 Rust worker、shell 提供 ops_bash 与固定版本 PowerShell。受限命令仍经 DSH 沙箱，禁止用插件绕过当前原生沙箱故障。
- 包说明还明确包含 Windows workspace 根目录 WRITE_OWNER 的启动准备。这正与当前新版沙箱故障相关；**不能趁权限确认未回答时，靠加载 OPS 间接改同一目录权限**。
- PTC 批处理需要显式启用，背景工具还要求完全权限；新桥当前只提供 read-only/workspace-write，不能为发布背景工具而静默扩大权限。
- 文档中的 token 节省比例是特定任务作者测试，非本项目实测。渐进工具声明/PTC 有界返回可减少冗余，但不把它说成插件能保证服务端 KV cache 命中。
- 先在隔离 sdk-web 里按其原版 bundle/声明加载，保持任务运行期间始终可见；分别验证根会话、冷续接、native 子会话与关闭卡片时可用。旧 worker 实际 DSH0.1.5，与新桥不同，不能把 native 兼容结果外推给它。

## 小鲸鱼接入要点

原先考虑仅复用 DSH 内嵌插件。用户随后明确改为跟随 Codex 的常驻小浮窗，后续已采用原版 Codex Whale 桌面适配线及其余额服务，固定版本与来源见本轮报告；这不是 DSH SDK 插件安装验收。

**最新要求覆盖旧侧边限定**：小鲸鱼常驻、卡片收起仍可访问，按原版单击查看余额。只在第二实例启动，账户采样不随卡片挂载反复启动，也不把余额塞进父模型上下文；余额异常不能影响 OPS。任务估算未实现，不把并发账户差分当单轮费用。

已零模型验证原版余额服务的真实账户查询；使用专用环境变量引用，不复制旧 profile 的 key、账户设置或 Memos 数据。DSH 原生内嵌插件的 MCP 兼容性仍未据此验证。
