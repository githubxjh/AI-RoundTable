# 自迭代与真实浏览器验证

这个仓库应该能形成一条很紧的工程循环：

```text
检查 -> 修改 -> helper 测试 -> smoke 浏览器检查 -> 真实 Chrome attach 检查 -> 产物 -> 交接
```

目标不是盲目自动化，而是做有证据的迭代。能跑的安全检查就跑，遇到登录、验证、验证码、2FA 或站点阻断时，就清楚停下并说明原因。

当前默认产品线是 Lite/public。Advanced/local 附件验证已暂停为内部实验资料；除非用户明确要求恢复附件方向，日常自迭代不要跑 Advanced 包、Advanced Chrome 或附件 live。

## 调试收敛闸门

当问题涉及真实站点、群发、附件、CDP、Chrome profile 或模型适配器时，先按 `docs/debugging-convergence.md` 收敛，不要边猜边改。

每一轮调试都必须留下：

- 最小失败样本。
- 字段级成功标准。
- 当前只验证的一个假设。
- 本轮命令和证据路径。
- 结果出来后的下一步决策。

如果 30-45 分钟没有新增证据，或者同一假设连续失败两次，先停下来外查官方文档、上游 issue 或成熟项目，再决定是否继续实现。

## 日常本地循环

普通代码或 UI 修改后，用这个命令：

```powershell
cmd /c npm.cmd run iterate
```

它会跑：

1. `test:helpers`
2. `test:smoke:headless`

结果会写到：

- `output/playwright/iteration/last-run.json`
- `output/playwright/iteration/last-run.md`

如果本地 Playwright 浏览器还没装好，先装 Chromium：

```powershell
cmd /c npx.cmd playwright install chromium
```

如果这个安装被锁住或还在跑，可以先用只跑 helper 的循环：

```powershell
cmd /c npm.cmd run iterate -- --skip-smoke
```

这条路仍然会验证 Node helper / 回归测试，并写出迭代摘要，但不能证明扩展 UI 已经能在 Playwright 里启动。

## 真实 Chrome Attach 循环

当改动影响 live 模型适配器、发送、附件、router，或者任何依赖真实 AI 网站的行为时，用这个流程：

### 手动登录专用 profile

Google 登录不要放在自动化浏览器里完成。Google 可能会拦截带 `--remote-debugging-port` 或由自动化工具控制的浏览器，所以正确做法是先用同一个专用 profile 手动登录，再切换到 attach 模式测试。

第一次准备或登录态失效时：

1. 确认普通 Chrome 和测试 Chrome 都已经关闭。
2. 用不带 CDP 的方式打开专用 profile，例如：

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$userData = (Resolve-Path "tools\browser-profile\chrome-user-data").Path
Start-Process -FilePath $chrome -ArgumentList @(
  "--user-data-dir=$userData",
  "--profile-directory=Default",
  "--new-window",
  "--no-first-run",
  "--no-default-browser-check",
  "https://accounts.google.com/",
  "https://chatgpt.com/",
  "https://gemini.google.com/",
  "https://grok.com/",
  "https://www.doubao.com/",
  "https://chat.deepseek.com/"
)
```

3. 在打开的窗口里手动完成 Google / ChatGPT / Gemini / Grok / Doubao / DeepSeek 登录。
4. 登录完成后，把这个 Chrome 窗口全部关闭。
5. 再启动 attach 模式：

```powershell
cmd /c npm.cmd run test:chrome:launch
```

在 attach 模式打开的 Chrome 窗口里：

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 如果还没有加载这个仓库，就把它作为 unpacked extension 加载进去。
4. 不要在这里尝试新的 Google 登录；如果跳到登录、验证码、2FA 或账号恢复页，停止测试并记录原因。

然后再跑：

```powershell
cmd /c npm.cmd run iterate:live
```

跑真实群发 live 前，先确认当前 attach Chrome 是正确浏览器，而不是别的项目占用的 CDP 端口。普通文本 live 和暂停的 Advanced 附件 live 的 profile 不同：

- 普通文本 live：`tools\browser-profile\chrome-user-data`
- Advanced 附件 live（暂停，仅显式恢复实验时）：`tools\browser-profile\chrome-user-data-advanced`

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object { $_.CommandLine -match 'remote-debugging-port=(9222|9333)' } |
  Select-Object ProcessId, CommandLine
```

