import fs from 'node:fs';
import path from 'node:path';

import {
    LIVE_RESULT_STATUS,
    buildLiveResult,
    classifyBroadcastDispatch,
    inspectPreflightState
} from './live_workflow.mjs';
import {
    attachPageDiagnostics,
    captureArtifact,
    captureLivePageSnapshot,
    capturePageHtml,
    sanitizeArtifactName,
    sendRuntimeMessageWithRetry
} from './playwright_runtime.mjs';

const LIVE_PROMPT = 'Reply with LIVE_OK only. No explanation.';
const LIVE_TOKEN = 'LIVE_OK';

export async function runLiveSanity({
    context,
    panelPage,
    models,
    artifactDir,
    logger
}) {
    const results = [];

    for (const model of models) {
        const result = await runLiveCheckForModel({
            context,
            panelPage,
            model,
            artifactDir,
            logger
        });
        results.push(result);
        logger.log(`live:${sanitizeArtifactName(model)}:result ${JSON.stringify(result)}`);
    }

    fs.writeFileSync(path.join(artifactDir, 'results.json'), JSON.stringify({
        models,
        results
    }, null, 2), 'utf8');

    return results;
}

async function runLiveCheckForModel({
    context,
    panelPage,
    model,
    artifactDir,
    logger
}) {
    const targetPage = await context.newPage();
    const safeName = sanitizeArtifactName(model);
    attachPageDiagnostics(targetPage, {
        label: `target:${safeName}`,
        logger
    });

    try {
        logger.log(`live:${safeName}:goto`);
        await targetPage.goto(getLiveTargetUrl(model), {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await targetPage.waitForTimeout(5000);

        const preflightSnapshot = await safeCaptureLiveSnapshot(targetPage);
        const preflight = inspectPreflightState(preflightSnapshot, model);
        if (preflight.status !== LIVE_RESULT_STATUS.ok) {
            const result = buildLiveResult({
                model,
                status: preflight.status,
                url: preflightSnapshot.url,
                title: preflightSnapshot.title,
                markers: preflight.markers,
                code: preflight.status,
                reason: preflight.reason
            });
            await captureFailureArtifacts(targetPage, artifactDir, safeName);
            return result;
        }

        logger.log(`live:${safeName}:broadcast`);
        const response = await sendRuntimeMessageWithRetry(panelPage, {
            type: 'BROADCAST',
            text: LIVE_PROMPT,
            targets: [model],
            attachments: []
        }, {
            timeoutMs: 30000,
            intervalMs: 1000
        });

        const dispatch = classifyBroadcastDispatch(response, model);
        if (dispatch.status !== LIVE_RESULT_STATUS.ok) {
            const snapshot = await safeCaptureLiveSnapshot(targetPage);
            const result = buildLiveResult({
                model,
                status: dispatch.status,
                url: snapshot.url,
                title: snapshot.title,
                markers: [],
                code: dispatch.code,
                reason: dispatch.reason
            });
            await captureFailureArtifacts(targetPage, artifactDir, safeName);
            return result;
        }

        logger.log(`live:${safeName}:wait-summary`);
        const settled = await waitForLiveSummaryOrPageBlock({
            panelPage,
            targetPage,
            model,
            timeoutMs: 90000
        });
        if (settled.status !== LIVE_RESULT_STATUS.ok) {
            const result = buildLiveResult({
                model,
                status: settled.status,
                url: settled.snapshot.url,
                title: settled.snapshot.title,
                markers: settled.markers,
                code: settled.status,
                reason: settled.reason
            });
            await captureFailureArtifacts(targetPage, artifactDir, safeName);
            return result;
        }

        const snapshot = settled.snapshot;
        await captureArtifact(targetPage, path.join(artifactDir, `${safeName}.png`)).catch((error) => {
            logger.warn(`live:${safeName}:artifact-target ${String(error?.message || error)}`);
        });
        await captureArtifact(panelPage, path.join(artifactDir, `${safeName}-panel.png`)).catch((error) => {
            logger.warn(`live:${safeName}:artifact-panel ${String(error?.message || error)}`);
        });
        return buildLiveResult({
            model,
            status: LIVE_RESULT_STATUS.ok,
            url: snapshot.url,
            title: snapshot.title,
            markers: [LIVE_TOKEN],
            code: 'live_ok',
            reason: settled.summary
        });
    } catch (error) {
        const snapshot = await safeCaptureLiveSnapshot(targetPage);
        const fallbackPreflight = inspectPreflightState(snapshot, model);
        const status = fallbackPreflight.status !== LIVE_RESULT_STATUS.ok
            ? fallbackPreflight.status
            : classifyUnexpectedLiveError(error);
        const result = buildLiveResult({
            model,
            status,
            url: snapshot.url,
            title: snapshot.title,
            markers: fallbackPreflight.status !== LIVE_RESULT_STATUS.ok ? fallbackPreflight.markers : [],
            code: fallbackPreflight.status !== LIVE_RESULT_STATUS.ok
                ? fallbackPreflight.status
                : String(error?.code || ''),
            reason: fallbackPreflight.status !== LIVE_RESULT_STATUS.ok
                ? fallbackPreflight.reason
                : String(error?.message || error || '')
        });
        logger.error(`live:${safeName}:failure ${JSON.stringify(result)}`);
        await captureFailureArtifacts(targetPage, artifactDir, safeName);
        return result;
    } finally {
        await targetPage.close().catch(() => {});
    }
}

async function waitForLiveSummaryOrPageBlock({
    panelPage,
    targetPage,
    model,
    timeoutMs = 90000
}) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const result = await panelPage.evaluate(async (targetModel) => {
            const data = await chrome.storage.local.get('rt_model_state');
            return data.rt_model_state?.[targetModel] || null;
        }, model);

        const summary = String(result?.lastSummary || '').trim();
        const status = String(result?.status || '').trim();
        const snapshot = await safeCaptureLiveSnapshot(targetPage);
        const preflight = inspectPreflightState(snapshot, model);

        if (preflight.status !== LIVE_RESULT_STATUS.ok) {
            return {
                status: preflight.status,
                snapshot,
                markers: preflight.markers,
                reason: preflight.reason
            };
        }

        if (status === 'idle' && summary && summary.includes(LIVE_TOKEN)) {
            return {
                status: LIVE_RESULT_STATUS.ok,
                snapshot,
                summary
            };
        }

        await panelPage.waitForTimeout(1000);
    }

    throw new Error(`Timed out waiting for ${model} summary to settle.`);
}

