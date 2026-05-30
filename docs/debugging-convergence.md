# 调试收敛与附件群发复盘

这个文档用于处理最容易失焦的任务：真实 Chrome、live AI 站点、多模型群发、附件上传、CDP 注入、生成扩展包同时参与的问题。目标不是让 agent 更努力，而是让调试循环更快收敛。

## 背景

2026-05-28 的附件加文字群发问题暴露了流程风险：一个文件无法群发时，排查同时跨过了群发编排、模型适配器、Advanced 权限、CDP 文件注入、浏览器 profile、端口归属、站点 UI 和成功判定。只要这些变量没有拆开，花 3 小时也可能只是在扩大不确定性。

这类问题必须先证明“卡在哪一层”，再讨论怎么修。

## 非目标

- 不把模型回复当成附件上传成功。
- 不在 Lite/public 和 Advanced/local 两条线之间互相证明。
- 不在没有正确 profile、端口、扩展包的情况下跑 live 结论。
- 不为了追进度同时改多个假设点。
- 带附件发送默认严格阻断：附件未确认上传时，不自动改发纯文本。纯文本降级只能作为未来显式用户选项重新设计。

## 收敛闸门

进入 live、附件、群发或模型适配器修复前，先写清下面 8 件事。可以写在 `.claude/HANDOFF.md`、任务说明、或本地复盘记录里，但不能只留在聊天上下文里。

1. 现象：用户可见的问题是什么，在哪些模型、哪些输入、哪些附件上出现。
2. 成功标准：字段级定义。附件成功必须来自 `attachmentResults[]`，不是模型文字回复。
3. 浏览器边界：当前使用普通 live 还是 Advanced live，端口、profile、扩展包路径分别是什么。
4. 最小失败样本：先单模型、单文件、单动作复现；不要一上来跑五模型全矩阵。
5. 当前假设：每轮只验证一个假设，并写出它会被哪个结果证伪。
6. 验证命令：本轮只跑一个最小但有意义的命令，记录完整命令和产物路径。
7. 证据产物：保存 `output/playwright/` 下的 log、JSON、截图、HTML，或者说明为什么拿不到。
8. 下一步决策：结果出来后只做三选一：继续缩小、改一个点、或停止并外查。

## 附件群发最小矩阵

附件群发不能直接从“全模型群发”开始。按下面顺序升阶，前一层没有证据时不要进入下一层。

1. 能力判断层：`attachment_capabilities` 和 `attachmentResults[]` 状态是否符合预期。
2. Advanced 包层：刚运行过 `release:advanced`，并确认 9333、`chrome-user-data-advanced`、`output/advanced-release/AI-RoundTable-advanced` 一致。
3. 单模型附件层：只测一个模型、一个小文件、一个输入，证明 `attachment_cdp_uploaded` 或明确阻断原因。
4. 双模型群发层：一个已证明可上传的模型，加一个目标模型，确认群发编排没有吞掉附件状态。
5. 五模型矩阵层：只有前四层都清楚时，才跑 ChatGPT、Gemini、Grok、Doubao、DeepSeek 全量。

如果某层失败，修复和验证都留在这一层，不要跳到更大矩阵里猜。

## 单轮调试记录模板

```markdown
## Debugging Packet

- Symptom:
- Success criteria:
- Browser line:
- Minimal repro:
- Hypothesis:
- Falsifier:
- Command:
- Evidence:
- Result:
- Decision:
```

`Hypothesis` 必须具体到一个可证伪判断，例如“Gemini 的文件 input 存在但 CDP 注入路径没有命中”，而不是“附件不稳定”。

## 外部检索触发条件

满足任一条件时，先停下来检索官方文档、成熟项目或 issue，不要继续闭门猜：

- 30-45 分钟内没有新增证据，只是在换实现写法。
- 问题落在 Playwright、Chrome extension、MV3 service worker、`chrome.debugger`、CDP、文件 input、站点反自动化边界上。
- 本地代码没有清晰既有模式。
- 同一假设失败两次，但没有新的反证解释。
- live 站点 UI 或权限行为和本地 fixture 不一致。

检索结论要分清三类：

- 外部事实：官方文档或上游 issue 明确说明的行为。
- 本项目推断：根据 AI-RoundTable 架构做出的判断。
- 待验证假设：还需要本地命令或 live 证据证明。

## 停止条件

遇到这些情况，停止继续修功能，先更新 `.claude/HANDOFF.md`：

- 发现连接到了错误 CDP 端口或错误 profile。
- 需要登录、验证码、2FA、账号恢复或站点安全验证。
- 生成包可能不是最新，且没有重新运行 `release:advanced`。
- 不能说明当前失败处于矩阵的哪一层。
- 连续两轮调试没有新增证据。
- 对话可能压缩，或者用户要求先补工程规范。

## 完成标准

一个 live/附件/群发问题只有在下面条件满足时，才可以说“已验证”：

- 有明确的最小复现和最终验证命令。
- 有 `output/playwright/` 下的证据路径。
- 附件成功字段满足 `attachmentStatus=supported`、`method=cdp_advanced`、`code=attachment_cdp_uploaded`。
- 如果是阻断或手动上传，最终报告明确说是阻断/手动，不写成成功，也不写成已纯文本发送。
- `.claude/HANDOFF.md` 写清已证明和未证明事项。
