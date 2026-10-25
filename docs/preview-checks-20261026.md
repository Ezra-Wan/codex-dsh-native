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
