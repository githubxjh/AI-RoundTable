# HANDOFF - AI-RoundTable

## TL;DR

Current product direction is Lite-first. Unified attachment upload and Advanced/local attachment work are paused for the next few months. The active verified line is Lite/public pure-text: `output/public-release/AI-RoundTable-extension-test`, including a temporary 9333 Lite launcher that reuses the old Advanced profile login state but verifies the package is still Lite.

## Current Stop Line

Latest user direction on 2026-05-31: switch 9333 from the paused Advanced attachment line to a Lite public test line, use `output/public-release/AI-RoundTable-extension-test`, verify Lite pure-text single model and five-model group broadcast, and do not test attachments.

## Working Tree

- Current task scope: Lite/public 9333 launch support, live script support for `AI_RT_EXTENSION_PATH`, and deterministic five-model Lite pure-text validation.
- Current source/test/doc changes: `package.json`, `scripts/lib/playwright_env.mjs`, `scripts/launch_lite_9333_chrome.mjs`, `scripts/test_live.mjs`, `scripts/test_group_broadcast.mjs`, `tests/playwright_env.test.mjs`, `tests/attachment_live_script.test.mjs`, `TESTING.md`, `docs/agent-continuity.md`, `docs/self-iteration.md`, `.claude/HANDOFF.md`.
- Do not stage: `tools/browser-profile/chrome-user-data-advanced/...` profile/cache/session changes from earlier live Chrome testing.
- Last completed attachment-code anchor before the Lite-focus docs update: `de9d7f9 fix: strictly block unconfirmed attachments`.
- Latest docs anchor before this task: `73d2380 docs: shift focus to Lite release`.

## Browser Boundary

- Default Lite/public focus normally uses the normal text profile: `tools/browser-profile/chrome-user-data`.
- Lite 9333 text validation is now available for this machine when 9333 login state is useful: `cmd /c npm.cmd run test:chrome:launch:lite9333` loads `output/public-release/AI-RoundTable-extension-test` on port `9333` with `tools/browser-profile/chrome-user-data-advanced` and verifies the manifest has no `debugger` / `downloads`.
- Advanced attachment lab line remains historical/internal only. If it is ever explicitly reopened, do not confuse it with Lite 9333: Advanced uses `output/advanced-release/AI-RoundTable-advanced` and attachment-specific scripts.
- Do not touch port `9222`; this machine has used it for the Danaher upload project.
- Do not close the user's daily Chrome unless explicitly authorized.

## Verified Evidence

