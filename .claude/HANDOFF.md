# HANDOFF - AI-RoundTable

## TL;DR

Gemini single-model/single-file Advanced attachment upload is now live-proven. Do not generalize this to ChatGPT, Grok, Doubao, or DeepSeek yet. The proven Gemini path uses CDP file chooser interception, not a persistent `input[type="file"]`. Daily Chrome remains unproven because that browser is not CDP-controllable; use the in-panel Gemini attachment diagnostics if the user's daily Chrome still disagrees with the 9333 proof.

## Current Stop Line

Latest user direction: continue fixing the attachment issue, research the method first, and keep git staging ready for frequent iteration.

## Debugging Packet

- Symptom: attachment group broadcast could send fallback text but did not prove file upload.
- Success criteria: `attachmentResults[]` must contain `attachmentStatus=supported`, `method=cdp_advanced`, and `code=attachment_cdp_uploaded`.
- Browser line: Advanced local only, CDP `9333`, profile `tools/browser-profile/chrome-user-data-advanced`, package `output/advanced-release/AI-RoundTable-advanced`.
- Minimal repro used: Gemini only, one tiny PNG fixture, one normal prompt.
- Root cause: Gemini currently opens a native file chooser from its upload menu and does not leave a stable `input[type="file"]` in the DOM for `DOM.querySelector`.
- Implemented fix: Gemini returns `inputMode=file_chooser`; background uses `Page.setInterceptFileChooserDialog` + `Page.fileChooserOpened.backendNodeId` + `DOM.setFileInputFiles`; preuploaded readiness can be detected from visible file previews.
- Follow-up root cause from daily Chrome screenshot: some Gemini UI variants leave the upload menu open with a visible `上传文件` menu item that has text but no matching aria label/hidden selector. The CDP trigger now also targets visible menu items by text (`上传文件` / Upload file) and excludes Drive/cloud entries.
- Follow-up root cause from daily Chrome diagnostics JSON: Gemini history/conversation action buttons can contain old prompt text with words like `附件` / `PDF` / `上传`, so the adapter could click a historical `更多选项` (`more_vert`, `gem-conversation-actions-menu-button`) instead of the composer upload menu. The Gemini trigger now excludes those history action menus and prioritizes the visible composer `上传和工具` / plus button.
- Follow-up root cause from the next daily Chrome diagnostics JSON: the Gemini upload menu can already be open and expose `上传文件` plus hidden local upload triggers. `prepareAttachmentInput()` must not click Gemini's upload UI before returning the CDP trigger expression, because `Page.setInterceptFileChooserDialog` is enabled only after prepare returns. The adapter now checks for an existing static file input only, then lets the CDP trigger open/click the upload menu under interception; it waits for the visible `上传文件` menu item before falling back to hidden file triggers.
- Follow-up root cause from the 9333 PDF run: Gemini had accepted the PDF and started responding, but the adapter missed Gemini's newer visible busy response panel (`aria-busy="true"`) and misclassified the send as `send_not_confirmed`. The Gemini generation detector now treats visible busy response panels as send confirmation.
- Daily Chrome diagnostic path: the side panel now has `诊断 Gemini 附件`, which asks the extension to sample upload-related DOM in the current Gemini tab and copy a privacy-limited JSON payload. If only the composer plus button is visible, the diagnostic actively clicks `上传和工具` once and resamples so the JSON can show whether `上传文件` / hidden local triggers appear.
- Saved static Gemini HTML is not enough to debug the runtime upload menu. The user's saved `页面另存html\探索周边环境的建议 - Google Gemini.html` retained `上传和工具`, `mat-mdc-menu`, and `cdk-overlay` fragments, but not `上传文件`, `hidden-local-*`, `xapfileselectortrigger`, or `input[type=file]`; use live diagnostics instead.
- Safety guard: CDP injection accepts only file paths returned by the current `stageAdvancedAttachments()` call via `allowedFilePaths`; it must not accept arbitrary local paths.

## Working Tree

Relevant source/test files in the current attachment repair:

- `src/background/advanced_attachment_service.mjs`
- `src/background/gemini_attachment_diagnostics.mjs`
- `src/background/model_tab_selection.mjs`
- `src/background/service_worker.js`
- `src/content/adapter_base.js`
- `src/content/adapter_gemini.js`
- `src/sidepanel/panel.html`
- `src/sidepanel/panel.js`
- `tests/advanced_attachment_service.test.mjs`
- `tests/adapter_preuploaded_attachment.test.mjs`
- `tests/gemini_attachment_diagnostics.test.mjs`
- `tests/gemini_adapter.test.mjs`
- `tests/attachment_live_script.test.mjs`
- `output/advanced-release/AI-RoundTable-advanced/...`
- `output/advanced-release/release-report.json`

Other pre-existing modified files are still in the worktree. Before staging, use `git status --short` and `git diff -- <files>`; stage only task-related files. Do not stage untracked `tools/`.

## Browser Boundary

Correct AI-RoundTable Advanced live line:

- CDP port: `9333`
- profile: `tools/browser-profile/chrome-user-data-advanced`
- extension package: `output/advanced-release/AI-RoundTable-advanced`
- launcher: `cmd /c npm.cmd run test:chrome:launch:advanced`

Do not touch port `9222`; it belongs to the Danaher upload project in this machine context.

## Verified Evidence

Fresh verification from this continuation:

