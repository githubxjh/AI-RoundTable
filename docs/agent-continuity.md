# Agent Continuity Protocol

This project is easy to break by losing context: it depends on real Chrome profiles, live AI sites, generated extension packages, and local-only browser state. Every agent must leave a compact, evidence-backed recovery path before a long task continues or the conversation is likely to be compressed.

## Recovery Order

At the start of a resumed session, read these files in order before touching code:

1. `AGENTS.md`
2. `.claude/STATUS.md`
3. `.claude/HANDOFF.md`
4. `TESTING.md`
5. `docs/self-iteration.md`
6. `package.json`

If the resumed task involves live sites, group broadcast, attachments, CDP, Chrome profiles, or model adapters, also read `docs/debugging-convergence.md` before changing code.

Then inspect `git status --short` and the relevant diff. Do not assume the previous agent finished verification.

## Required Handoff Shape

`.claude/HANDOFF.md` must stay short enough to read in one pass and must include these sections:

- `TL;DR`: one paragraph with the current objective and whether code work is paused or active.
- `Current Stop Line`: the exact newest user instruction that changes scope.
- `Working Tree`: changed files grouped as docs, source, tests, generated output, and unknown/unowned.
- `Browser Boundary`: the correct CDP port, profile directory, extension package path, and what must not be killed.
- `Verified Evidence`: commands that actually ran, exit status, and artifact paths.
- `Not Proven`: claims that are not yet verified, especially attachment upload success.
- `Next Safe Steps`: ordered commands or checks the next agent can run.
- `Do Not Do`: project-specific traps.

If a section has no data, write `None yet` instead of omitting it.

## Compression Rule

Before a task runs long, before starting live browser automation, or before switching from diagnosis to implementation, update `.claude/HANDOFF.md`. A good compression handoff should let the next agent continue without chat history.

Minimum update:

```markdown
## TL;DR
- Current objective:
- Current stop line:
- Last verified command:
- Next safe command:

## Browser Boundary
- Correct port/profile:
- Do not touch:

## Not Proven
- ...
```

## Debugging Convergence Rule

For live-site, group-broadcast, attachment, CDP, Chrome-profile, or model-adapter issues, every agent must keep the loop small enough to falsify one hypothesis at a time.

Before changing code, write or update a compact debugging packet with:

- symptom
- field-level success criteria
- browser line
- minimal repro
- current hypothesis
- falsifier
- command
- evidence path
- result
- next decision

If two iterations produce no new evidence, or 30-45 minutes pass without narrowing the failure layer, stop implementation, update `.claude/HANDOFF.md`, and do targeted external research before continuing.

## Browser Boundary

There are two different browser lines:

- Normal attach/live text checks use the dedicated AI-RoundTable profile under `tools/browser-profile/chrome-user-data`.
- Advanced attachment checks use `tools/browser-profile/chrome-user-data-advanced`, the package `output/advanced-release/AI-RoundTable-advanced`, and CDP port `9333`.

Do not kill or reuse another project's Chrome. On this machine, port `9222` has previously belonged to `D:\丹纳赫实施资料上传\.chrome-upload-profile`. If a Chrome process is not clearly the AI-RoundTable profile and expected port, stop and report it.

Before live tests, verify with `chrome://version` through the repository scripts or inspect the process command line with UTF-8 PowerShell output.

## Attachment Success Rule

Text fallback is not attachment success. A broadcast with attachments is only proven to have uploaded the attachment when the relevant `attachmentResults[]` record has:

```text
attachmentStatus = supported
method = cdp_advanced
code = attachment_cdp_uploaded
```

Anything else, including `manual_required`, `text_fallback`, `attachment_upload_failed`, or a normal model reply, must be reported as degraded or unproven.

## Evidence Rule

Do not summarize a live browser result from memory alone. Point to the artifact under `output/playwright/`, usually one of:

- `output/playwright/live/`
- `output/playwright/broadcast-live/`
- `output/playwright/attachment-test/`
- `output/playwright/group-broadcast/`

If a command was not run after the latest code/doc change, say it was not rerun.

## Git State Rule

Before handing off or staging work, run `git status --short` and separate:

- files changed by this task
- pre-existing dirty files
- generated artifacts
- untracked local state such as `tools/`

Stage only the current task scope unless the user explicitly asks for a broader stage. Do not stage unrelated generated output or previous repair work just because it is already dirty.

For rollback, prefer `git restore --staged <file>` to unstage, `git restore <file>` only for confirmed current-task edits, and `git revert` for committed history. Do not run `git reset --hard` or `git clean -fd` without explicit confirmation.

## Final Response Rule

When closing a long task, say four things plainly:

- What changed.
- What was verified.
- What is still not proven.
- Where the next agent should resume.
