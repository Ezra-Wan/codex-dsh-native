# OPS、并发与常驻余额验收（2026-10-25）

本轮仍在隔离第二实例进行。主 Codex 配置未修改、未重载；旧 `deepseek_worker` 安装与兜底保留。本报告区分原版工具真实执行、离线测试和用户界面反馈。

## 实测结论

| 项目 | 证据与结论 |
| --- | --- |
| OPS 文件能力 | 原版 `dsh-ops@0.3.0`：零模型 read/search 成功；workspace-write 的 replace 实际改中目标；read-only 的 replace 被拒且文件未变。真实父任务及两个原生子会话均调用 OPS 文件工具。 |
| OPS 冷续接 | 原父会话重启运行时后，真实再调用一次 `ops_inspect_local_file`，精确返回旧文件标记；ops=full、输出 cap=1024、两个旧子会话身份保留。没有新根任务、子任务或 Shell 调用。 |
| OPS Shell | 安装原版 Bash payload 后，零模型单条 read-only Shell 成功；真实双子会话中 B 成功，A 的 Bash 初始化发生 `CreateFileMapping` / Win32 5，命令未运行。**完整 Shell 兼容未过，未通过放宽沙箱或重复付费任务刷绿。** |
| 真正双子会话 | 父会话两个原生 subagent 派发相隔 2ms；两子会话初始 turn 重叠约34.8秒，第二次派发早于任一完成。证明不是只等待同一个 agent。未做两个子会话在宿主内切换的目视验收。 |
| 余额查询 | 复用原版 Codex Whale 的真实余额服务，零模型请求成功，返回 CNY 账户余额。金额存于本机证据，不入库。配置只存专用环境变量名，不复制 key。 |
| 常驻小鲸鱼 | 用户确认已看到小鲸鱼、单击能显示余额。最初额外深色文字条与原生气泡重叠，已撤掉并删除；最终保留原版单击交互。运行时 rendererReady、区域保护 verified、visible 为真，绑定第二实例 PID。卡片收起及窗口移动的每种情况未收到独立逐项反馈，不扩大为全部跟随场景已验。 |
| 本轮费用 | **未接入**。没有把账户余额差分当作这项任务费用，也没有把 Codex token 冒充 DSH 用量；原版 Codex session monitoring 已关闭。 |

原双子会话报告原样保留，其中失败和当时旧版 wrapper 的空 warnings 未被改写。新增桥接修复会把后续子会话工具失败，以及 OPS `isError=false` 但正文显式报告 `EXECUTOR_UNAVAILABLE` 的结果，带入父任务 warnings。控制器不能仅凭 completed 判成功。

## OPS 选择与安装

新增原生派发选项 `ops: "off" | "files" | "full"`，默认 off。files 仅开启原版文件组件；full 再开启原版 Shell。Background、PTC 均保持关闭。选择会在冷续接保留；没有安装或版本漂移会在派发前拒绝，不偷偷退回普通工具。

```powershell
node scripts/init-ops-profiles.mjs --home <隔离桥根目录>/dsh-home --install
```

实际安装到两个独立 profile：`sdk-ops`、`sdk-web-ops`，保留普通 sdk/sdk-web。DSH 固定 `0.2.1-rc.2`，OPS 固定 `0.3.0`；Bash payload `@dsh-ops/bash-win32-x64@0.2.1` 是显式依赖，避免 optional dependency 缺失却安装成功。未改原 Web profile。

当前建议先用 files。full 的并发 Bash 仍有失败；workspace-write Shell 的 ACL 准备/修复尚未获此前确认，本轮没有运行，也未用加载 OPS 间接修改该待确认目录。旧 worker 没有验证 OPS，显式 OPS 请求被拒；兜底会提示不继承原生插件。

## 动态并发的实际范围

```text
ds_bridge({maxParallel: 4})
```

默认2，可动态设置1–8，并持久化到当前 bridge root。作用于**同一 MCP 进程的原生根任务和驻留运行时**，包含占用运行时的视图；不是整台机器、所有聊天或全部父子模型请求的统一上限。下调不杀现有任务/视图，容量释放前新派发会被拒，不是已有排队器。旧 worker 不受此 cap 控制。

