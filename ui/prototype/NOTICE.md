# 来源与许可说明（ui/prototype）

**两条并行的展示路线**（2026-10-23 起）：

1. **原生本体回放（适配器路线，`scripts/native-replay.mjs`）**：不复制任何 UI 代码——直接用本机官方 `dsh` CLI 的 web profile（实测 0.2.0-rc.2）服务原生 Web 应用，`DSH_HOME` 指向本项目隔离的 `.local/dsh-home`，bridge SDK（0.2.1-rc.2）写入的会话由官方持久化栈读回、官方 UI 渲染。只读回放、无模型调用、不触碰旧 `D:\@harness\dsh` 环境。已验证：会话列表、对话视图、轨迹视图（时间线可拖拽）全部完整渲染（证据截图 19-21）。这是像素级对照的最终基准。
2. **离线原型（本目录其余文件）**：为 Codex 卡片内嵌场景保留的零依赖实现——令牌/图标/markdown 引擎逐字取自上游，DOM 渲染层为独立实现，与路线 1 同数据可逐项 diff。

- `theme.css`：**逐字复制** `@deepseek-ai/dsh-client-ui-theme` `0.2.1-rc.2` 的主题令牌表（statics 268 条、亮色别名 113 条、暗色别名 113 条），由 `scripts/extract-theme.mjs` 从安装物 `lib/client.js` 中按规则边界提取；暗色块重挂载到 `[data-theme=dark]` 与 `prefers-color-scheme`。刷新命令：`node scripts/extract-theme.mjs`。
- `markdown.css`：**逐字复制** 上游 `packages/client/ui-primitives/src/markdown/MarkdownText.module.css`（上游提交 `687f282e`）。markdown 渲染引擎同为上游 `MarkdownText.tsx` 所用的 mdast 栈（`mdast-util-from-markdown` + `micromark-extension-gfm`，devDependencies，`scripts/build-prototype.mjs` 打包为 `markdown.bundle.mjs`）；渲染层以原生 DOM 替代其 React 层，输出同一语义结构、套用同一份样式。
- 过程行图标（思考/读取/写入/运行命令/上下文）的 SVG 路径数据**逐字复制** 自 `dsh-client-ui-primitives` `src/icons/index.tsx` 与 `shared-artwork.tsx`（`ui/prototype/icons.mjs`）；过程组的图标↔箭头交换、`processTitle` 文案合成逻辑按 `ChatGroupSeat.tsx` / `step-process.ts` 语义实现，中文字符串取自原生应用实际显示。
- 组件样式值（标题栏/视图签、用户气泡、过程行、38px 账本行与彩色类型标签）取自上游源码 `packages/client/ui-conversation/.../ConversationRoot.module.css`、`packages/client/ui-chat/.../MessageItem|TurnProcessNodeView.module.css`、`packages/client/ui-trajectory/.../TrajectoryCell|TrajectoryTurnHeader.module.css`（上游提交 `687f282e8625c6b8d11ff58211a90524be2e4317`），选择器按本原型 DOM 改名，声明值保持一致；对话内容字号遵循上游 `--dsh-content-font-size`（默认 14px/22px）。
- 渲染逻辑（`records.mjs` 组装、跟随挂起、回放）是本项目独立实现，数据仍来自 `ds_events` 同源的可见事件，不包含推理内容与原始 provider 请求。
- `fixture/stress-long.json` 是**合成压力样本**（标注 synthetic）；`demo-*.json` 与 `ui-check-*.json` 是未修改的真实会话事件（提取脚本 `scripts/extract-fixtures.mjs`）。
- 上游项目：<https://github.com/deepseek-ai/deepseek-harness>（MIT）。上游许可文本副本：`node_modules/@deepseek-ai/dsh-client-ui-theme/LICENSE`。
