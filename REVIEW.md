# 验收指南

当前版本：2026-10-24（HEAD 见 `git log`）。给评审人：这一轮交付了什么、怎么跑、看什么、哪些还不算验收过。历轮验收记录见 `.local/`（acceptance-review-20261024、consolidation-review-20261024 等，不入库）。

## 交付范围（main）

1. **主展示链路 = 官方 Web 容器适配**（2026-10-24 验收后重构）：`ui/observer.mjs/html` 为容器卡片——iframe 承载官方 Web（`scripts/native-replay.mjs` 启动、token URL 落盘、MCP server 启动自动拉起、`ds_bridge` 携带 `nativeReplay.url`）；**布局决策只认 `nativeReplay` 字段**（单任务摘要不再触发降级），降级面板与官方嵌入可双向恢复；`ui/prototype/` 为参考样例**不在主链路**。
2. **外部活动保护区分自身写入**：`lastSelfWriteAt` 标记（回合结束 + SDK 关闭 flush 都刷新），日志 mtime 晚于自身标记 +2s 容差才算外部接管；bridge 刚完成的会话可立即 followup。
3. **backend 协议层**：`ds_start(backend:'worker')` 返回显式分流指令（经保留的 `deepseek_worker` MCP 执行），native 任务入档 `backend:'native'`——任务目录不混后端；状态不明的任务禁止静默换后端重跑（工具描述已写明）。
4. Agent 模型 L1-L5（见 [TODO-AGENT-MODEL.md](TODO-AGENT-MODEL.md)）：peer 拷贝工作区规范、原生子 agent patch、children 观测、用户接管探测与 userTakeover、role 标记。

## 怎么跑

```powershell
Set-Location -LiteralPath 'D:\@harness\codex-dsh-native-p0'
npm ci
npm test          # 全部测试（含验收回归 review-regression）
npm run prototype # 参考样例回放页（非主链路）：http://127.0.0.1:8791
npm run native-replay  # 官方 Web：输出带 token 的 URL（.local/native-replay.json）
```

## 验收点（按 consolidation-review 建议顺序）

1. Codex 内重载 `dsh_native_p0`（新 server 代码）→ `ds_observe` 卡片应 iframe 承载官方界面（宿主允许时）；不允许则降级面板 + 「新窗口打开」链接。**iframe 宿主行为（origin/CSP）须实测后才能算通过**。
2. 任务完成 2 分钟内 `ds_followup` 应立即可用（自身写入不误拒）；在官方 Web 里人工推进会话后 2 分钟内 `ds_followup` 应被拒（外部写入保护）。
3. `ds_start(backend:'worker')` 返回分流指令且不创建 native 任务；`ds_bridge` 列表项带 `backend` 字段。
4. 子 agent（`subagents:true`）真实闸门与 worktree 沙箱实测仍待执行（花额度，见 TODO-AGENT-MODEL）。

## 仍未验收（不要据当前状态声称）

- 宿主内 iframe 实测（ZCode IAB 已证实是 MCP Apps 宿主并返回真实数据；嵌入本身未验）。
- 与 0.2.0-rc.2 原生界面的并排视觉对照（容器路线下此项目退化为"官方本体"，一致性由官方代码保证，但需确认嵌入视口表现）。
- 原生逐段流（TODO 3）、侧边入口（TODO 1）。
- MCP 登记精简（deepseek_preview 退役前须确认无活跃任务；dsh_subagent 与 deepseek_worker 共用安装目录不可删）。

## 证据

`.local/prototype-evidence-20261023/` 截图 01-22；`.local/acceptance-review-20261024/`、`.local/consolidation-review-20261024/` 两份验收报告（含复现脚本）。**均不入库，跨机器交接需显式复制。**