async function safeCaptureLiveSnapshot(page) {
    try {
        return await captureLivePageSnapshot(page);
    } catch {
        return {
            url: '',
            title: '',
            bodyText: '',
            html: ''
        };
    }
}

async function captureFailureArtifacts(page, artifactDir, safeName) {
    await captureArtifact(page, path.join(artifactDir, `${safeName}-failure.png`)).catch(() => {});
    await capturePageHtml(page, path.join(artifactDir, `${safeName}-failure.html`)).catch(() => {});
}

function classifyUnexpectedLiveError(error) {
    const message = String(error?.message || error || '').toLowerCase();

    if (
        message.includes('verification challenge')
        || message.includes('please verify')
        || message.includes('turnstile')
        || message.includes('cloudflare')
    ) {
        return LIVE_RESULT_STATUS.blockedByVerification;
    }

    if (
        message.includes('not logged in')
        || message.includes('sign in')
        || message.includes('login required')
        || message.includes("unexpected token '<'")
    ) {
        return LIVE_RESULT_STATUS.notLoggedIn;
    }

    if (
        message.includes('receiving end does not exist')
        || message.includes('runtime messaging')
        || message.includes('broadcast')
    ) {
        return LIVE_RESULT_STATUS.broadcastFailed;
    }

    if (
        message.includes('input element not found')
        || message.includes('failed to trigger send')
        || message.includes('element is not visible')
        || message.includes('not interactable')
    ) {
        return LIVE_RESULT_STATUS.uiNotReady;
    }

    return LIVE_RESULT_STATUS.adapterFailed;
}

function getLiveTargetUrl(model) {
    switch (model) {
        case 'ChatGPT':
            return 'https://chatgpt.com/';
        case 'Claude':
            return 'https://claude.ai/';
        case 'Grok':
            return 'https://grok.com/';
        case 'Gemini':
            return 'https://gemini.google.com/';
        case 'Doubao':
            return 'https://www.doubao.com/chat/';
        default:
            throw new Error(`Unsupported live model: ${model}`);
    }
}
