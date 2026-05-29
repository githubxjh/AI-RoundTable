# AI RoundTable 自动化测试说明

## 概览

这个仓库现在有两条测试链路：

- `test:all`
  先跑 Node helper 测试，再跑 headless smoke。适合日常改动后的快速回归。
- `test:live:core`
  默认走“真实 Chrome + CDP 附着”模式，联调 `Gemini + Doubao + Grok`。
- `test:live:gpt`
  单独测试 `ChatGPT`。因为更容易遇到验证页，不放进默认 core 集合。
- `test:live:chromium`
  保留旧的 bundled `chromium` live 链路，适合调试扩展本身，不适合作为 Google 登录主路径。
- `test:chrome:launch:advanced` + `test_attachment.mjs`
  本地 Advanced 附件链路，使用独立 profile、Advanced unpacked 包和 `debugger` 权限。

`Claude` 目前不在默认 live 范围里。

## 默认 live 架构

默认 live 不再用 Playwright 启动一个“自动化 Chromium”去登录 Google。

现在的默认流程是：

1. 先关闭正在运行的 Chrome
2. 运行 `test:chrome:launch`
3. 脚本会用真实 Chrome 打开一个专用持久化测试 profile，并开启 remote debugging
4. Playwright 再用 `connectOverCDP()` 附着这一个真实 Chrome

这样 Google / GPT 登录仍然发生在真实 Chrome 里，但使用的是一个独立的长期复用 profile，不再触发 Chrome 136 对默认 user data dir 的限制。

普通 live 文本验证和 Advanced 附件验证是两条线：

- 普通文本 live：`tools/browser-profile/chrome-user-data`
- Advanced 附件 live：`tools/browser-profile/chrome-user-data-advanced`、`output/advanced-release/AI-RoundTable-advanced`、默认端口 `9333`

不要把 Advanced 附件问题拿普通 root/Lite 扩展证明，也不要把普通文本群发结果当附件上传成功。

## 一次性准备

第一次用 attach-mode live 时，在真实 Chrome 里做一次：

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. `Load unpacked`
4. 选择当前仓库根目录

这个专用 profile 默认放在：

- `tools/browser-profile/chrome-user-data`

它会长期复用，不需要每次重装或重新登录。

## 推荐日常流程

1. 改完代码先跑：

```powershell
cmd /c npm.cmd run test:all
```

2. 需要真实站点联调时，先启动真实 Chrome 测试会话：

```powershell
cmd /c npm.cmd run test:chrome:launch
```

也可以直接用 Windows 包装脚本：

```powershell
.\test-chrome-launch.cmd
```

3. 在这个 Chrome 窗口里检查扩展是否已加载，并按需登录 `Gemini / Doubao / Grok / ChatGPT`

4. 然后运行：

```powershell
cmd /c npm.cmd run test:live:core
```

或者：

```powershell
.\test-live-core.cmd
```

## 调试收敛流程

live、群发、附件、CDP 或模型适配器问题先看 `docs/debugging-convergence.md`。不要直接从全模型矩阵开始排查。

推荐顺序：

1. 先写 `Debugging Packet`：现象、成功字段、浏览器线、最小复现、单个假设、证伪条件、命令、证据路径。
2. 先跑最小命令，再扩大矩阵。
3. 30-45 分钟没有新增证据时，暂停改代码并检索 Playwright、Chrome extension、CDP 或相关上游 issue。
4. 每轮结束只做一个决策：继续缩小、改一个点、或停止并更新 `.claude/HANDOFF.md`。

## 常用命令

```powershell
cmd /c npm.cmd run test:helpers
cmd /c npm.cmd run test:smoke
cmd /c npm.cmd run test:smoke:headless
cmd /c npm.cmd run test:all
cmd /c npm.cmd run test:chrome:launch
cmd /c npm.cmd run test:live:setup
cmd /c npm.cmd run test:live:core
cmd /c npm.cmd run test:live:gpt
cmd /c npm.cmd run test:live:deepseek
cmd /c npm.cmd run test:live -- Gemini Doubao
cmd /c npm.cmd run test:live:chromium
```

Advanced 附件验证命令：

```powershell
cmd /c npm.cmd run release:advanced
cmd /c npm.cmd run test:chrome:launch:advanced
node scripts\test_attachment.mjs ChatGPT Gemini Grok Doubao DeepSeek
```

真正五模型文本群发验证命令：

```powershell
cmd /c npm.cmd run test:live:group
```

Windows 双击 / 命令行友好入口：

```powershell
.\test-all.cmd
.\test-chrome-launch.cmd
.\test-live-setup.cmd
.\test-live-core.cmd
.\test-live-gpt.cmd
.\test-live-deepseek.cmd
.\test-live-chromium.cmd
```

