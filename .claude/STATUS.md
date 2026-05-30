# AI-RoundTable 状态

最后更新：2026-05-30

## 当前方向

- 把 AI-RoundTable 当成一个完整、可持续迭代的 Chrome 扩展工程项目。
- 未来几个月开发重心切到 Lite/public：低权限、方便内部分享、稳定文本群发和评审流程优先。
- Advanced/local 附件线暂停为内部实验资料；除非用户明确恢复，不继续修 Advanced 附件、不跑 Advanced live、不把它推荐给普通用户。
- 用证据驱动迭代：先 helper 测试，再 smoke 浏览器检查，再在需要时做真实 Chrome attach-mode live 检查。

## 主要入口

- 规则：`AGENTS.md`、`CLAUDE.md`
- 压缩续接：`docs/agent-continuity.md`、`.claude/HANDOFF.md`
- 调试收敛：`docs/debugging-convergence.md`
- 测试：`TESTING.md`、`docs/self-iteration.md`
- 续接状态：`.claude/HANDOFF.md`
- 本地迭代：`cmd /c npm.cmd run iterate`
- 真实浏览器迭代：`cmd /c npm.cmd run iterate:live`
- 启动 attach Chrome：`cmd /c npm.cmd run test:chrome:launch`

## 当前可用测试线

- `cmd /c npm.cmd run test:helpers`
- `cmd /c npm.cmd run iterate -- --skip-smoke`
- `cmd /c npm.cmd run test:all`，前提是 Playwright Chromium 已经干净安装
- `cmd /c npm.cmd run test:live:core`，前提是专用 Chrome attach profile 已经启动并完成登录

## 当前注意点

- 2026-05-28 用户已明确暂停功能修复，要求先补交接文档和工程规范。继续前先读 `docs/agent-continuity.md` 和 `.claude/HANDOFF.md`，不要直接续跑 live 测试。
- 2026-05-29 用户授权改进测试/流程规范。本轮只做流程文档收口，不继续修附件业务逻辑，不跑 live 浏览器测试。
- 2026-05-30 用户决定暂时放弃统一附件上传，把开发重心转到 Lite/public。附件功能对普通用户隐藏/不宣传；Advanced 只保留内部开关和历史实验资料。
- live、群发、附件、CDP、Chrome profile 或模型适配器问题，先按 `docs/debugging-convergence.md` 写最小失败样本、字段级成功标准、单假设验证和外部检索触发条件。
- live 测试遇到登录、验证码、验证、2FA、限流或站点阻断时，要停下来并报告。
- Google 登录先在不带 CDP 的专用 profile 中手动完成；attach 模式只复用登录态，不负责完成新的 Google OAuth 登录。
- 2026-05-23 已验证 ChatGPT、Grok、Gemini、Doubao、DeepSeek 登录态可在 attach 模式复用。
- 2026-05-23 已修复 Grok 文本 live 的 `send_not_confirmed`，修复后 Grok 单模型 live sanity 通过。
- 2026-05-28 已修复 Gemini 文本群发发送：收窄发送/停止按钮匹配并使用原生 `click()` 激活当前 Gemini 发送按钮；Gemini 单模型 live 和 Gemini+Grok 真群发文本均通过。
- 2026-05-28 带附件+文字群发仍不能视作附件成功：Gemini、ChatGPT、Grok、Doubao、DeepSeek 不能按自动上传成功宣传。
- 2026-05-28 本机同时存在多个 CDP Chrome：9222 属于 `D:\丹纳赫实施资料上传\.chrome-upload-profile`，AI-RoundTable Advanced 附件验证应使用 9333、`tools/browser-profile/chrome-user-data-advanced`、`output/advanced-release/AI-RoundTable-advanced`。`test:live` / `test_attachment.mjs` 已加 `chrome://version` 校验，避免误连。
- 附件真成功只看 `attachmentResults[]`：`attachmentStatus=supported`、`method=cdp_advanced`、`code=attachment_cdp_uploaded`。文本 fallback 或模型回复不能算附件成功。
- `test:all` 依赖本地 Playwright Chromium 安装。
- 2026-05-22 时，Playwright Chromium 缺失于 `C:\Users\xiepro\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe`；多次 `cmd /c npx.cmd playwright install chromium` 都超时，并留下了 `__dirlock`。
- Advanced 附件验证只针对本地/unpacked，且当前暂停；不要把它当作 Chrome Web Store 或普通用户行为。
- 保留无关的未跟踪文件，包括 `scripts/move-ai-panels-right.ps1`，除非用户明确要求处理。
