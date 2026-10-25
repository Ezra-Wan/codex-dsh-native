# 下一模型交接：Codex 内可观察的原生 DSH 协作

## 当前 TODO：替代旧 worker，失败保留 worker 兜底（2026-10-26）

**公开预览已发布（2026-10-26）**：[仓库](https://github.com/Ezra-Wan/codex-dsh-native) 已是 public；[v0.1.2-preview.1](https://github.com/Ezra-Wan/codex-dsh-native/releases/tag/v0.1.2-preview.1) 是源码 prerelease、指向207971e，自有MIT且保留上游许可。全新安装及本地116/116通过，[GitHub Windows/Node24 CI](https://github.com/Ezra-Wan/codex-dsh-native/actions/runs/40210942102)成功。Git全历史及完整夹具扫描未发现凭据；已无凭据下载公开源码包核对SHA256一致。实际宿主/断网验收仍独立，主实例未重载。

**本节优先于后文历史。** 本轮 OPS、动态并发与常驻小鲸鱼已做实际调用/界面验证，完整事实见 [本轮报告](docs/ops-balance-concurrency-20261025.md)。不是“全部功能等价”：OPS 并发 Bash 一成功一失败，费用估算和主实例迁移仍未实现。

**新增连接诊断**：断网/解析失败/超时/服务端错误/主动停止/控制器失联分开记录，未知不冒充中断。断线后保留原任务身份，worker恢复只查询原结果、不重复派发。115/115离线通过；没有真实断Wi-Fi或重载现用MCP，旧worker直接调用的格式未改。见 [诊断报告](docs/connection-diagnostics-20261025.md)。

用户最新选择覆盖“余额仅侧边”的旧要求：**小鲸鱼跟随 Codex 窗口常驻，卡片收起也可访问**。已撤掉与原版气泡重叠的自绘文字条；用户确认“小鲸鱼在，单击显示余额，这很正常”，最终保留原版交互。后文旧侧边限定只作历史，不得恢复。

| 项目 | 真实现状 / 下一步 |
| --- | --- |
| 原版正文与历史 | 正文结束前17次增长、A/B、精确历史选择均已有实测。冷历史零 prompt 恢复正文也已目视；不必重新生成纸飞机。 |
| 输出上限 | 新任务 maxTokens=1024..32768，light 默认8192、coding默认32768；调用方选择。每次模型请求的输出 cap，不是上下文长度或整项费用预算。续接保留 cap，原生孩子继承。 |
| 动态根任务并发 | ds_bridge({maxParallel:4}) 已实现并实测；默认2、范围1–8，持久化到该 root。仅约束当前 MCP 进程的原生根任务/驻留运行时，不是 worker 或所有原生子调用上限；下调不打断旧任务，新派发在容量不足时拒绝。 |
| 真正原生双子会话 | 同父两次派发间隔2ms、初始执行重叠约34.8秒。A/B均实调 OPS 文件工具；不是只有1个孩子。maxDepth=1是嵌套深度。父续接不再清空旧 children，历史仍可查；子会话 UI 仍待目视。 |
| OPS | 原版0.3.0独立 sdk-ops/sdk-web-ops，默认off，可选files/full。文件读/search/replace及只读拒写零模型通过；真实父/双子/冷续接文件能力通过。Bash payload缺失已在隔离 profile 修复，单条只读 Shell 和一个孩子成功；另一个孩子 Win32 5/IPC 初始化失败，完整Shell未过。Background/PTC关闭，旧worker不宣称支持。 |
| 余额 | 原版 Codex Whale 0.4.1/MIT，固定上游提交；仅窗口PID选择器作适配，最终前端原版不改。真实账户余额 API 零模型成功，用户已见原生鲸鱼及点击余额。仅在第二实例启动，未注册开机任务或主实例插件。窗口移动/最小化等全部组合未逐项验收。 |
| 每轮费用 | 未接入，可选后续。需汇总父/子/压缩/失败且去重，再按明确价格估算；未知保持未知。账户差分不归因单任务，Codex用量扫描关闭以免冒充DSH统计。 |
| 原生命令 / ACL | 旧待确认隔离 code-workspace 的官方修复仍未执行，也未用 OPS 绕过去。新版 pwsh Win32 5 和 OPS 并发 Bash 失败均保留；现阶段失败仍走旧worker。 |
| worker 保险 | 真 adapter、稳定身份、review账本、失败切换与真实产物通过；降级状态/最终结果/工具摘要已目视。不提供原生正文流，真实修订/停止及完整工具详情仍待验。保留原安装/配置。 |
| 其他未完成 | 所有子请求总并发/费用守卫、审批/提问、长上下文压缩、所有权/接管状态机、主实例迁移；Codex自动唤醒和工具调用行聚合仍有宿主边界。侧边关闭短暂闪回按用户要求暂留。 |

**当前推荐**：先用 OPS files；full Shell 尚不能替代所有原生/worker命令操作。任务失败必须检查工具实证，不能只看 completed。桥已补子工具错误上报，包括 OPS isError=false 的显式 EXECUTOR_UNAVAILABLE；原失败日志不改写。

**环境**：第二实例已加入 dsh_ops_test，root=.local/codex-dev-instance-20261024/ops-test-home，cap=4；旧 dsh_s3_test 保留原root。不要跨root调用agent_id。OPS实测父 f0c81f44-5e43-4d81-a564-5652b406ff71 已收取，冷续接后两个旧孩子仍在；无需重跑。小鲸鱼在 whale-float-test，仅跟随第二实例，重启第二实例后需重新绑定PID。主实例未改、未重载。

**验证**：当前完整离线116/116（连接诊断轮115，OPS轮111）。真实新增1父+2子+同父1次冷续接；Shell失败未重复付费刷绿。余额和浮窗验证没有模型调用。各功能独立分支/原子提交。旧8792默认自启动保持关闭。

**持久化/蓝屏背景**：此前全NUL wrapper已归档，原生日志/产物完整，恢复未重发模型；flush→rename、有效backup、unknown不重跑守卫保留。此前验收与细节见 [worker替代报告](docs/acceptance-worker-replacement-20261025.md)，旧当前TODO见 [接入前快照](docs/handoff-before-ops-20261025.md)。

## 以下为历史轮次记录，不能覆盖文首当前 TODO

## 2026-10-25：恢复开发，流内只保留原生主内容

用户已要求继续工作，前一天的结束实验约束已解除；继续使用隔离第二实例，不重载主实例。

- [x] **新 MCP 载体真实正文流核心验收通过**：第二实例用户已确认；一次真实 DS 任务 `e2cd78f8-52fc-4384-9978-32833233e147`，实际原生 turn/end 前，同一正文节点 17 次 DOM 增长取样，6→60→…→895 字符，结束后 904 字符。详见 [本轮验收](docs/acceptance-native-ui-20261025.md)。未把该结论扩大为原生所有功能通过。
- [x] **普通输入区实现**：v7 通过官方 `conversation.composer.bar` slot 隐藏普通用户输入区，流内和侧边一致。原生问题/审批使用的 composer chain 未替换；这一隐藏策略不是后端 RPC 权限锁。普通输入栏内原生发送/停止等按钮随之不展示，停止仍可由 Codex 使用既有 `ds_stop`。真实 Cordis、实际 Factory 子槽声明及卸载验证通过。
- [ ] **当前优先验收**：零模型检查 v7 隐藏输入区后正文、A/B 和侧边仍正常。任务 peer/sub 身份不随显示位置改变。正式“Codex 结束跟进/脱离后允许用户接管”的状态机后续实现。
- [x] 用户已确认 v7 输入区隐藏符合预期，A/B 与侧边正常；进一步要求隐藏 **DSH 新建会话、添加工作区等入口**，不是隐藏我们当前跨实例任务切换栏。
- [x] v8 增加连接/加载阶段的轻量动画与清晰文字，错误或运行时释放时停止动画；只用 opacity/transform，尊重减少动态效果偏好。构建通过，目视效果待下一次零模型验证。
- [x] v9 隐藏原生侧栏中的新建会话、添加工作区按钮及工作区行新建入口；使用实际 locale 服务生成 aria-label 选择器，语言切换同步更新，不依赖打包类名。85 项离线通过，含已安装真实 LocaleRuntime 的中英文和动态工作区标签契约。实际按钮与动画待宿主目视验证。
- [ ] 自绘任务切换栏后续退场；原生历史目前只覆盖当前执行实例，不能先删除跨实例入口并假称能浏览全部并行根任务。

- [x] 流内隐藏原生左右侧栏及拖拽柄；通过官方 slot 优先级隐藏右抽屉按钮。Codex 侧边模式撤销该呈现策略，恢复原生占位与按钮。执行服务、插件工具、原生会话与正文组件保留，不靠替换 transcript 实现。
- [x] 使用已安装的真实 `SlotRegistry` 与 Cordis 验证切换和卸载生命周期；原生 boot 清单解析器验证新增模块的批次归属。
- [x] **v5 宿主确认**：用户确认 A/B 在对话内均有正文，侧边也正常。v4 的零宽正文列错误已修；用户另确认高度切换有效。用户所说反直觉按钮是 Codex 自带按钮，自有按钮文案修改不能当作该问题解决。
- [ ] **新体验要求**：收起态仍占高。优先简短观察窗（已有进度/摘要，不加模型调用）；若宿主无法压短，则考虑关闭视图，不保留大块空白。关闭宿主卡片需实测官方 teardown 请求，不宣称可强制关闭。
- **用户进一步澄清，以此优先**：不应重复 Codex 自带收起按钮。v6 删除自有展开/收起/侧边按钮，以及第二套 collapsed 状态和 `native_presentation` 协议；依靠宿主原生控件。关闭侧边返回 inline 时只请求标准 `App.requestTeardown()`，不再强制展开流内、不自行清空正文；宿主是否接受该请求仍待目视验证。未新增摘要界面。
- 用户已实测 v6：展开侧边会关掉流内；关闭侧边会短暂展开流内再关闭。最终关闭可用，**短暂闪回仍未解决**，不能勾选无抖动。
- v10 在宿主确实提供文档化 `window.openai.requestClose` 时使用它，否则仍走标准 teardown；记录实际路径，成功调用不会重复发送关闭。只读检查当前宿主只发现标准关闭通知的 schema，不能据此证明处理器已实现；不再从最终关闭反推是哪个 API 生效。关闭闪回是否改善待实测，不改 Codex 私有代码。
- 用户 v10 反馈闪回略有改善但仍存在，要求稍作排查、不合适则保留限制。日志显示 `closeExtension=true`，但没有触发 `native-close-request`；关闭侧边时是 **新 inline 卡片实例重新连接**，不是原实例收到 fullscreen→inline 事件，因此旧回调没有机会提前关闭新视图。这比“我们的关闭调用慢”更具体；不要将轻微改善归因为一个实际未执行的调用。
- v11 补隐藏原生侧栏的“自动化任务”入口（`schedule.manager/panel`），不移除执行侧调度能力；待最后一次零模型检查。
- [ ] 下一顺序：第二实例 A/B 精确历史及布局 → 新载体执行中正文增长 → 原生子 agent/操作 → worker 统一兜底与插件。

实现接缝说明：DSH `0.2.1-rc.2` 的公开 layout 服务没有整列移除开关。按钮用官方 `conversation.session.header.corner` shadow；列占位用原生 frame 的 `data-rightbar-col` 结构标记做局部 CSS 适配，不依赖散列类名。此适配应随上游版本一起复验。原生侧栏服务仍挂载，不能解释为后端功能被禁用。

新增可选取样诊断：`CODEX_DSH_UI_DIAGNOSTICS=on` 才在真实卡片内记录可见 assistant 行的字符数、原生 `data-streaming` 标志、网格尺寸与任务身份，写入桥接私有目录 `review/native-ui-evidence.jsonl`；不开关无 DOM 观察器。fixture 探针也开启此诊断。诊断无正文文本回传、不生成摘要、不触发模型；随后显式真实验收调用了 1 次 DS。DOM 证据与用户目视确认共同支持上面的核心通过结论，84 项离线通过不能单独证明界面通过。

## 2026-10-25：关闭遗留回放自启动

用户报告 Windows 反复弹出 `cmd.exe /d /s /c "dsh --profile web --no-open --port 8792"` 启动错误。命令来源已对应到 `scripts/native-replay.mjs`：原来每个 legacy MCP 启动都默认调用 `ensureNativeReplay()`，内层 Windows shell 未设置 `windowsHide`。

已改为 **只有 `DSH_NATIVE_REPLAY=on` 才允许 MCP 自动启动旧回放，未设置也保持关闭**；主 Codex 配置显式设为 `off`，示例同步。手动旧适配器补 `windowsHide:true`。不重载主实例、不终止正常任务或 worker；此改动不等于将主环境迁移到新 MCP UI。下文“默认自动拉起回放”是历史实现，禁止重新照抄。

## 今日收尾与最新产品要求（2026-10-24，优先于下文历史记录）

- **用户更正：流内展示应隐藏/禁用 DSH 自身的侧边抽屉；Codex 侧边展开保留完整功能。**这是待实现的产品要求，不能记成“当前流内没有抽屉”的观察或已完成项。使用官方布局/slots 控制，保留原生组件与执行能力。
- [x] 官方 `WorkerTunnel` 原样复用，MIT 许可与来源哈希入库；正式桥增加 `CODEX_DSH_UI=mcp` 可选路径，使用官方 `AppWebEntry`、实际运行时插件与样式、精确会话接收端。
- [x] **用户明确目视确认**：展开后自动出现目标历史正文，无需再点历史列表。该确认对应 v2，只证明历史承载与自动导航。
- [x] 两个隔离运行时各读 48 条历史，取消 A 不影响 B，关闭 capability 后拒绝访问，拒绝模型派发；最终 **81/81 离线通过，真实模型调用 0**。
- [ ] v3 布局改动已保存，**未目视复测**：侧边收回保持流内折叠；流内主动展开请求 600px，有限次数修复高度。用户在 v2 仍观察到偶发抽动及结束后高度太矮，不能勾选解决。
- [ ] 流内禁用原生抽屉；带独立正文标记的 B 会话宿主切换；新载体真实执行中正文流；原生子 agent/完整操作/OPS/侧边余额/worker 统一兜底，仍待实现或验收。
- 用户要求今天结束：不再启动实验或请求目视复验。第二实例收尾关闭，主实例与旧 worker 未重载。完整现状、时序、恢复入口见 [当日收尾](docs/reuse-implementation-closeout-20261024.md)。

## 最新需求澄清与现成实现审计（2026-10-24）

用户要求 **Codex 内按需显示真正的原生 DSH，并保留所选执行环境的查看细节与功能**。并行独立任务、DSH 原生子 agent 必须保留；流内与侧边是体验要求，不能拿布局或 Codex 风格的事件卡片代替原版能力。

详见 [原生 DSH 复用审计](docs/native-dsh-reuse-audit-20261024.md)。已核对 CodexHost、Harness Mix 等直接竞品源码：跨 harness 协作已有轮子，但其 Codex 展示投影不等于原版 DSH UI。可复用的具体资产包括：官方 `ClientTransportHooks`/`WorkerTunnel`、DSH-for-Vscode 发布版的原生 UI 导航接收端、dsh-mcp-apps 的稳定视图生命周期。VS Code 发布版与 main 的 API 不同，不可照抄旧源码。

下一实现沿用已显示历史正文的 **原版前端 + MCP 载体**，对齐真正执行的 runtime/profile，补精确根/子会话导航与必要功能端点，再验真实流、操作和插件；部分原生视图优先使用官方模块/slots，不手写仿制聊天界面。CodexHost 等经 CDP 扩展宿主的路线仅作为显式备选，本轮没有改变既有宿主修改边界。源码审计不是运行时验收，未新增模型调用、服务启动或 MCP 重载。

## 最新：零模型承载实验已得到实际效果（2026-10-24，优先于旧轮次描述）

- [x] 第二实例原生 HTTPS 实测：宿主接受 frame 来源，但用户实际看到公共页面访问本地网络被阻止；**HTTPS 路线未通过**。测试证书例外已撤销，未改 Windows 信任库。
- [x] 切换为 **DSH 原版前端 + MCP 通信适配**：保留官方发布包的组件、模块加载器、插件和样式，只替换 `__DSH_TRANSPORT__`。用户最终确认“看到历史聊天正文，重连提示消失”；卡片诊断也记录到完整 fixture 正文。**全程没有新增 DSH 模型调用**。
- [x] 修正真实实验暴露的打包作用域冲突、单 operator 单 socket 的 multiplex 约束、原版历史阅读的 uplink 需求、stdio 10 MiB 上限；**66/66 离线测试**通过，另有显式零模型真实 MCP 检查（四流并存、48 条历史、取消隔离、拒绝 prompt）。
- [ ] **速度未验收**：用户曾报告打开超过 30 秒；预载/压缩后后台冷启动约 9–15 秒，不等于宿主端到端耗时达标。需测冷启动、热展开、侧栏往返，处理资源缓存、重复 mount 和运行时启动成本。
- [ ] **下一交付**：将新 MCP carrier 按任务生命周期接入正式 `ds_start` 卡片，保留官方前端；实现所选根会话的真实接收契约，再验证实际长回复完成前正文增长、A/B 不串、收起恢复。当前只是第二实例的只读探针，**主桥仍未迁移，真实正文流/自动选会话/worker 统一兜底仍未通过**。

代码入口：`scripts/native-ui-mcp-probe.mjs`、`ui/native-mcp-transport.mjs`、`ui/native-mcp-rpc.mjs`；仅第二实例的 `dsh_native_ui_probe` 已配置。完整证据、限制、复验方式见 [本轮验收](docs/native-ui-mcp-probe-20261024.md) 与 [HTTPS 失败记录](docs/https-zero-model-20261024.md)。不要把后文旧 HTTP 方案的待办误当成新路线已经完成或只差重载。

## 下一轮执行单：先打通实际会话的原生正文流

2026-10-24 隔离窗口实测更新。**本节决定下一轮交付顺序**；下节保留完整产品要求，后文轮次记录仅供追溯。当前实现基线 `fddef6d`，构建和 **62/62 离线测试通过**。SDK+Web 同进程启动及真实正文到官方 Web `follow` 的传输已经通过；**Codex 内显示失败、自动选中目标会话未验收、单入口未实现**。本机宿主会过滤 HTTP iframe 来源，补充 HTTP CSP 声明后复测仍被屏蔽。完整事实与边界见 [S3 实测报告](docs/s3-window-20261024.md)，不能再把这条路径写成“只等重载”。

**下一轮唯一主目标：先解决本机 Codex 的页面承载限制，再实现展开所选任务后官方正文持续增长。** 当前直接 iframe 嵌入本地 HTTP 页面在这个版本不可用。事件等待、状态徽章、悬停文字和已提交日志不能作为替代交付，也不能改 Codex 私有代码或关闭浏览器安全检查来绕过。

### S1：接通执行中的原生流，先交可运行适配实现

- [x] 源码核对完成（`docs/s1-stream-design.md` 汇总）：独立 replay 进程拿不到瞬态帧（进程内性）；SDK stdio 不转发流帧；token 唯一出口是进程内 `authenticatedUrl()`。
- [x] 最小方案落地：**sdk-web profile**（dsh-base+dsh-sdk-app+dsh-web-app，同版本叠加无 fork）——执行进程自身成为官方 UI 宿主，session-controller 与执行同体，follow 流直收瞬态帧；`@codex-dsh/web-embed` 薄插件（~40 行自有代码）进程内落盘带 token URL；桥按任务分配端口 8801+、生成 overlay、采集 `record.nativeUrl`。相对协议改造路径的改动面对比见设计文档。
- [x] **s1-s2-acceptance 基础返修**：插件配置改为 `apply(ctx,config)`；profile 使用 `link:`；桥按世代重新采集 URL；卡片消费异步 URL。web-embed 任务使用私有 `task-homes/<id>/sessions`，profiles junction 复用共享安装，任务 home 跨 release 存活。这里只证明历史隔离，不能推导官方界面会自动选中目标根会话。
- [x] **four-fix-review 三项离线返修完成**：①使用注入上下文 `connectionCtx.webServer`，真实 Cordis 同级 provider 测试通过（`9e167d2`）。②webEmbed 摘要恒带 `nativeUrl: string|null`；null 同时清卡片缓存与撤页；真实 Bridge → `ds_wait` → 实际卡片交叉测试覆盖 A/B 往返、冷续接第二世代 URL 重挂（`a8e5d59`）。③列表与单任务派发共用物理 option 同步，新增任务可从下拉选项选择（`2626611`）。世代测试等待假运行时真正启动后才模拟插件写 URL，不再把启动清理文件的竞态当成产品失败（`26028a5`）。
- [x] **额外发现并修复的生命周期/弹页缺陷**：release 停止并等待旧世代 URL 读取器退出，禁止后台回写复活失效 URL（`43d4104`）；显式 null 的未就绪任务保持等待，不能临时展示全局其他会话（`10175fd`）。自动弹页关闭项原误用插件名 `web-app`，实际条目 ID 是 `web-runtime`；已在 profile 和每任务 overlay 都正确关闭 `openBrowser/printUrl`，旧 profile 的 init 刷新也更新该覆盖（`58c3945`）。测试使用上游补丁合成器、实际配置 schema 与运行时胶水验证，未实际启动服务或浏览器。
- [x] 原生语义保留：原生工具/会话身份/工作区/压缩/父子语义不变；正文由官方界面消费；attempt/revision、settlement、重连 baseline 语义由官方实现承担并以契约测试锁定。
- [x] 离线验证覆盖实际适配代码与官方折叠契约：插件真实加载器、同级服务 provider、上游折叠器、桥世代/任务 home、实际卡片异步 URL 与撤销闭环、物理下拉选项、上游 profile 覆盖。测试 **57/57**，不等于真实流端到端已通过。
- [ ] 插件失败标记诊断：插件会写 `<urlFile>.error`，但桥目前未消费该标记，仍按采集超时降级；不能声称桥已能区分插件失败与超时。
- [x] **真实执行进程到官方 Web 的传输**：同进程启动/SDK 握手通过；真实 `session/follow(assistantStream:true)` 在回答结束前收到 592 个正文片段，最终 885 字，正常完成。它不是浏览器渲染或 Codex 宿主验收。
- [ ] **Codex 宿主显示**：用户两轮观察均被屏蔽；本机资源校验器明确过滤 HTTP frame 来源。官方 UI 自动选会话、真实 A/B 切换仍未验收。已知边界：全局 native-replay 看不到 web-embed 私有任务 home。

交付（本轮）：`adapter/web-embed`、`scripts/init-sdk-web-profile.mjs`、bridge/runtime 接线、卡片按任务绑定、官方折叠契约测试、四断点返修、设计文档。

### S2：绑定所选会话，接入现有任务卡片

- [x] **任务范围隔离与卡片路由的离线接线**：任务级 DSH_HOME 隔离持久历史；卡片挂所选任务 URL、单任务结果接管归属、异步 URL 到达后换源，null 撤页并清缓存，选项同步覆盖新派发任务；`#session=` 假通道已删。
- [x] 离线覆盖旧响应丢弃、撤销后的 A/B 往返、同 session 冷续接的新 URL 重挂；由官方连接承担的真实重连、收起再展开表现尚未实测。
- [ ] **官方接收端选中目标根会话**：确认打开任务 URL 后实际选中的 session_id 与派发一致；不能从 task-home 目录隔离或 iframe.src 不同直接推导。未自动选中则仍需实现官方接收方契约，不能只标“待窗口”。
- [ ] S3 窗口：宿主内 iframe 承载 loopback+token URL 的实际表现；A/B 双任务级 home 切换实测。

### S3：已开放隔离窗口；宿主显示被阻断

- [x] **2026-10-24 用户明确开放第二实例进行验证**。实验的 Codex home、界面数据与 bridge 状态均在 `.local/codex-dev-instance-20261024/`，只重启过该实例；原实例、旧 worker、8801 服务未重载或终止。该授权不代表可改其他聊天或旧环境。
- [x] 独立工作区、profile 配置与 adapter 副本就绪，仅复用已安装依赖；不复制凭据，API key 按环境变量名转发。实验 MCP `dsh_s3_test`，`CODEX_DSH_WEB_BASE_PORT=18910`；传输探针用 18931。`DSH_NATIVE_REPLAY=off` 防止另外自动拉起全局回放。
- [x] 真实官方 Web 传输证据已取得：592 个正文片段在 SDK 完成前到达。首次独立探针默认启用思考，在 2048 输出上限下返回 max-tokens 且无正文，不能当成功；`effort=off` 后正常完成。输出上限按请求计，不是任务总费用限制。
- [ ] **宿主可见正文证据缺失且已实际失败**：两次卡片均显示内容被屏蔽。不能把其他模型的“已完成流式验收”文字或任务 completed 状态当作通过。
- [ ] **P0 承载替代方案**：先用零模型的空会话验证宿主允许的来源/传输、认证与页面加载。候选是受宿主支持的 HTTPS 承载，或复用官方前端并适配受支持的传输；HTTPS 来源能保留不证明证书信任、Cookie 和完整 UI 已通。未获授权不得将工作区会话暴露到公网；不通过关闭安全检查或改私有宿主代码解决。
- [ ] **认证边界**：官方启动 URL 会 303 换 Cookie，Cookie 是 `SameSite=Strict`；有效 Cookie 的页面 200 且无禁嵌响应头。跨站内嵌认证仍需验证，不能把 HTTPS 或 CSP 单项通过推导成已打通。
- [ ] **布局复验**：已关闭自动尺寸上报，内联固定 560px，模式切换只上报一次；实际 SDK 选项及控制器回归通过。宿主中的上下抽动是否消失尚未取得用户确认，不能勾选。
- [ ] 再验证 A/B 会话选择与隔离、收起再展开/重连恢复、停止/原会话续接。按尚未证明的能力安排最少实验，不重复已证明内容消耗额度。
- [ ] 单独记录 Codex 是否实现单条 `dsh-xxx` 原位入口、单击展开及可选并行侧边位置；工具访问 visibility 不能证明宿主隐藏调用行。宿主能力不支持时明确具体限制和可用交互，不宣称全量通过，不修改 Codex 私有程序绕过。
- [ ] **单入口仍未实现**：用户实测 `ds_wait` 行明显存在；需要宿主支持的聚合或完成回传方案。再次添加 visibility 字段、只修改调用纪律或把 wait 改名不算修复。

真实通过条件：**实际运行中的同一任务 + DSH 官方界面 + 回答结束前正文多次可见增长 + 正确会话绑定**。离线通过、协议调用成功或 iframe 能打开均不能单独满足。

### 后续顺序与提交纪律

S1/S2 离线实现 → S3 核心宿主验收 → worker 统一适配 → OPS 任务工具 → 侧边余额。worker 旧 MCP 全程保留；统一适配要有真实派发、可追踪句柄、等待/停止/观察，不是只返回分流提示。插件的完整约束沿用下节。

每个功能先开分支并确认当前分支，实现与相关测试原子提交；合并前列明“实现了什么/离线证明什么/真实尚未证明什么”。不修改已推送历史，不把轮询修复、流适配、worker 与插件混成一个提交。真实阻断本目标的缺陷可以修，已通过的观察循环不再作为下一轮主交付。

## 2026-10-24 用户最新要求：单条任务入口、原生流、对应版本插件

**本节保留完整产品与验收要求，下一轮执行顺序以文首 S1/S2/S3 为准。后文保留的旧原型、状态轮询和历史轮次记录不代表这些要求已经完成。逐段流式输出是 P0 核心，不能以状态刷新或历史回放代替；复选框区分已有实现与未验收项。**

### P0-A：每次任务只出现一条 `dsh-xxx`

- [x] 入口**声明**就绪（2026-10-24 三次修订：`ds_start` 携带 `_meta.ui.resourceUri`，派发调用本身渲染任务卡；instructions 收敛为一致纪律——卡片是唯一跟踪入口，observe 仅用于补挂旧任务卡片，不为进度加发 observe/panel。注意：这只是元数据与调用纪律；`visibility` 等字段不隐藏宿主调用行——是否真正单行聚合由宿主行为决定，未验证不声称）。
- [ ] **宿主内验证待窗口**：单行原位渲染/单击展开/流承载的宿主表现未实测；若宿主仍渲染多条工具行，明确记为未通过。
- [x] 角色与 backend（native/worker）、预算模式（light/coding）分别记录（`role`/`backend`/`mode` 独立字段，见 TODO-AGENT-MODEL）。
- [x] 未改写既有工作区同步、拷贝/worktree、权限与合并约定。

### P0-B：单击展开 DSH 原生界面，正文实时逐段到达

- [x] 展开载体为官方原实现（容器卡片 iframe 承载官方 Web，2026-10-24 起主链路；布局决策只认 `nativeReplay` 字段）。
- [x] **数据层：事件驱动有界等待**（2026-10-24：`ds_wait` 在新原生日志事件到达时立即返回——eventWaiters 唤醒，fake 实测 60ms 事件 → <5s 返回。这是 durable 事件级降级推送；SDK stdio 无 token 帧流是协议边界，见 `docs/upstream-source-study.md`）。
- [ ] **容器绑定会话缺口**：官方 Web 无 URL deep-link（实测 URL 不随会话变化、源码无参数处理）。卡片切换任务时附 `#session=<id>` **仅为预留通道，接收方不支持，不构成绑定实现**——"点击任务即定位该任务"与 A/B 切换换会话内容需要建立有接收方契约的会话选择通道（上游 deep-link 支持或包装代理层，评估中）。当前 iframe 打开官方界面后需手动点选会话。
- [ ] 宿主内证据（长回复结束前可见片段持续增长、收起再展开恢复、A/B 不串内容）——待宿主验证窗口；不以 MCP 返回成功或离线测试宣称通过。
- [ ] 官方 Web 对**运行中** bridge 会话的实时性实测（webserver follow 流读持久日志，事件级到达预期可用；逐段表现待实测）。

### 插件：与执行环境所用 DSH 版本对应

- [ ] 为已选择支持的插件记录实际插件 ID、版本、所配 DSH 版本、依赖及验证范围。先核实 OPS 与“小鲸鱼余额显示”分别对应哪个包/接口，不根据名称猜 API，也不把旧环境装过视作新环境已接入。
- [ ] **OPS 是任务工具能力**：在任务真正运行的 harness/profile 中加载并可被模型发现、调用；整个任务执行期间均可用，不依赖用户打开卡片、侧栏或预览页。按任务需要使用，不等于每一步强制调用。
- [ ] 验证 OPS 在续接、运行时释放后恢复及对应原生子 agent 中的可用性，保留现有权限控制。native 与备用 worker 如插件环境不同，明确标记各自支持范围。
- [ ] **小鲸鱼余额只在侧边展开时可用**：仅在展开的侧边原生视图中挂载/显示并按需读取；收起时停止该视图的持续查询。对话里的单条状态、普通工具输出和父模型上下文不重复填充余额信息。
- [ ] 余额按插件真实数据展示；未连接、无数据或读取失败时明确状态。余额展示不能成为 OPS 工具在折叠/后台执行时不可用的原因。

验收：折叠视图运行一个需要 OPS 的任务时工具仍可用；展开侧边才出现真实余额，收起后停止该展示的查询；恢复会话后 OPS 能力仍保留。开发阶段优先离线/合成验证，必要真实调用只做有明确验收目的的小额测试。

### 交付顺序与既有最低保险

按文首 S1/S2 先开发原生流连接与会话绑定，再在开放的隔离窗口做 S3 宿主验收；之后接 worker 统一适配、OPS 与侧边余额。插件不得成为延后真实流式接入的替代工作。保留现有 `deepseek_worker` 最低保险与原生会话身份；当前 `backend:'worker'` 仅分流指令，不能记为完整统一适配器已完成。

按 `docs/git-workflow.md` 分功能分支和原子提交；单入口、原生流、OPS、余额显示可分别审查和验收。当前其他 Codex 对话正在做实验，文档更新不启动服务、不重载 MCP、不触发模型调用；后续真实宿主验证使用确认隔离的状态目录、工作区和端口，或等实验窗口允许后进行。

**本轮（2026-10-24 三次）在上述约束内完成**：P0-A 数据层（单入口元数据+调用纪律）、P0-B 数据层（事件驱动 wait），均为离线验证；宿主实测、官方 Web deep-link 缺口、运行中会话实时性三项待窗口。本轮未启动任何服务、未重载 MCP、未触发模型调用。

---

更新：2026-10-24（二次），Asia/Shanghai。**主展示链路已按验收方向重构**：observer 卡片改为官方 Web 原实现的容器适配层（iframe + 降级面板；MCP server 启动自动拉起 native-replay，`ds_bridge` 返回 `nativeReplay.url`；布局决策只认 nativeReplay 字段，两种到达顺序不互相隐藏）。验收四缺陷已修 + 回归测试 `test/review-regression.test.mjs`（fixture 已入库 `test/fixtures/`，跨机器可复现）；外部活动保护以 `lastSelfWriteAt` 区分自身写入；`ds_start(backend:'worker')` 显式分流至保留的 deepseek_worker。**`ui/prototype/` 参考实现已整体归档**（chore/retire-prototype，历史在 git），共享资产 `ui/theme.css` 保留。Git 工作流规则落档 `docs/git-workflow.md` + commit-msg 钩子（`git config core.hooksPath .githooks`）。**重要实测发现：ZCode 内嵌浏览器本身就是 MCP Apps 宿主**——宿主能力不再是假设，iframe 嵌入待新 server 重载后实测。

## 目标与工作边界

- 仅在 `D:\@harness\codex-dsh-native-p0` 继续。它是新的独立项目，不回到旧 bridge 堆功能；不修改 `E:\#GMF-Conformer`。
- Codex 与 DeepSeek 分别保留自己的原生 harness、工作区、持久会话和压缩能力；不把 DS 降为一次模型 API 调用。
- 串行任务在同一 Codex 对话流里可观察；并行任务由用户选择在侧边展开，Codex 可同时做独立工作。
- 优先复用官方 DSH 的界面组件与交互，尽量跟随上游，不自行扩建完整多 agent 管理器。
- 用户授权的是继续这一桥接项目，不是修改 Codex 内部程序、旧 DSH 环境或凭据。使用 `dsh_native_p0` 的 `ds_*` 工具；旧 `deepseek_worker` 的 review/callback 流程不属于本项目。

## 已验事实

- [x] 官方 DSH/SDK `0.2.1-rc.2`，完整 `sdk` profile；异步派发、同 ID 会话恢复、独立停止、两个并行运行时。
- [x] 13 项离线检查通过，包含真实 MCP stdio 协议测试。之后本轮仅做真实小测试和文档交接，没有修改实现。
- [x] 用户内置重启后已加载新版 8 个工具。
- [x] 用户确认 `ds_observe` 的执行卡片可在当前 Codex 对话中展开读写记录。
- [x] 本轮两个真实 DSH 会话并行，原生 turn 时间重叠 **8526 ms**。A 用 8526 ms，B 用 9117 ms，各 3 次工具调用，均无工具错误。
- [x] A 的结果 `{lane:'A',sum:42,max:21}`，B 的结果 `{lane:'B',sum:29,max:16}`；父任务独立核对，两边输入未修改且只新增预期结果文件。
- [x] 用户确认 A/B 可切换，但**仍在对话卡片里**。这不能算“侧边展开”通过；也不能据此断言手动 thread entrypoint 一定不支持。
- [ ] 自动刷新、停止/续接按钮的实际界面交互仍未验收。

本轮证据：`.local/parallel-ui-1792665252121/review/acceptance.json`。
会话 A：`32e16b97-f10d-4a96-99a4-15eb79f5296d`；会话 B：`3cf73a7e-720b-486b-a8a9-c644ac3d7774`。结果均已收取、验收，没有未收取的付费任务。
单卡片证据：`.local/ui-check-1792664983899/review/acceptance.json`。
早期失败样本：`.local/demo-1792663550562/review/native-actions.json`；有真实 Windows shell 沙箱 `SetNamedSecurityInfoW failed (Win32 5)`，后续 DS 回读文件成功。该 shell 问题未修复，本轮文件工具测试没有重测它。

## 当前状态观察已稳定，原生正文流尚未接通

以下按 `222e567` 收敛当前实现。原生逐段输出尚未接通，下一轮优先级以文首 S1/S2/S3 为准。

| 层 | 当前实现 | 差距 |
|---|---|---|
| DSH → 后端 | `src/runtime.mjs` 使用官方 `subscribeSessionTree` 订阅并等待原生会话 | 当前消费主要是根会话 `session.event`；没有把原生 assistant stream 帧送到界面 |
| 后端 → 状态卡片 | `observer-core.mjs` 驱动 `ds_wait(timeoutMs:2000)` 有界等待，有热循环限速、错误退避、终态慢查与过期响应隔离 | 只更新状态及最后一条已提交消息的悬停提示，不传输原生正文流 |
| 正文展示 | `observer.mjs` 容器嵌入官方 Web；`src/trace.mjs` 为持久事件投影 | 官方 Web 尚未与实际 SDK 执行会话建立瞬态正文流连接，所选任务也未真正绑定 |
| 记录来源 | `ds_events` 从 DSH 官方持久化日志读取 | 已提交记录不能替代尚未提交的流式片段 |

轮询和阅读本地日志本身不调用模型；这不等于模型整个任务免费，也不代表把大量日志回传给 Codex 没有上下文成本。

## 上游材料：先读这些，避免重新大范围调研

参考版本固定在 DSH `0.2.1-rc.2`，上游源码参考提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。
官方仓库：<https://github.com/deepseek-ai/deepseek-harness>。
已有只读参考片段在 `D:\@harness\codex-deepseek-bridge-connection-fix\.local\research-20261022\dsh`，**只是部分下载文件，不是完整源码检出**。若缺文件，在本项目独立的参考目录获取对应版本；不要在旧工程内开发。

| 上游路径 | 已确认的用途 |
|---|---|
| `packages/client/ui-chat` | 原生聊天布局；`ChatView.tsx` 依赖会话、会话投影、滚动与 slots，不能视为独立 HTML |
| `packages/client/ui-trajectory` | 原生执行轨迹与时序视图，声明为 pure-consumer plugin；适合作为优先评估的最小复用切入点 |
| `packages/client/ui-conversation` | 会话视图注册和组合 |
| `packages/client/ui-session/README.md` | SessionProvider、绑定、状态和交互适配 |
| `packages/client/connection/README.md` | 原生 Web 的 Remote/RPC、事件流、重连、WebSocket `/api/remote.mux` 与认证边界 |
| `packages/api/session-controller/src/assistant-stream.ts` | 原生 assistant stream 的 start/chunk/end、attempt/revision 和重连基线 |

三个 UI 包的 package.json 均标注 MIT；根许可也已核对：<https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/LICENSE>。复用源代码时保留版权和许可文本，并记录来源与提交。当前只读了源码，没有对原生 UI 做截图或视觉一致性验收。

## 优先 TODO：逐项交付，勿同时扩大架构

以下为既有技术工作记录，不按章节编号覆盖文首最新要求：先完成单条 `dsh-xxx` 入口和实际会话的原生逐段流，再验收对应版本插件与侧边余额。

### 1. 真正验证可选侧边展开

- [ ] 首先检查 Codex 中用户手动打开 `DS 并行任务` thread entrypoint 的路径，和模型调用 `ds_panel` 的效果分别记录。当前只验证了后者，结果是 inline。
- [ ] 核对宿主 capabilities 与官方 `openai/ui` entrypoint/display-mode 规则；不把 fullscreen、内容标签页、Codex 内建子代理侧栏当成同一种能力。
- [ ] 有可用宿主入口就使用；若当前宿主不提供要求的位置，明确写出限制，不靠“工具成功返回”声称完成，不访问私有控制端点绕过。
- [ ] 默认选中活动任务，按需刷新任务列表；当前列表来自全部本机桥接任务，未按聊天隔离，且默认可能选到旧任务。补聊天归属/显式任务范围设计，避免 A/B 与其他聊天串记录。
- 验收：用户能在同一 Codex 页面按需展开/关闭面板、切换 A/B，主对话保持可用；留实际界面证据。

### 2. 复用原生视觉与交互：先做最小组件验证

- [x] 获取对应版本完整源码，先看 `ui-trajectory` / `ui-chat` 的 exports、依赖及 provider 契约，优先直接复用组件，保留升级路径。（2026-10-23：以 node_modules 内 0.2.1-rc.2 发布物为来源——exports 声明 `./src/*` 但 src 未随包发布；浏览器入口 `lib/client.js` 是 `window.__ModuleLoader__` 注册块，react 非独立 npm 包。结论：`docs/upstream-ui-reuse.md`。同日已稀疏检出上游源码到 `.local/reference/dsh-upstream`（pinned `687f282e`）并精读 trajectory/session-controller 实现，见 `docs/upstream-source-study.md`）
- [x] 用已有真实记录做离线适配原型，先显示一段“读 → 写 → 校验失败 → 恢复”的轨迹，验证窄面板、暗色、折叠、错误、长结果和自动滚动。（2026-10-23：`ui/prototype/`，`npm run prototype` 后访问 127.0.0.1:8791；真实 fixture 由生产 `readNativeEvents` 提取（demo 会话含 pwsh 失败+读回恢复，ui-check 会话读→写→校验通过），另有标注合成的长结果压力样本。截图证据 `.local/prototype-evidence-20261023/`，验收记录 `review/acceptance.json`，测试 18/18）
- [x] 外观按 DSH 真实设计重做（2026-10-23 应用户要求）：设计令牌取自 `dsh-client-ui-theme`（403 个 `--dsw` 变量，亮/暗两套），组件几何取自上游 `TrajectoryCell/TurnHeader.module.css`；用户/上下文/技能/回复/工具/异常彩色标签。仅保留必要控件，删全部开发提示；主题跟随系统。
- [x] 版式改为无界对话形式（2026-10-23 用户反馈：偏好对话视图而非轨迹卡片，附原生亮/暗截图）：渲染层按 `ui-chat` 源码重做——用户右气泡（`MessageItem` bubble 规格）、过程行发丝线分隔无卡片（`TurnProcessNodeView`）、回合折叠为「已完成，用时 N」状态行、助手文本自由流式。
- [x] 过程组与 markdown 对齐（2026-10-23 用户并排对比二次反馈）：过程行之间**无**分割线（此前根据 `TurnProcessNodeView` 的 border-bottom 误判为每行有线——该组件实际只渲染回合状态行）；组头按 `ChatGroupSeat` 实现（活动图标悬停/展开交换为箭头、`processTitle` 文案合成「已读取文件，已写入文件，执行了命令等」）；成员行使用上游真实图标（SVG 路径逐字复制自 primitives）；助手回复改用**同一 mdast 引擎**渲染（devDeps + `scripts/build-prototype.mjs` 打包为 `markdown.bundle.mjs`），样式整份复制 `MarkdownText.module.css`（`ui/prototype/markdown.css`）。证据截图 15。
- [ ] **版本对齐待办**：用户本机原生 App 实测 `dsh --version` = `0.2.0-rc.2`，本项目运行时与外观参考 pin 在 `0.2.1-rc.2`（上游另有 rc.3）。按交接规则不自动升级；成对升级时需同时核对外观参考版本——用户的验收截图出自 0.2.0-rc.2，像素级对照应以该版本复核。
- [x] **原生本体回放适配器已验证**（2026-10-23，应用户"copy+适配器"要求）：`npm run native-replay`（`scripts/native-replay.mjs`）用官方 `dsh --profile web`（0.2.0-rc.2）+ 本项目隔离 `.local/dsh-home` 启动原生 Web，bridge SDK（0.2.1-rc.2）写的会话被官方 UI 完整渲染（会话列表/对话/轨迹时间线，证据截图 19-21）。实测 0.2.0-rc.2 读 0.2.1-rc.2 会话格式兼容。零模型调用、不触碰旧环境。**这同时是 TODO 1 侧边面板的 Route B 候选**（iframe 嵌带 token 的本地 URL），宿主 CSP/iframe 能力待实测；原型（`ui/prototype/`）保留用于无进程依赖的卡片内嵌场景。
- [x] 外观层改为**逐字复制上游**（2026-10-23 用户确认可直接复制，MIT）：`theme.css` 由 `scripts/extract-theme.mjs` 从主题包提取整套令牌（statics 268 / 亮 113 / 暗 113），标题栏与「对话/轨迹」视图签按 `ConversationRoot.module.css` 复制（76px 头、13px/16px 签、品牌蓝活动条），对话内容字号对齐上游 `--dsh-content-font-size`（14px/22px，实测已一致），轨迹签恢复卡片账本（`ledger-view.mjs`，TrajectoryCell 几何）。证据截图 12-14。**后续 `ds_observe` 卡片沿用：无界对话版式 + theme.css 令牌 + 标题栏双签结构。**
- [ ] 对照原生界面截图/实际操作后再称为视觉一致。不能只换 CSS 或做打字动画就声称原生能力一致。（令牌与几何已是上游原值，仍无与原生界面的并排对照截图）
- [x] 若组件必须依赖完整客户端，简短比较三条路：官方组件+薄适配；原生 Web 整体嵌入；按许可移植最小展示组件。记录依赖、维护与会话归属成本，再选最小可行方案。（2026-10-23：P0 选 C 并记录 A/B 的推迟理由，见 `docs/upstream-ui-reuse.md`）
- 整体嵌入原生 Web 需处理连接、认证、iframe/CSP、工作区与运行时归属；不能假定另开 Web 实例就能控制 SDK 正在运行的同一个会话。不要把凭据放入 UI 工具结果或持久化页面。
- 验收：复用来源可追踪、没有重写模型循环、真实记录显示完整、Codex 内实际可见。（前三项 2026-10-23 已满足：NOTICE.md 记录来源、只消费 ds_events 同源可见事件、离线回放完整显示；最后一项待把原型接入 `ds_observe` 卡片后在宿主内验收）

### 3. 将显示链路改为真实事件流

- [x] 先核对所固定 SDK 的通知契约：assistant stream 是否暴露、属于何种通知、能否恢复；从官方类型/实现验证，不能根据名称猜接口。（2026-10-23 源码验证：SDK stdio 协议通知只有 `session.event`/`session.status`，流帧只在运行时进程内的 `agent/assistant-stream` cordis 事件与 session-controller 的 `follow` 推送流（含 cursorless assistant-stream 帧 + 重连 baseline + settlement 语义）中存在。结论与依据见 `docs/upstream-source-study.md`——要做真推送只能引入连接栈（路线 A 工程量），否则持久化事件有界拉取是唯一降级。npm 已出现 `0.2.1-rc.3`，仍锁 rc.2，升级需成对核实）
- [ ] 后端保留原生事件身份、session/turn/seq 与必要 attempt/revision；显示端消费可见文字与工具生命周期。过滤推理内容、请求头和凭据；不要原样转发 provider 原始数据。
- [ ] 在当前 MCP Apps 宿主实际支持的范围里选择推送方式。若宿主只支持拉取，评估事件到达即返回的有界长轮询作为降级，并明确仍非推送；不要只把 2 秒改成 100 ms。
- [ ] 持久日志用于断线补读；处理丢帧、重复、重连、结束与最后一批结果的竞态、多个卡片订阅释放和背压。
- [ ] 不让流式观察额外调用 DS 或 Codex；长日志只在展开时读取，避免把完整历史塞回父模型。
- 验收：长回复结束前就有可见片段，工具起止及时显示，断线恢复不丢不重；记录实际延迟。只出现完成后的整段消息不算通过。

### 4. 后续必要项，暂不抢占前面三项

- [ ] 界面停止/续接与会话隔离验收；停止当前是关闭该会话专属 SDK 进程，不是暂停，不回滚文件。
- [ ] 原生派生子会话、手动压缩与人工交互的映射；当前只观察根会话。
- [ ] 单独修复/定位 Windows shell 沙箱异常，不能靠关闭沙箱掩盖。
- [ ] OPS 等插件在新独立 profile 中逐项验证；旧 Web 装过不代表新 profile 已有。KV cache 命中以 usage 为准，会话复用不保证命中。
- [ ] 升级 DSH 与 SDK 时成对核实版本并跑兼容性检查；不要启动时自动升级或替换原生 history。

## 成本与接手步骤

本轮只新增两个 light 任务，每请求输出上限 2048；总计 8 次已提交模型回复，usage 为 inputTokens 3668、cacheReadTokens 53888、outputTokens 769、totalTokens 58325。这些是原生返回字段，不能当作未缓存输入量或完整账单；不含压缩、失败尝试、后代会话。

接手时先读本文件，然后按所选 TODO 读取最少必要源码。用现有真实记录做回放，优先离线协议和界面验证；有具体新行为待验证时再做一次小额真实调用。避免反复启动相同任务证明已通过的功能。

**Git 流程（2026-10-23 起）**：`main` 为稳定分支（基线 tag `v0.1.1-baseline`）；每项工作开 `feature/<主题>` 或 `docs/<主题>` 分支，提交用 `type: 中文主题`，自审 diff 后 `--no-ff` 合回 `main`，合并后删除特性分支。界面证据放 `.local/<主题>-<时间戳>/review/`。历史：`3b6a1c1` 基线 → `5a96bc6` 契约研究 → `0af4f16` 轨迹原型 → 交接文档更新。

项目入口：`src/server.mjs`；运行时：`src/runtime.mjs`；状态：`src/bridge.mjs`；投影：`src/trace.mjs`；界面：`ui/observer.mjs` / `ui/observer.html`。`npm test` 会先构建 UI。更新服务代码后使用 Codex 的 MCP 重载；已加载进程不会自动采用新源码。

当前派发开关已开启，无未收取任务。`.local` 与 `dist` 被 git 忽略；交接若跨机器，显式复制需要的脱敏测试证据，不复制凭据。项目仍处于未提交的初始工作区，不要假定 git HEAD 包含这些文件。

官方界面规范：<https://github.com/openai/mcp-extensions/blob/main/docs/spec.md>；此前已核对，但新实现前仍应按实际宿主能力验收。
