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
   - `docs/agent-continuity.md`
   - `docs/debugging-convergence.md`
   - `TESTING.md`
   - `package.json`
2. 先把需求转成可验证目标，再改代码。
3. 多步骤工作先给一个简短计划，写清楚怎么验证。
4. 只做最小有用改动。
5. 先跑最窄但有意义的测试；如果改动影响共享行为，再扩大验证。
6. 任务会改变项目状态，或者留下了有价值的续接点时，更新 `.claude/HANDOFF.md`。

## 跨会话与压缩续接

- 长任务、live 浏览器任务、上下文即将压缩、或者用户要求“继续”前后，必须先读并维护 `docs/agent-continuity.md` 和 `.claude/HANDOFF.md`。
- `.claude/HANDOFF.md` 是压缩后的恢复入口，不是聊天摘要。它必须写清当前停止线、工作区改动、浏览器边界、已验证证据、未证明事项、下一步安全命令和不要做的事。
- 如果用户明确暂停功能修复转向工程规范或交接文档，不要继续跑 live 测试或扩大源码修改；先把交接和规则补齐。
- 不要从记忆或上轮聊天直接声称 live 结果。必须引用当前仓库里的命令结果或 `output/playwright/` 证据路径。

## Git 状态管理

- 这个项目会频繁迭代。暂存只是审查检查点，不是可靠回档点；完成一段明确范围且已经验证的改动后，应提交成一个可用 `git revert <commit>` 回退的版本锚点。
- 暂存前必须运行 `git status --short`，并用 `git diff -- <files>` 确认文件属于当前任务；不要把无关源码、生成产物、`tools/` 或前一轮遗留改动一并暂存。
- 如果一个文件已有他人/前轮改动，只在确认整份文件都属于当前流程收口时才整文件暂存；否则说明无法安全拆分，等待用户确认或使用更窄的补丁式暂存。
- 对已经验证通过、范围清楚、用户没有要求暂停审查的本轮改动，默认执行 `git add` 后继续 `git commit`，并在最终回复里给出 commit hash、验证命令和剩余未跟踪/未提交状态。
- 只暂存不提交的场景应明确说明原因，例如测试未过、范围仍在拆分、用户要求先审查、或存在无法安全纳入本轮的混合改动。
- 提交、拉取、回档前先说明当前分支、staged/unstaged 状态和风险。`git pull`、`git push`、破坏性回档和历史改写仍必须有用户明确确认。
- 回档默认用 `git revert <commit>` 回退已提交版本，用 `git restore --staged <file>` 取消暂存，或用 `git restore <file>` 仅回退已确认属于当前任务的未提交改动；禁止未确认的 `git reset --hard` 和 `git clean -fd`。

## 调试收敛规则

- 涉及 live 站点、群发、附件、CDP、Chrome profile 或模型适配器的问题，先按 `docs/debugging-convergence.md` 写出最小失败样本和字段级成功标准。
- 每轮调试只验证一个假设；改代码前写清本轮命令、证据路径、预期证伪结果和下一步决策。
- 附件群发必须从单模型、单文件、单动作逐层放大到双模型和五模型；不要直接在全矩阵里猜。
- 30-45 分钟没有新增证据，或问题落在 Playwright、Chrome extension、MV3、`chrome.debugger`、CDP、文件 input、反自动化边界上时，先做外部检索，再继续改。
- 如果连续两轮没有新增证据，停止功能修改，更新 `.claude/HANDOFF.md`，说明已排除项、未证明项和下一条最小验证命令。

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

Advanced/local 附件验证使用独立入口：

```powershell
cmd /c npm.cmd run release:advanced
cmd /c npm.cmd run test:chrome:launch:advanced
node scripts\test_attachment.mjs ChatGPT Gemini Grok Doubao DeepSeek
```

Advanced 线默认应使用 `9333`、`tools/browser-profile/chrome-user-data-advanced` 和 `output/advanced-release/AI-RoundTable-advanced`。不要误连其他项目的 CDP Chrome。

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
