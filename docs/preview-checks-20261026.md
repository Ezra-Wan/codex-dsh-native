# 公开源码预览检查（2026-10-26）

目标版本：v0.1.2-preview.1，自有代码 MIT；保留上游独立许可、署名、来源与固定版本。发布说明和适用范围见 [预览入口](preview-v0.1.2.md)。

## 安装与回归

- 从 Git 中取出源码，在另一个临时目录安装，未复制旧 node_modules、.local、profile 或私人会话。
- package-lock 的下载地址改用官方 npm registry，原 integrity 保留。`npm ci` 新装744个包后，完整离线回归116/116通过。
- 空目录 sdk-web 初始化发现了旧 Web 目录依赖，以及 pnpm11严格构建策略缺失；均已修复。只批准四个固定版本的必要原生构建，明确禁用无关 Google no-op 脚本；不再吞掉 ERR_PNPM_IGNORED_BUILDS。
- 全新 sdk-web profile 实际安装成功，原版 SDK + Web 初始化握手通过，随后关闭；未发 prompt、未建模型任务、未打开浏览器。
- 最终代码完整离线116/116再次通过。GitHub Windows/Node24 workflow 不配模型 key，禁用自动 replay，只运行 npm ci / npm test。

## 公开前检查

- Gitleaks8.30.1 从官方 GitHub release 下载并核对 SHA256；Git全可达引用的完整文本历史扫描未发现凭据。报告脱敏，不把原报告或私人目录发布。
- `.zstd` 夹具不能只扫描二进制或首个元数据帧；用官方 DSH persistence 解析器读出完整48条记录、76783字节后再扫描，未发现凭据。原始演示数据保持测试用途。
- 发布前查询 GitHub：原仓库无已有 workflow run、Release资产、issue或PR，未发现这些路径中遗漏的私有内容。
- 源码包由 Git archive 生成，包含 LICENSE、第三方声明和测试；不包含 .git、.local、node_modules、私有凭据、运行时URL文件或编译产物。
- 此类检查是自动扫描和范围核查，不是“保证不存在任何隐私或漏洞”。没有把应用场景的运行时事实换成测试通过的口号。

未进行本机 Wi-Fi 关闭、主实例重载、云训练操作或新的模型付费调用。Windows Shell/OPS并发故障、费用估算及宿主显示等已知边界保持在预览说明中。发布和公开是否成功，以 GitHub Release/可见性和 CI 实际结果为准。

## 发布结果

仓库已公开；[预览 Release](https://github.com/Ezra-Wan/codex-dsh-native/releases/tag/v0.1.2-preview.1)已发布，源码标签207971e。[GitHub Windows/Node24 CI](https://github.com/Ezra-Wan/codex-dsh-native/actions/runs/40210942102)成功。无认证请求可读取Release并下载430382字节源码包，SHA256为 deeb27c48668a63dc3642ecc7203e618b13d892e8d4d22f817f58a1c8ecef176，与上传前一致。此次额外文档记录不改变已发布源码标签。


## v0.1.3-preview.1 发布结果与边界

- 新预览 [v0.1.3-preview.1](https://github.com/Ezra-Wan/codex-dsh-native/releases/tag/v0.1.3-preview.1) 已公开发布为 prerelease；不可变源码标签 `e2bee73995080b3751d8fad00fc451e00964971d`。旧标签与资产保留。
- 本地最终源码构建与离线检查131/131通过；[GitHub Windows/Node24 独立回归](https://github.com/Ezra-Wan/codex-dsh-native/actions/runs/40262110663)成功。实际宿主、真实模型和完整操作回归由用户回来后进行，不把旧版目视验收移植到新规则。
- Git全可达引用扫描116个非合并提交、约1.90MB未发现凭据；完整解码夹具约77KB再次扫描无发现，夹具与旧预览没有改动。报告留在仓库外的本机临时目录。
- `git archive` 源码包164项、451110字节，不含运行目录、node_modules、dist或凭据；上游 BoundConversation 的 MIT许可与来源随包保留。无登录下载公开资产后，SHA256为 `c311fd0cc1bb9410cf6b16263e37f1059ec15c9a1697b469440f9a13e4c6ed87`，与本地上传前一致。
- 本轮未改主配置、未重载主/第二实例、未启动展示服务、未新调模型。源码已合并推送；现用实例未自动切换。回来验收前，先构建本地UI，再仅重载隔离测试实例，确认 `CODEX_DSH_UI=mcp` 和 `task-v13.html`；不要把仍运行的旧实例当作新预览。
- 功能与限制详见 [本版说明](preview-v0.1.3.md)，包括原生调用范围、sub/peer区别、侧边完整历史、可选宿主对话身份、早结束时显式固定，以及旧worker的降级范围。
