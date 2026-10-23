# 验收指南（2026-10-23 轮次）

给评审人：本文件说明这一轮交付了什么、怎么跑、看什么、哪些还不算验收过。

## 交付范围（main 分支，基线 tag `v0.1.1-baseline` 之后）

1. **上游 UI 复用研究**：`docs/upstream-ui-reuse.md`（三路比较）、`docs/upstream-source-study.md`（源码精读，含 TODO 3 流契约结论）。
2. **离线轨迹原型** `ui/prototype/`：真实记录回放（读→写→校验失败→恢复），无界对话形式 + 轨迹卡片形式双视图，标题栏与「对话/轨迹」签按上游源码复制；`theme.css` 为上游主题令牌表逐字复制（`scripts/extract-theme.mjs` 可复现）。
3. **生产投影细化**：`src/trace.mjs` 的 `user/message` 投影携带 `sourceKind`；回合关闭时在途调用合成为「已中断」错误（原生语义）。

## 怎么跑

```powershell
Set-Location -LiteralPath 'D:\@harness\codex-dsh-native-p0'
npm ci
npm test        # 18/18 通过（基线 13 + 原型 5）
npm run prototype   # 打开 http://127.0.0.1:8791
```

原型页验证点：亮/暗主题（跟随系统，`?theme=light|dark` 可强制）；对话/轨迹双签切换；`逐步回放` 时滚轮向上应挂起尾部跟随并出现「回到最新」；长结果记录的截断提示；380px 窄宽度无溢出。

## 证据索引

`.local/prototype-evidence-20261023/`（**不入库，需随包单独复制**）：截图 01-14（功能/外观/无界/双签各轮），`review/acceptance.json`（三轮验收记录与发现并修复的缺陷）。

## 尚未验收（不要据当前状态声称）

- 宿主内可见：原型尚未接入 `ds_observe` 卡片，未在 Codex 内实际渲染。
- 视觉一致：令牌/几何已是上游原值，但未与原生界面并排对照。
- 真实事件流（TODO 3）：SDK stdio 无流帧通知是协议边界（见 source-study 文档），推送需另立连接栈 track。
- 侧边入口（TODO 1）、Windows shell 沙箱异常（TODO 4）仍未处理。

## 复现真实 DS 调用会消耗额度

`npm run smoke` 会发起真实调用，评审可自行决定是否执行。
