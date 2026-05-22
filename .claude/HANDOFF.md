# 交接 - AI-RoundTable 工程骨架

## 已完成

- 添加了根目录项目规则 `AGENTS.md`。
- 添加了 Claude 兼容的行为说明 `CLAUDE.md`。
- 添加了自迭代运行手册 `docs/self-iteration.md`。
- 添加了 `scripts/iterate.mjs` 和 `scripts/lib/self_iteration.mjs`，作为统一的本地/真实浏览器验证入口。
- 添加了 `tests/self_iteration.test.mjs`。
- 在 `package.json` 里接上了 `test:helpers`、`iterate` 和 `iterate:live`。
- 已验证 `cmd /c npm.cmd run test:helpers` 通过。
- 已验证 `cmd /c npm.cmd run iterate -- --skip-smoke` 通过，并写出了 `output/playwright/iteration/last-run.md`。

## 进行中

- 分支：`master` @ `849dc55`
- 这次骨架工作开始前，工作区里就已经有其他附件上传实现改动。不要回滚它们。
- `cmd /c npm.cmd run test:all` 现在被缺失的 Playwright Chromium 阻塞，不是被这次新增的 helper 测试阻塞。

## 下一步可验证目标

1. 清理任何残留的 Playwright 安装进程/锁，如果还有 `C:\Users\xiepro\AppData\Local\ms-playwright\__dirlock`。
2. 反复运行 `cmd /c npx.cmd playwright install chromium`，直到 `C:\Users\xiepro\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe` 真正存在。
3. 重新跑 `cmd /c npm.cmd run test:all`。
4. 如果要验证 live 模型改动，先跑 `cmd /c npm.cmd run test:chrome:launch`，再跑 `cmd /c npm.cmd run iterate:live`。

## 备注

- 真正的浏览器流程是通过 CDP attach-mode Chrome 完成的，使用的专用 profile 在 `tools/browser-profile/chrome-user-data`。
- 证据要继续放在 `output/playwright/`，尤其是 `output/playwright/iteration/` 和 `output/playwright/live/`。
- live 自动化遇到登录、验证码、验证、2FA 或账号阻断时，要停下来。
- 不要把系统 Chrome 当成 Playwright Chromium smoke 线的隐式替代；验证已经说明它能启动，但可能拿不到扩展 service worker。