- `node tests\advanced_attachment_service.test.mjs` passed, 10/10.
- `node tests\adapter_preuploaded_attachment.test.mjs` passed, 5/5.
- `node tests\gemini_adapter.test.mjs` passed, 6/6.
- `node tests\attachment_live_script.test.mjs` passed, 11/11.
- `node tests\gemini_attachment_diagnostics.test.mjs` passed, 5/5.
- After the daily Chrome screenshot fix, `node tests\gemini_adapter.test.mjs`, `node tests\adapter_preuploaded_attachment.test.mjs`, `node tests\attachment_live_script.test.mjs`, and `node tests\manifest_models.test.mjs` passed.
- `cmd /c npm.cmd run release:advanced` passed.
- `cmd /c npm.cmd run test:chrome:launch:advanced` verified the running Advanced runtime on `9333`.
- `node scripts\test_attachment.mjs Gemini --file "C:\Users\xiepro\Desktop\附件5.pdf"` passed against `https://gemini.google.com/app`. Evidence: `output/playwright/attachment-test/attachment.log`.
- In the latest live Gemini result, `attachmentResults[0]` was `supported / cdp_advanced / attachment_cdp_uploaded`; timestamp in log: `2026-05-30T01:10:16.988Z`.
- `cmd /c npm.cmd run test:helpers` passed.
- After the daily Chrome diagnostics JSON fix, `node tests\gemini_adapter.test.mjs` passed 6/6, `node tests\gemini_attachment_diagnostics.test.mjs` passed 5/5, and `cmd /c npm.cmd run test:helpers` passed.
- `cmd /c npm.cmd run release:advanced` passed after the diagnostics JSON fix and rebuilt `output/advanced-release/AI-RoundTable-advanced`.
- `node scripts\test_attachment.mjs Gemini --file "C:\Users\xiepro\Desktop\附件5.pdf"` passed again on Advanced CDP `9333`; evidence: `output/playwright/attachment-test/attachment.log`.
- In that latest live Gemini result, `attachmentResults[0]` was `supported / cdp_advanced / attachment_cdp_uploaded`; timestamp in log: `2026-05-30T01:47:06.933Z`.
- After the prepare/interception-order fix, `node tests\gemini_adapter.test.mjs` passed 6/6, `node tests\gemini_attachment_diagnostics.test.mjs` passed 5/5, and `cmd /c npm.cmd run test:helpers` passed.
- `cmd /c npm.cmd run release:advanced` rebuilt the Advanced package after the prepare/interception-order fix.
- `node scripts\test_attachment.mjs Gemini --file "C:\Users\xiepro\Desktop\附件5.pdf"` passed again on a freshly restarted Advanced CDP `9333` instance after the final visible-first trigger tightening; latest `attachmentResults[0]` was `supported / cdp_advanced / attachment_cdp_uploaded`; timestamp in log: `2026-05-30T02:07:18.079Z`.
- After adding active diagnostics and structured CDP trigger/readiness detail, `node tests\gemini_attachment_diagnostics.test.mjs`, `node tests\adapter_preuploaded_attachment.test.mjs`, `node tests\advanced_attachment_service.test.mjs`, `node tests\gemini_adapter.test.mjs`, `node tests\attachment_live_script.test.mjs`, and `cmd /c npm.cmd run test:helpers` passed.
- `cmd /c npm.cmd run release:advanced` rebuilt the Advanced package with the new diagnostics.
- `node scripts\test_attachment.mjs Gemini --file "C:\Users\xiepro\Desktop\附件5.pdf"` passed on Advanced CDP `9333`; latest `attachmentResults[0]` was `supported / cdp_advanced / attachment_cdp_uploaded`; timestamp in log: `2026-05-30T02:38:32.122Z`. The response now includes `cdpUpload.trigger.target.text="上传文件"` and visible `previewCandidates`, which is the key evidence if daily Chrome disagrees.

External method check used:

- Playwright file chooser docs support the dynamic file chooser approach.
- Chrome DevTools Protocol supports `Page.setInterceptFileChooserDialog`, `Page.fileChooserOpened`, and `DOM.setFileInputFiles`.

Cheap Council:

- Call id: `call_20260529_152239_d4ef3487`.
- Parser failed, but raw review usefully flagged path allowlist and timeout/cleanup risks; feedback recorded as partial.

## Not Proven

- Five-model attachment group broadcast is not proven.
- ChatGPT, Grok, Doubao, and DeepSeek automated attachment upload remain unproven and should stay conservative/manual unless each gets its own minimal live proof.
- The user's daily Chrome page is not yet proven. Current machine evidence shows daily Chrome has no `--remote-debugging-port`; Codex cannot inspect that live DOM directly without either a new debug-enabled Chrome launch or the in-panel diagnostic JSON.
- A model text reply is still not proof of upload.

## Next Safe Steps

1. If the user tests in daily Chrome, ask them to reload the unpacked extension in `chrome://extensions`, refresh/open a fresh `https://gemini.google.com/app` tab, keep it active, and test Gemini only.
2. If daily Chrome still fails, use the side-panel `诊断 Gemini 附件` button and inspect the copied JSON before changing selectors again.
3. If expanding beyond Gemini, follow the matrix in `docs/debugging-convergence.md`: single model, single file first; then dual model; then five-model matrix.
4. Do not run `node scripts\test_attachment.mjs ChatGPT Gemini Grok Doubao DeepSeek` as proof until each non-Gemini model has a documented capability path or expected manual fallback.

## Do Not Do

- Do not claim attachment success from fallback text.
- Do not enable Advanced CDP capabilities for other models without model-specific live evidence.
- Do not use or kill the `9222` Danaher Chrome.
- The user has clarified this repo should use commits as rollback anchors after verified iteration checkpoints; do not stop at staged-only when the scope is clear and tests have passed. Still do not pull, push, or run destructive rollback/history-editing commands without explicit confirmation.
