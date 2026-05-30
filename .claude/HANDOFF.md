# HANDOFF - AI-RoundTable

## TL;DR

Current product direction is Lite-first. The user decided to pause unified attachment upload and Advanced/local attachment work for the next few months. Do not change Advanced code, rebuild Advanced packages, or run Advanced live attachment tests unless the user explicitly reopens that line. Treat attachments as not user-facing; prioritize the Lite/public extension, stable text broadcast, review/routing flow, and low-permission sharing.

## Current Stop Line

Latest user direction on 2026-05-30: no need to keep changing the Advanced version for attachment hiding; update the project documents so development focus moves fully to Lite/public, because the more complex Advanced version likely will not be touched for the next few months.

## Working Tree

- Current task scope: documentation and public release README template text only.
- Do not stage: `tools/browser-profile/chrome-user-data-advanced/...` profile/cache/session changes from earlier live Chrome testing.
- Last completed code anchor before this docs update: `de9d7f9 fix: strictly block unconfirmed attachments`.

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

## Not Proven

- Unified attachment upload is not product-ready.
- Five-model attachment broadcast is not proven.
- ChatGPT, Grok, Doubao, and DeepSeek automated attachment upload remain unproven.
- Gemini Advanced had previous CDP evidence, but that does not make daily Chrome or Lite/public attachment upload ready for users.

## Next Safe Steps

1. Keep Lite/public as the default build, docs, and test target.
2. For user-facing docs or release notes, say attachments are currently not supported for automatic broadcast; advise users to paste important content directly into the prompt.
3. If future attachment work returns, start with a new explicit plan and decide whether Lite-side text extraction is better than Web UI file upload automation.
4. Before committing, stage only the current documentation/release-note text files and leave `tools/browser-profile/...` untouched.

## Do Not Do

- Do not advertise Advanced as the recommended package for colleagues.
- Do not imply attachment upload will silently fall back to pure text.
- Do not restart Advanced attachment debugging without an explicit user request.
- Do not claim attachment success from model replies, UI appearance, or old memory.
- Do not use destructive Git cleanup to remove Chrome profile noise.