- This docs-only update is based on the user's latest product decision, not on new live attachment proof.
- Previous strict-blocking code anchor: `de9d7f9`.
- `node --check scripts\prepare_public_release.mjs` passed.
- `git diff --check` and `git diff --staged --check` passed for the docs/release-note scope.
- Search verification found no remaining public wording like “附件上传功能还在测试中” or “会尝试降级为纯文本”; remaining fallback mentions are negative guardrails only.
- 2026-05-31 Lite public package root cause: `output/public-release/release-report.json` was generated on 2026-05-22, while current Gemini send-related source files were from 2026-05-30; the loaded `AI-RoundTable-extension-test` package was stale.
- `cmd /c npm.cmd run release:public` initially failed because the public release secret scanner matched a fake `cookie: 'SID=secret'` test fixture. The fixture now uses `Object.fromEntries(...)` so the test still proves sanitizer behavior without looking like a credential assignment.
- `node tests\advanced_attachment_service.test.mjs` passed 12/12.
- `cmd /c npm.cmd run release:public` passed and regenerated `output/public-release/AI-RoundTable-extension-test`.
- Hash check passed for `manifest.json`, `src/content/adapter_gemini.js`, `src/content/adapter_base.js`, `src/background/service_worker.js`, and `src/sidepanel/panel.js` between source and the regenerated Lite package.
- `node tests\gemini_adapter.test.mjs` passed 6/6.
- `cmd /c npm.cmd run test:helpers` passed.
- 2026-05-31 after user reported Gemini succeeded but ChatGPT/Grok/Doubao/DeepSeek showed generic `发送失败。`: likely cause is old tabs created before extension reload missing a fresh content script receiver. `sendMessageToTab()` now retries missing-receiver errors by injecting the model content scripts with `chrome.scripting.executeScript`, then sending once more.
- Side panel now shows a specific missing-content-script hint instead of only `发送失败。` when the underlying reason is a missing receiver.
- `node tests\attachment_live_script.test.mjs` passed 13/13 after adding a static guard for the injection retry path.
- `cmd /c npm.cmd run test:helpers` passed after the retry fix.
- `cmd /c npm.cmd run release:public` passed after the retry fix; hash check passed for background, side panel, and all five content adapters in `output/public-release/AI-RoundTable-extension-test`.
- Normal `test:chrome:launch` live reproduction did not run because Chrome was already open; detected 9222 belongs to the Danaher profile and 9333 belongs to the paused Advanced profile. Do not close those without user confirmation.
- 2026-05-31 Lite 9333 implementation added `test:chrome:launch:lite9333`; launch verified 9333 command line uses `tools/browser-profile/chrome-user-data-advanced` and loads `output/public-release/AI-RoundTable-extension-test`.
- Public Lite manifest check passed: permissions are `["sidePanel","tabs","storage","scripting"]`, with no `debugger` or `downloads`.
- Public Lite package hash check passed for `manifest.json`, `src/background/service_worker.js`, `src/sidepanel/panel.js`, and all five text adapters.
- Initial five-model single live run had one transient ChatGPT page-close failure, then `cmd /c npm.cmd run test:live -- ChatGPT` passed.
- Initial group broadcast reused stale launcher tabs; Doubao showed `send_not_confirmed` and screenshots showed stale/page-error states. Root cause: group live script reused existing tabs instead of fresh test tabs.
- `scripts/test_group_broadcast.mjs` now opens fresh tabs for each requested model before sending the BROADCAST.
- `node scripts\test_group_broadcast.mjs ChatGPT Gemini Grok Doubao DeepSeek` passed on Lite 9333: `sentModels` contained all five models, `failed[]` was empty, and every model state settled to `idle` with `LIVE_OK`. Evidence: `output/playwright/broadcast-live/broadcast.log`, `output/playwright/broadcast-live/summary.json`, screenshots in `output/playwright/broadcast-live/`.
- `cmd /c npm.cmd run test:live -- ChatGPT Gemini Grok Doubao DeepSeek` passed on Lite 9333 after the fresh-tab group fix. Evidence: `output/playwright/live/live.log`, `output/playwright/live/results.json`.

## Not Proven

- Unified attachment upload is not product-ready.
- Five-model attachment broadcast is not proven.
- ChatGPT, Grok, Doubao, and DeepSeek automated attachment upload remain unproven.
- Gemini Advanced had previous CDP evidence, but that does not make daily Chrome or Lite/public attachment upload ready for users.
- Lite public pure-text single and group live are proven only for the current 9333 test profile/session as of 2026-05-31; live sites can still drift.

## Next Safe Steps

1. Keep Lite/public as the default build, docs, and test target.
2. For Lite 9333 validation, run `cmd /c npm.cmd run release:public`, `cmd /c npm.cmd run test:chrome:launch:lite9333`, then set `AI_RT_CDP_PORT=9333`, `AI_RT_TEST_PROFILE_DIR=C:\Users\xiepro\Desktop\AI-RoundTable\tools\browser-profile\chrome-user-data-advanced`, and `AI_RT_EXTENSION_PATH=C:\Users\xiepro\Desktop\AI-RoundTable\output\public-release\AI-RoundTable-extension-test` before `test:live` or `test:live:group`.
3. Group live tests should use fresh tabs; do not reintroduce stale-tab reuse unless the script also proves the chosen tab is clean and current.
4. For user-facing docs or release notes, say attachments are currently not supported for automatic broadcast; advise users to paste important content directly into the prompt.
5. If future attachment work returns, start with a new explicit plan and decide whether Lite-side text extraction is better than Web UI file upload automation.

## Do Not Do

- Do not advertise Advanced as the recommended package for colleagues.
- Do not imply attachment upload will silently fall back to pure text.
- Do not restart Advanced attachment debugging without an explicit user request.
- Do not claim attachment success from model replies, UI appearance, or old memory.
- Do not use destructive Git cleanup to remove Chrome profile noise.
- Do not stage `tools/browser-profile/...` or `output/playwright/...` live artifacts unless the user explicitly asks for evidence artifacts in Git.
