# 第二实例零模型 HTTPS 实验（2026-10-24）

结论：**未通过，转原版前端 + MCP 通信适配实验。**

实验专用 MCP 为 `dsh_https_probe`，入口 `scripts/https-ui-probe.mjs`。只安装在
`.local/codex-dev-instance-20261024/codex-home`，服务仅绑定 `127.0.0.1:19041`。
展示仓库已有的脱敏 session fixture；没有 prompt/start/followup 工具，启动前清除
该子进程继承的 DeepSeek/OpenAI API key，没有发起任何模型轮次。

DSH 使用原生 webserver TLS，而非反向代理。临时证书只对第二实例使用单个 SPKI
例外（`--ignore-certificate-errors-spki-list`），未修改 Windows 信任库，未使用全局
忽略证书错误或关闭浏览器安全的参数。这是开发实验，不是可分发的证书方案。

已取得的证据：

- 真实 SDK+Web 启动，Node 使用明确的 CA 验证 TLS；token 换取浏览器 cookie 303，
  带 cookie 读取官方页面 200、37448 字节，含真实 `__DSH_BOOT__` 注入。
- 官方 cookie 为 `Secure; HttpOnly; SameSite=Strict`；第三方嵌入认证仍有潜在障碍。
- 卡片实际完成 MCP 握手，宿主回传 `frameDomains=[https://127.0.0.1:19041]`。
  证据保存在实验私有目录 `https-probe/report.json`，未记录 token/cookie/key。
- 用户在第二实例实际看到：**“此连接已被阻止，因为它是公共页面发起的，旨在连接到您本地网络上的设备或服务器。”**

因此 HTTPS 允许列表已被宿主接纳，但真实页面仍被公共页面访问本地网络的限制拦截。
`frame-load` 事件也出现过，明确不能当作页面可见证据。未通过界面、目标会话选择或
正文实时流验收。不继续通过关闭本地网络保护来推进。

下一实验直接复用 DSH 发布包的官方前端、插件模块与样式，将其原生
`__DSH_TRANSPORT__` 接到 MCP；浏览器不再直接访问本地 HTTP/HTTPS。仍先显示
脱敏历史会话，不调用模型。实际看到原版界面与正文后才能推进下一阶段。
