# 自迭代与真实浏览器验证

这个仓库应该能形成一条很紧的工程循环：

```text
检查 -> 修改 -> helper 测试 -> smoke 浏览器检查 -> 真实 Chrome attach 检查 -> 产物 -> 交接
```

目标不是盲目自动化，而是做有证据的迭代。能跑的安全检查就跑，遇到登录、验证、验证码、2FA 或站点阻断时，就清楚停下并说明原因。

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

```powershell
cmd /c npm.cmd run test:chrome:launch
```

在打开的 Chrome 窗口里：

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 如果还没有加载这个仓库，就把它作为 unpacked extension 加载进去。
4. 只在需要时登录对应模型站点。

然后再跑：

```powershell
cmd /c npm.cmd run iterate:live
```

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
