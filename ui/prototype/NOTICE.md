# 来源与许可说明（ui/prototype）

本目录的视觉层**直接复制自 DSH 上游**（MIT 许可，允许复制并保留声明）：

- `theme.css`：**逐字复制** `@deepseek-ai/dsh-client-ui-theme` `0.2.1-rc.2` 的主题令牌表（statics 268 条、亮色别名 113 条、暗色别名 113 条），由 `scripts/extract-theme.mjs` 从安装物 `lib/client.js` 中按规则边界提取；暗色块重挂载到 `[data-theme=dark]` 与 `prefers-color-scheme`。刷新命令：`node scripts/extract-theme.mjs`。
- `markdown.css`：**逐字复制** 上游 `packages/client/ui-primitives/src/markdown/MarkdownText.module.css`（上游提交 `687f282e`）。markdown 渲染引擎同为上游 `MarkdownText.tsx` 所用的 mdast 栈（`mdast-util-from-markdown` + `micromark-extension-gfm`，devDependencies，`scripts/build-prototype.mjs` 打包为 `markdown.bundle.mjs`）；渲染层以原生 DOM 替代其 React 层，输出同一语义结构、套用同一份样式。
- 过程行图标（思考/读取/写入/运行命令/上下文）的 SVG 路径数据**逐字复制** 自 `dsh-client-ui-primitives` `src/icons/index.tsx` 与 `shared-artwork.tsx`（`ui/prototype/icons.mjs`）；过程组的图标↔箭头交换、`processTitle` 文案合成逻辑按 `ChatGroupSeat.tsx` / `step-process.ts` 语义实现，中文字符串取自原生应用实际显示。
- 组件样式值（标题栏/视图签、用户气泡、过程行、38px 账本行与彩色类型标签）取自上游源码 `packages/client/ui-conversation/.../ConversationRoot.module.css`、`packages/client/ui-chat/.../MessageItem|TurnProcessNodeView.module.css`、`packages/client/ui-trajectory/.../TrajectoryCell|TrajectoryTurnHeader.module.css`（上游提交 `687f282e8625c6b8d11ff58211a90524be2e4317`），选择器按本原型 DOM 改名，声明值保持一致；对话内容字号遵循上游 `--dsh-content-font-size`（默认 14px/22px）。
- 渲染逻辑（`records.mjs` 组装、跟随挂起、回放）是本项目独立实现，数据仍来自 `ds_events` 同源的可见事件，不包含推理内容与原始 provider 请求。
- `fixture/stress-long.json` 是**合成压力样本**（标注 synthetic）；`demo-*.json` 与 `ui-check-*.json` 是未修改的真实会话事件（提取脚本 `scripts/extract-fixtures.mjs`）。
- 上游项目：<https://github.com/deepseek-ai/deepseek-harness>（MIT）。上游许可文本副本：`node_modules/@deepseek-ai/dsh-client-ui-theme/LICENSE`。
