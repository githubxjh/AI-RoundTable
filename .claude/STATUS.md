# AI-RoundTable 状态

最后更新：2026-05-22

## 当前方向

- 把 AI-RoundTable 当成一个完整、可持续迭代的 Chrome 扩展工程项目。
- 保持 Lite/public 和 Advanced/local 两条附件路径分开。
- 用证据驱动迭代：先 helper 测试，再 smoke 浏览器检查，再在需要时做真实 Chrome attach-mode live 检查。

## 主要入口

- 规则：`AGENTS.md`、`CLAUDE.md`
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

- live 测试遇到登录、验证码、验证、2FA、限流或站点阻断时，要停下来并报告。
- `test:all` 依赖本地 Playwright Chromium 安装。
- 2026-05-22 时，Playwright Chromium 缺失于 `C:\Users\xiepro\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe`；多次 `cmd /c npx.cmd playwright install chromium` 都超时，并留下了 `__dirlock`。
- Advanced 附件验证只针对本地/unpacked，不要把它当作 Chrome Web Store 行为。
- 保留无关的未跟踪文件，包括 `scripts/move-ai-panels-right.ps1`，除非用户明确要求处理。
