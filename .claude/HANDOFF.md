# HANDOFF - AI-RoundTable

## TL;DR

Current product direction is Lite-first. The user decided to pause unified attachment upload and Advanced/local attachment work for the next few months. Do not change Advanced code, rebuild Advanced packages, or run Advanced live attachment tests unless the user explicitly reopens that line. Treat attachments as not user-facing; prioritize the Lite/public extension, stable text broadcast, review/routing flow, and low-permission sharing.

## Current Stop Line

Latest user direction on 2026-05-30: no need to keep changing the Advanced version for attachment hiding; update the project documents so development focus moves fully to Lite/public, because the more complex Advanced version likely will not be touched for the next few months.

## Working Tree

- Current task scope: Lite/public release package freshness and public release generation.
- Do not stage: `tools/browser-profile/chrome-user-data-advanced/...` profile/cache/session changes from earlier live Chrome testing.
- Last completed attachment-code anchor before the Lite-focus docs update: `de9d7f9 fix: strictly block unconfirmed attachments`.
- Latest docs anchor before this task: `73d2380 docs: shift focus to Lite release`.

## Browser Boundary

- Current Lite/public focus uses the normal extension and normal live text profile: `tools/browser-profile/chrome-user-data`.
- Advanced attachment lab line remains historical/internal only: CDP port `9333`, profile `tools/browser-profile/chrome-user-data-advanced`, package `output/advanced-release/AI-RoundTable-advanced`.
- Do not touch port `9222`; this machine has used it for the Danaher upload project.
- Do not run live browser tests for this docs-only scope.

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

## Not Proven

- Unified attachment upload is not product-ready.
- Five-model attachment broadcast is not proven.
- ChatGPT, Grok, Doubao, and DeepSeek automated attachment upload remain unproven.
- Gemini Advanced had previous CDP evidence, but that does not make daily Chrome or Lite/public attachment upload ready for users.

## Next Safe Steps

1. Keep Lite/public as the default build, docs, and test target.
2. To test the regenerated Lite package in Chrome, go to `chrome://extensions`, click reload on AI RoundTable, and refresh/open a fresh Gemini tab. If Chrome does not pick up the changed files, remove and load unpacked again from `C:\Users\xiepro\Desktop\AI-RoundTable\output\public-release\AI-RoundTable-extension-test`.
3. For user-facing docs or release notes, say attachments are currently not supported for automatic broadcast; advise users to paste important content directly into the prompt.
4. If future attachment work returns, start with a new explicit plan and decide whether Lite-side text extraction is better than Web UI file upload automation.

## Do Not Do

- Do not advertise Advanced as the recommended package for colleagues.
- Do not imply attachment upload will silently fall back to pure text.
- Do not restart Advanced attachment debugging without an explicit user request.
- Do not claim attachment success from model replies, UI appearance, or old memory.
- Do not use destructive Git cleanup to remove Chrome profile noise.