DSH 自带 subagent 的默认 maxDepth=1 限制委派深度，不限制同一父会话只能有一个孩子。本轮同父 A/B 实测已证明可并发；目前没有桥级“所有子模型请求总并发”或任务总费用守卫。

MCP instructions 进一步明确：先派发所有获授权的独立任务，保存每个 agent_id，再按结果依赖收取；不要每 start 一次就立即等它完成。真正有前后依赖的任务仍应串行。

## 原版小鲸鱼复用与边界

复用 [Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public) 原版桌面、原版 UI 与余额服务，固定提交 `4a7ec1240de82527f2222b4af5202fa7b2ad731b`、包版本0.4.1，MIT。原 LICENSE、来源和第三方声明随本机复制保留。它与原 Web 装的 `dsh-whale-widget@0.4.2` 是不同适配线，没有伪称已把后者装进 SDK profile。

只改 Windows 窗口选择器，要求明确的隔离 Codex 根 PID；未设置或目标不存在时不能回退到主实例。编译真实原版 C# 探针验证三种情况，考虑其250/750ms扫描缓存后，目标允许、缺失/未设置均不选其他窗口。

```powershell
git clone https://github.com/Yang-huai406/Codex-Whale-Public.git <本地参考目录>
git -C <本地参考目录> checkout 4a7ec1240de82527f2222b4af5202fa7b2ad731b
node scripts/prepare-whale-float.mjs --source <本地参考目录> --home <第二实例目录>/whale-float-test --codex-home <第二实例目录>/codex-home --install
./scripts/whale-isolated.ps1 -IsolatedRoot <第二实例目录> -FloatHome <第二实例目录>/whale-float-test
```

准备命令不覆盖已有 float home；失败后保留文件与日志，不删除设置重试。`--install` 使用原版 Electron 安装器，五分钟有界退出。本机 Node 下载器无进度，已停止该明确子进程，使用 curl 从官方 GitHub 续传；158149320字节，SHA256 与官方 npm Electron 包的 checksums.json 一致后才解包，未关闭证书检查。Electron 44.3.0 与其 notices 保留。

没有注册系统开机任务、没有装入主 Codex 插件目录、没有自动修改推理服务地址。固定余额连接只用 `DEEPSEEK_API_KEY` 查 `https://api.deepseek.com/user/balance`。原版约60秒采样、缓存与错误语义保留；账户余额可能含其他并行任务，不能据此归因本任务费用。

```powershell
./scripts/whale-isolated.ps1 -IsolatedRoot <第二实例目录> -FloatHome <第二实例目录>/whale-float-test -Stop
```

重启第二实例后需重新启动这个临时跟随器，让它绑定新 PID。主实例常驻安装仍未做。

## 本机交接与下一步

- 第二实例新增 `dsh_ops_test`，root 为 `.local/codex-dev-instance-20261024/ops-test-home`，cap 当前4；旧 `dsh_s3_test` 保留原 root。标准 env_vars/stdio 配置按[官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)核对。不要跨 root 传任务 ID。
- OPS 父任务 `f0c81f44-5e43-4d81-a564-5652b406ff71`；已收取并关闭执行运行时。需要只看历史时用此 root 的 `ds_observe`，不要重新派发。
- 本机证据：`ops-test-home/ops-live-acceptance.json`（原失败）、`ops-child-audit.json`（原生日志复核）、`ops-cold-followup.json`（续接实测）；`whale-float-test/balance-check.json`、`data/visibility-status.json`；均在上述第二实例目录中，不入库原始会话/余额/凭据。
- 完整离线回归111/111；最终撤去多余气泡改动后，相关安装预检再次通过。真实模型新增1个父任务、2个原生子会话、1次同父冷续接；零模型探针另计。未重跑失败 Shell。
- 未完成：并发 Bash 初始化失败定位；全子会话统一并发/总费用守卫；父/子/压缩/失败用量去重汇总及可选估算；真实子会话 UI 切换；此前 ACL 修复、worker 修订/停止、审批/压缩/接管及主实例迁移。余额异常不能影响 OPS 或任务执行。
