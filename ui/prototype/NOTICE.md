# 来源与许可说明（ui/prototype）

本目录的视觉层**直接复制自 DSH 上游**（MIT 许可，允许复制并保留声明）：

- `theme.css`：**逐字复制** `@deepseek-ai/dsh-client-ui-theme` `0.2.1-rc.2` 的主题令牌表（statics 268 条、亮色别名 113 条、暗色别名 113 条），由 `scripts/extract-theme.mjs` 从安装物 `lib/client.js` 中按规则边界提取；暗色块重挂载到 `[data-theme=dark]` 与 `prefers-color-scheme`。刷新命令：`node scripts/extract-theme.mjs`。
- 组件样式值（标题栏/视图签、用户气泡、过程行、38px 账本行与彩色类型标签）取自上游源码 `packages/client/ui-conversation/.../ConversationRoot.module.css`、`packages/client/ui-chat/.../MessageItem|TurnProcessNodeView.module.css`、`packages/client/ui-trajectory/.../TrajectoryCell|TrajectoryTurnHeader.module.css`（上游提交 `687f282e8625c6b8d11ff58211a90524be2e4317`），选择器按本原型 DOM 改名，声明值保持一致；对话内容字号遵循上游 `--dsh-content-font-size`（默认 14px/22px）。
- 渲染逻辑（`records.mjs` 组装、跟随挂起、回放）是本项目独立实现，数据仍来自 `ds_events` 同源的可见事件，不包含推理内容与原始 provider 请求。
- `fixture/stress-long.json` 是**合成压力样本**（标注 synthetic）；`demo-*.json` 与 `ui-check-*.json` 是未修改的真实会话事件（提取脚本 `scripts/extract-fixtures.mjs`）。
- 上游项目：<https://github.com/deepseek-ai/deepseek-harness>（MIT）。上游许可文本副本：`node_modules/@deepseek-ai/dsh-client-ui-theme/LICENSE`。
