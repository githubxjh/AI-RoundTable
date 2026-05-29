# HANDOFF - AI-RoundTable

## TL;DR

User approved a docs/process cleanup after the attachment group-broadcast debugging loop failed to converge quickly enough. This pass is documentation-only: improve test/debug workflow and handoff rules, but do not continue live browser testing or attachment feature fixes.

## Current Stop Line

> 可以，改吧，加油

## Working Tree

Docs changed in this continuation:

- `.claude/HANDOFF.md`
- `.claude/STATUS.md`
- `AGENTS.md`
- `CLAUDE.md`
- `TESTING.md`
- `docs/agent-continuity.md`
- `docs/debugging-convergence.md`
- `docs/self-iteration.md`

Git staging scope for this continuation:

- Stage only the process/documentation files above.
- Do not stage the existing source/test/generated-output repair changes unless the user explicitly expands scope.
- Do not stage untracked `tools/`.

Small code/test edits made immediately before the stop line:

- `scripts/lib/playwright_env.mjs`: added `DEFAULT_ADVANCED_CDP_PORT = 9333` and optional `defaultCdpPort`.
- `scripts/launch_advanced_chrome.mjs`: uses Advanced default CDP port and prints the Advanced profile root.
- `tests/playwright_env.test.mjs`: covers Advanced default port.
- `tests/attachment_live_script.test.mjs`: asserts the Advanced launcher uses the dedicated default port.

Existing modified files from the earlier repair thread, not fully reviewed in this continuation:

- `package.json`
- `scripts/launch_real_chrome.mjs`
- `scripts/lib/chrome_attach.mjs`
- `scripts/lib/playwright_env.mjs`
- `scripts/lib/playwright_runtime.mjs`
- `scripts/test_attachment.mjs`
- `scripts/test_live.mjs`
- `src/background/advanced_attachment_service.mjs`
- `src/background/service_worker.js`
- `src/content/adapter_base.js`
- `src/content/adapter_gemini.js`
- `src/content/adapter_gpt.js`
- `src/content/adapter_grok.js`
- `src/utils/attachment_capabilities.mjs`
- multiple tests under `tests/`
- generated Advanced output under `output/advanced-release/`

New files from the earlier repair thread:

- `scripts/launch_advanced_chrome.mjs`
- `scripts/test_group_broadcast.mjs`
- `tests/attachment_live_script.test.mjs`
- `tests/gemini_adapter.test.mjs`
- `tests/grok_adapter.test.mjs`

Unknown/unowned:

- `tools/` is untracked in `git status`. Do not delete it unless the user explicitly asks.

## Browser Boundary

Correct AI-RoundTable Advanced live line:

- CDP port: `9333`
- profile: `tools/browser-profile/chrome-user-data-advanced`
- extension package: `output/advanced-release/AI-RoundTable-advanced`
- launcher: `cmd /c npm.cmd run test:chrome:launch:advanced`

Normal attach/live text line:

- profile: `tools/browser-profile/chrome-user-data`
- launcher: `cmd /c npm.cmd run test:chrome:launch`

Do not touch:

- Port `9222` if it belongs to `D:\丹纳赫实施资料上传\.chrome-upload-profile`.
- Any Chrome process unless its command line clearly contains both the expected AI-RoundTable profile and the expected port.

Before any live claim, verify `chrome://version` or the process command line.

## Verified Evidence

Evidence inherited from the prior repair thread, not rerun after the stop line:

- `node tests\gemini_adapter.test.mjs` passed.
- `node tests\attachment_live_script.test.mjs` passed.
- `node tests\playwright_env.test.mjs` passed.
- `node tests\attachment_capabilities.test.mjs` passed.
- `cmd /c npm.cmd run test:live -- Gemini` passed on `9333`.
- `cmd /c npm.cmd run test:live:group` returned all five models in `sentModels`.
- Group evidence: `output/playwright/broadcast-live/summary.json` and `output/playwright/broadcast-live/broadcast.log`.
- Attachment evidence: `output/playwright/attachment-test/attachment.log`.

Not rerun after the documentation pivot:

- `cmd /c npm.cmd run test:helpers`
- `cmd /c npm.cmd run test:live:group`
- `node scripts\test_attachment.mjs ChatGPT Gemini Grok Doubao DeepSeek`

## Not Proven

- Attachment auto-upload is not proven for ChatGPT, Gemini, Grok, Doubao, or DeepSeek.
- Current conservative runtime reports attachments as `manual_required` or text fallback/degraded.
- A model text reply after an attachment broadcast is not proof that the file uploaded.
- Attachment success requires `attachmentResults[].attachmentStatus === "supported"`, `method === "cdp_advanced"`, and `code === "attachment_cdp_uploaded"`.
- The newest small Advanced-port code/test edits have not been verified with a fresh test run.

## Next Safe Steps

If the user wants only documentation cleanup:

1. Read `docs/agent-continuity.md`, `docs/debugging-convergence.md`, `AGENTS.md`, `TESTING.md`, and `docs/self-iteration.md`.
2. Check whether the debugging packet / convergence gate needs more detail for the next repair.
3. Run no live browser tests unless the user explicitly resumes the repair/testing work.

If the user resumes the original Gemini/group/attachment repair:

1. Run `cmd /c npm.cmd run test:helpers`.
2. Regenerate Advanced package with `cmd /c npm.cmd run release:advanced`.
3. Start the Advanced browser with `cmd /c npm.cmd run test:chrome:launch:advanced`.
4. Run `cmd /c npm.cmd run test:live:group`.
5. Run `node scripts\test_attachment.mjs ChatGPT Gemini Grok Doubao DeepSeek`.
6. Report attachment results strictly from `attachmentResults[]`.

## Do Not Do

- Do not keep fixing functionality while the user has asked to pause and improve handoff norms.
- Do not start another attachment repair without first writing a `Debugging Packet` from `docs/debugging-convergence.md`.
- Do not claim attachment success from text fallback.
- Do not use or kill the `9222` Danaher Chrome.
- Do not rely on the in-app browser at `http://127.0.0.1:9333/` as proof of the real Chrome session.
- Do not assume generated `output/advanced-release/` files are current unless `release:advanced` was just run.
- Do not omit changed generated files from the final status; they are part of the current dirty tree.
- Do not commit, pull, push, or rollback without first reporting staged/unstaged state and getting explicit user intent.