如果用户明确要求恢复 Advanced 附件实验，先运行：

```powershell
cmd /c npm.cmd run release:advanced
cmd /c npm.cmd run test:chrome:launch:advanced
```

Advanced 命令行必须指向 `tools\browser-profile\chrome-user-data-advanced`，并加载 `output\advanced-release\AI-RoundTable-advanced`。如果 `9222` 指向别的项目，例如 `D:\丹纳赫实施资料上传\.chrome-upload-profile`，不要关闭它，也不要把它当成 AI-RoundTable 证据。没有明确恢复实验请求时，不要运行这些命令。

如果未来明确恢复 Advanced 附件矩阵，不要只打开其中一两个模型页；先把目标模型页都准备好。例如测 ChatGPT / Doubao 附件，同时保留 DeepSeek 登录态检查时，要确认当前 Advanced attach 浏览器下至少有 `https://chatgpt.com/`、`https://www.doubao.com/chat/`、`https://chat.deepseek.com/` 三个标签页。

更窄的 live 矩阵：

```powershell
cmd /c npm.cmd run iterate -- --live --models=Gemini,Doubao
cmd /c npm.cmd run iterate -- --live ChatGPT
```

如果想一条命令先起 attach Chrome，再跑 live：

```powershell
cmd /c npm.cmd run iterate -- --launch-chrome
```

如果 Chrome 已经在运行、扩展没加载好，或者站点需要手动登录，这条流程仍然会停。

2026-05-23 的验证结论：按“手动登录专用 profile -> 关闭窗口 -> attach 模式复用 profile”流程，ChatGPT、Grok、Gemini、Doubao、DeepSeek 的登录态都能在真实 Chrome attach 测试里复用。证据保存在 `output/playwright/login-preflight/` 和 `output/playwright/live/`。

## 停止条件

遇到这些情况时，应该停下来并上报，而不是硬推自动化：

- 登录或账号恢复
- 验证码或人工验证
- 2FA
- 账号被封、限流或反自动化警告
- 动作有破坏性但不清楚
- 会暴露私人账号数据的意外提示

live 结果应该把阻断原因分类出来，而不是假装成功。

## 证据路径

证据继续放在现有产物目录：

- `output/playwright/smoke/`
- `output/playwright/live/`
- `output/playwright/live-chromium/`
- `output/playwright/iteration/`

常看的 live 文件：

- `output/playwright/live/live.log`
- `output/playwright/live/results.json`
- 失败时保留的模型页截图和 HTML

## 交接要求

做完一段有意义的工作后，更新 `.claude/HANDOFF.md`，写清：

- 改了什么
- 跑了哪些测试
- 证据放在哪里
- 已知阻塞点
- 下一步可验证目标

不要自己编一个“干净状态”。如果测试因为环境问题被跳过或失败，要直接写出来。

## 压缩续接要求

这个项目的上下文很容易在压缩后丢失，尤其是浏览器端口、profile、扩展包、附件结果字段。长任务中只要进入以下任一情况，就先更新 `.claude/HANDOFF.md`：

- 用户说“继续”但上一轮已经做了多步修改。
- 准备跑真实 Chrome、群发或附件 live。
- 准备从排查切到改代码。
- 用户要求暂停功能修复，先补规范或交接。
- 对话明显快被压缩。

具体格式按 `docs/agent-continuity.md`。最重要的是写清：

- 当前停止线，也就是最新用户指令。
- 哪些文件是自己刚改的，哪些是前一轮留下的。
- 正确浏览器线：普通 live 还是 Advanced live。
- 已经跑过的命令和证据路径。
- 没有证明的事，尤其是附件是否真上传。

如果没有重新跑验证，不要把旧证据写成“刚刚验证通过”。
