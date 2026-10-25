# v0.1.2-preview.1：Windows 开发者预览

本版供愿意配置环境、反馈问题的使用者试用。它不是即装即用的通用插件，也不宣称完整替代 DSH 或旧 worker。发布源码，不附带任何账号、key、私人会话、node_modules 或预配置旧 worker。

## 复用关系

真正的模型循环、工具执行、会话与上下文压缩由 **DeepSeek Harness** 实现；正文使用它的原版前端。项目增加 Codex MCP 传输、任务身份/状态、调用入口和显示适配。

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)：原版 SDK/Web、WorkerTunnel 和事件契约，固定0.2.1-rc.2；MIT。
- [DSH-for-Vscode](https://github.com/k2124732496-lab/DSH-for-Vscode)：复用并适配其精确会话导航办法及来源代码；MIT。
- [Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public)：可选常驻鲸鱼沿用原版桌面与界面，另作窗口PID适配；MIT。没有把上游美术/资产装进本源码包。
- [dsh-ops](https://github.com/T-Auto/dsh-ops)：可选原版插件0.3.0，在独立 profile 安装；该实装版声明 MIT AND Apache-2.0，不用本项目许可替换它。

自有代码采用 MIT；上游原版权、许可证、固定提交与文件来源见 [第三方声明](../THIRD-PARTY-NOTICES.md)。本项目不是上述上游或 OpenAI 的官方发行版。

## 安装前提

已验证：Windows x64、Node24、DSH0.2.1-rc.2，以及支持相应 MCP Apps 的 Codex 桌面版本。其它系统和宿主未验收。准备 Node24、npm、pnpm11.22.0；没有对应 pnpm 时可自行安装 `npm install -g pnpm@11.22.0`。安装策略只允许必要的四个固定版本原生构建，采用官方 allowBuilds 格式。

```powershell
git clone https://github.com/Ezra-Wan/codex-dsh-native.git
cd codex-dsh-native
git checkout v0.1.2-preview.1
npm ci
npm run build
npm run doctor
npm test
node scripts/init-sdk-web-profile.mjs --install
```

前五项构建/检查及 profile 初始化不调用模型。profile 初始化会联网下载依赖，但不打开浏览器；第一次不再要求先有旧 Web profile。若初始化失败，先检查报错与留下的 profile 文件，不把失败当成功。请勿把原工作环境整个复制进来。

参考 [codex-mcp.example.toml](../codex-mcp.example.toml)，把 node 和项目路径改为自己的绝对路径再登记 MCP。只通过 `env_vars` 传 `DEEPSEEK_API_KEY` 的变量名，不把 key 写入仓库。重载所选测试实例后，先用 `ds_bridge({})` 检查，再显式开启派发。未设置 key 时只做离线检查，不运行 smoke 或模型任务。

## 当前可用与缺口

原版正文流、精确会话历史与 A/B、持久身份冷续接、并行根任务、真正原生子 agent、输出 cap 及失败后的旧 worker adapter 已有本机实测；具体范围以日期验收报告为准。新版连接诊断区分故障与请求停止，不能从超时就断言 laptop 断网。

已知缺口：Windows 原生 PowerShell/OPS 并发 Bash 仍有 Win32 5 初始化失败；所有子调用的总并发/总费用守卫、每轮费用估算、接管状态机、长上下文压缩完整交互未完成。工具调用行聚合、Codex 自动唤醒和侧边关闭闪回仍有宿主边界。OPS 推荐先用 files；worker 仍须使用者已有的独立安装，本版不捆绑它，也不承诺该旧后端的原生正文流。

自动 CI 运行无凭据的完整离线回归；它不等于真实 Wi-Fi 断连、宿主显示或模型工具的端到端验收。`npm run smoke` 是另外的付费模型实测，不放进默认 CI。

发现问题请提供版本、操作步骤、错误码和脱敏状态；不要上传 `.local`、key、运行时 URL token、原生日志或截图中的私人内容。当前后续工作见 [TODO](../TODO-HANDOFF.md)。
