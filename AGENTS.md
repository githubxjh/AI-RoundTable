# AI-RoundTable Agent Instructions

## 思考方式与范围

- 先从第一性原理出发：明确用户要解决什么、浏览器/安全约束是什么、成功标准是什么，再动文件。
- 不要默认用户已经很清楚目标、约束和实现路径。只要动机、目标、成功标准或关键前提不清楚，就先问清楚再继续。
- 非简单任务要尽量严谨。给用户的进度说明里，要讲清假设、取舍、备选方案、边界情况和验证证据，但不要输出隐藏推理链本身，而是输出可审计的理由。
- 改动要尽量小。每一行改动都要能对应到这次请求。
- 优先沿用仓库现有架构和脚本，不要自己发明新框架。

## 项目事实

- AI-RoundTable 是一个 Chrome MV3 扩展，带 side panel、多模型适配器、router/review 流程，以及基于 Playwright 的 smoke/live 验证。
- 官方模型名保持英文：ChatGPT、Claude、Grok、Gemini、Doubao、DeepSeek。
- 附件策略分两条线：
  - Lite/商店版：不声明 `debugger`，只做低权限尝试、剪贴板/手动辅助和明确降级。
  - Advanced/本地版：使用 `manifest.advanced.json`，声明 `debugger` 和 `downloads`，通过 CDP `DOM.setFileInputFiles` 在临时落盘后注入附件。
- `output/playwright/` 是浏览器证据的标准输出目录。

## 标准流程

1. 先读相关现有文件。这个仓库常见入口是：
   - `AGENTS.md`
   - `CLAUDE.md`
   - `.claude/STATUS.md`
   - `.claude/HANDOFF.md`
   - `TESTING.md`
   - `package.json`
2. 先把需求转成可验证目标，再改代码。
3. 多步骤工作先给一个简短计划，写清楚怎么验证。
4. 只做最小有用改动。
5. 先跑最窄但有意义的测试；如果改动影响共享行为，再扩大验证。
6. 任务会改变项目状态，或者留下了有价值的续接点时，更新 `.claude/HANDOFF.md`。

## 测试命令

Windows 默认用这些命令：

```powershell
cmd /c npm.cmd run test:helpers
cmd /c npm.cmd run test:all
cmd /c npm.cmd run iterate
```

真实 Chrome attach-mode 验证：

```powershell
cmd /c npm.cmd run test:chrome:launch
cmd /c npm.cmd run test:live:core
cmd /c npm.cmd run iterate:live
```

attach-mode live 会使用 `tools/browser-profile/chrome-user-data` 下的专用 profile。遇到登录、验证码、人工验证、2FA、账号恢复或站点阻断时，要停下来并明确上报，不要硬推自动化。

## 浏览器自动化边界

- 实际 live 模型验证优先走仓库里的真实 Chrome/CDP attach 流程。
- bundled Chromium/headless smoke 只用于扩展壳层检查和本地回归，不用于证明已登录的 AI 网站功能可用。
- 不要在没有明确授权的情况下做破坏性操作或会触及账号敏感数据的操作。
- 证据保存在 `output/playwright/`，包括：
  - `output/playwright/smoke/`
  - `output/playwright/live/`
  - `output/playwright/live-chromium/`
  - `output/playwright/iteration/`

## PowerShell 备注

- 当前用户级 `ExecutionPolicy` 是 `RemoteSigned`，`.ps1` 可以运行。
- Windows 上优先用 `cmd /c npm.cmd ...`，避免 PowerShell 去拦 `npm.ps1`.
- 中文路径/输出要主动按 UTF-8 处理，例如 `-X utf8` 或 `[Console]::OutputEncoding`。

## 编辑规则

- 不要回滚用户已有修改，也不要碰无关的生成物。
- 除非用户明确要求，否则不要删掉无关的未跟踪文件。
- 不要改动归档的网页 HTML fixture，除非这次任务就是要处理这些 fixture。
- 不要把附件成功自动伪装成广播成功；附件结果必须保留明确的状态、方法、code 和 reason。