## attach-mode live 的行为

- `test:live`、`test:live:core`、`test:live:gpt` 默认都走真实 Chrome 附着模式
- 它们只会清理扩展自己的 `chrome.storage.local`
- 不会清理你的浏览器 cookies
- 不会清理站点 local storage
- 不需要每次重新登录

只有这些情况才需要重新处理登录：

1. 登录态过期
2. 你手动退出了某个站点
3. 你主动删除、重建或更换了 `tools/browser-profile/chrome-user-data`

## bundled chromium 回退链路

下面这些命令仍然保留，方便排查扩展自身问题：

- `test:profile:init`
- `test:profile:open`
- `test:live:chromium`

它们继续使用仓库里的持久化测试 Profile：

- `tools/browser-profile/chrome-user-data`

这条链路更适合 smoke / 扩展链路调试，不适合作为 Google 登录主路径。

## Live 结果分类

live 脚本会把结果写到：

- `output/playwright/live/live.log`
- `output/playwright/live/results.json`

状态值固定为：

- `ok`
- `blocked_by_verification`
- `not_logged_in`
- `ui_not_ready`
- `adapter_failed`
- `broadcast_failed`

如果失败，还会保留：

- 当前模型页面截图
- 当前模型页面 HTML

回退链路 `test:live:chromium` 的产物会写到：

- `output/playwright/live-chromium/`

## 常见问题

### 提示 CDP endpoint 不可用

说明你还没先启动真实 Chrome 测试会话。先执行：

```powershell
.\test-chrome-launch.cmd
```

或者：

```powershell
cmd /c npm.cmd run test:chrome:launch
```

### 同时有多个远程调试 Chrome

不要只看到某个 CDP endpoint 能响应就继续。先确认端口和 profile：

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object { $_.CommandLine -match 'remote-debugging-port=(9222|9333)' } |
  Select-Object ProcessId, CommandLine
```

AI-RoundTable Advanced 附件验证必须连到 `tools/browser-profile/chrome-user-data-advanced` 和 `output/advanced-release/AI-RoundTable-advanced`。如果 `9222` 属于别的项目（例如上传后台 profile），不要碰它；使用 Advanced 启动入口：

```powershell
cmd /c npm.cmd run test:chrome:launch:advanced
```

`test:live`、`test:live:group` 和 `test_attachment.mjs` 会读取 `chrome://version` 校验端口和 profile；校验失败时要先修正浏览器会话，不要继续测试。

### 附件结果怎么算成功

带附件群发只在 `attachmentResults[]` 同时满足以下字段时，才算自动附件上传成功：

```text
attachmentStatus = supported
method = cdp_advanced
code = attachment_cdp_uploaded
```

这些都不能算附件成功：

- `manual_required`
- `text_fallback`
- `attachment_upload_failed`
- 模型回复了文字但没有上述附件结果字段

### 附件群发怎么缩小范围

附件群发按层级验证，不要直接跑全量矩阵：

1. 能力判断层：helper 测试和 `attachmentResults[]` 状态正常。
2. Advanced 包层：刚运行 `release:advanced`，并确认 9333、Advanced profile、Advanced unpacked 包一致。
3. 单模型附件层：一个模型、一个小文件、一个输入，证明上传或明确降级原因。
4. 双模型群发层：确认群发编排没有吞掉附件状态。
5. 五模型矩阵层：最后再跑 ChatGPT、Gemini、Grok、Doubao、DeepSeek。

### 提示扩展没有加载

说明当前专用 attach profile 里还没有把这个仓库作为 unpacked extension 加进去。
去 `chrome://extensions` 手动 `Load unpacked` 一次即可。

### PowerShell 拦截 npm.ps1

优先用：

- `npm.cmd`
- 这里附带的 `.cmd` 包装脚本

不需要为了跑这些命令先改 PowerShell 执行策略。

## 产物目录

- `output/playwright/smoke/`
- `output/playwright/live/`
- `output/playwright/live-chromium/`
- `output/playwright/profile-open/`
- `output/playwright/smoke-user-data/`

## 环境变量

可覆盖的关键变量：

- `AI_RT_PLAYWRIGHT_CHANNEL`
- `AI_RT_CHROME_EXE`
- `AI_RT_CHROME_USER_DATA_SOURCE`
- `AI_RT_CHROME_PROFILE_NAME`
- `AI_RT_CDP_PORT`
- `AI_RT_TEST_PROFILE_DIR`

例子：

```powershell
$env:AI_RT_CDP_PORT = "9333"
$env:AI_RT_CHROME_PROFILE_NAME = "Profile 7"
cmd /c npm.cmd run test:chrome:launch
```
