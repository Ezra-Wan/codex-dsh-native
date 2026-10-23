# 来源与许可说明（ui/prototype）

本目录是**独立的最小实现**，不是上游代码的拷贝：展示概念（回合感知账本、工具调用/结果配对、错误留痕、尾部跟随、长内容折叠）参考自 DSH 官方轨迹视图的设计文档与实际事件契约。

- 上游项目：<https://github.com/deepseek-ai/deepseek-harness>（MIT License）
- 参考包：`@deepseek-ai/dsh-client-ui-trajectory`，版本 `0.2.1-rc.2`（node_modules 安装物，MIT）
- 参考上游提交：`687f282e8625c6b8d11ff58211a90524be2e4317`
- 数据来源：本项目 `src/trace.mjs` 从官方持久化日志读出的可见事件（`ds_events` 同源），不包含推理内容与原始 provider 请求。
- 上游许可文本副本：`node_modules/@deepseek-ai/dsh-client-ui-trajectory/LICENSE`。若未来任何文件改为直接复制上游源码，必须在该文件头保留其版权与许可声明。

`fixture/stress-long.json` 是**合成压力样本**：以真实记录为基础把一条工具结果加长到超过 8000 字符，仅用于验证截断展示；`demo-*.json` 与 `ui-check-*.json` 是未修改的真实会话事件（提取脚本 `scripts/extract-fixtures.mjs`）。
