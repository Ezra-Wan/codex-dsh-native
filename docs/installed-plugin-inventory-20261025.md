# 已安装插件的只读核对（2026-10-25）

本轮只读取已有安装和说明，未安装、升级、加载插件，未读凭据或调用余额接口。正在等待 Windows 权限修复确认时完成，不代替当前 P0。

## 确切包与版本

原 Web profile：`D:/@harness/dsh/profiles/web`。

| 插件 | 实装版本 | 许可 | 包声明 / 当前边界 |
| --- | --- | --- | --- |
| `dsh-ops` | 0.3.0 | MIT AND Apache-2.0 | peer DSH `^0.2.0-rc.2`、Cordis `^4.0.4`；本版仅 Windows x64。与新桥 DSH0.2.1-rc.2 的实际组合仍需验证，不能只看 caret 范围便勾兼容。 |
| `dsh-whale-widget` | 0.4.2 | MIT | 是 DSH Web/desktop 版本，独立 Codex 桌面鲸鱼属另一产品；本项目要复用前者。原包没有声明 peer 范围，不能推导任意 DSH 版本可用。 |
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

复用原版 DSH 插件与前端资产，按实际传输契约接到 MCP；不能直接装“独立 Codex 鲸鱼”来冒充 DSH 原生插件。原版说明默认常驻、定时刷新，必须检查具体获取路径和生命周期。

用户要求仅侧边展开可用：需要侧边时实际挂载/读取、离开时注销展示及其轮询，而不只是 CSS 隐藏。流内和后台不能因余额插件开启而新增余额查询或把余额塞入父模型上下文。余额不可用也不能影响 OPS 工具。

先验证原版插件的路由/资产与新 MCP 载体兼容，再做零模型合成数据检查，最后才用真实余额接口；不要复制旧 profile 的 key、账户设置或 Memos 数据。
