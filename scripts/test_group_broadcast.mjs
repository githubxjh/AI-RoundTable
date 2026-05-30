import fs from 'node:fs';
import path from 'node:path';

import {
    SUPPORTED_LIVE_MODELS,
    normalizeLiveModels
} from './lib/live_workflow.mjs';
import {
    attachContextDiagnostics,
    assertAttachedChromeTarget,
    captureArtifact,
    clearExtensionStorage,
    closeBrowserQuietly,
    connectToChromeOverCdp,
    createFileLogger,
    importPlaywright,
    openExtensionPanel,
    resolveAttachedExtensionId,
    sendRuntimeMessageWithRetry,
    waitForPanelReady
} from './lib/playwright_runtime.mjs';
import {
    assertChromePaths,
    buildTestingPaths
} from './lib/playwright_env.mjs';
import {
    buildMissingCdpMessage
} from './lib/chrome_attach.mjs';

const GROUP_PROMPT = 'Reply with LIVE_OK only. No explanation.';
const LIVE_TOKEN = 'LIVE_OK';
const MODEL_URLS = Object.freeze({
    ChatGPT: 'https://chatgpt.com/',
    Gemini: 'https://gemini.google.com/',
    Grok: 'https://grok.com/',
    Doubao: 'https://www.doubao.com/chat/',
    DeepSeek: 'https://chat.deepseek.com/'
});

const requestedModels = normalizeLiveModels(process.argv.slice(2), SUPPORTED_LIVE_MODELS);
const paths = buildTestingPaths();
const artifactDir = path.join(paths.artifactDir, 'broadcast-live');
const logger = createFileLogger(path.join(artifactDir, 'broadcast.log'));

let browser;

try {
    const missing = assertChromePaths(paths);
    if (missing.length > 0) {
        throw new Error(missing.join('\n'));
    }

    logger.log(`broadcast:start cdp=${paths.cdpEndpoint} models=${requestedModels.join(',')}`);

    const playwright = await importPlaywright();
    const attached = await connectToChromeOverCdp({
        playwright,
        endpoint: paths.cdpEndpoint,
        artifactDir,
        timeoutMs: 15000
    });

    browser = attached.browser;
    const context = attached.context;
    attachContextDiagnostics(context, { logger });

    const expectedProfileRoot = paths.advancedAutomationUserDataDir;
    await assertAttachedChromeTarget(context, {
        expectedUserDataDir: expectedProfileRoot,
        expectedCdpPort: paths.cdpPort,
        logger
    });

    const extensionId = await resolveAttachedExtensionId({
        context,
        repoRoot: path.join(paths.repoRoot, 'output', 'advanced-release', 'AI-RoundTable-advanced'),
        profileName: `${paths.automationProfileName} @ ${expectedProfileRoot}`,
        preferencesPath: paths.advancedAutomationPreferencesPath,
        securePreferencesPath: paths.advancedAutomationSecurePreferencesPath
    });

    const panelPage = await openExtensionPanel(context, extensionId, { logger });
    await waitForPanelReady(panelPage);
    await clearExtensionStorage(panelPage);

    const ping = await sendRuntimeMessageWithRetry(panelPage, {
        type: 'ROUND_LIST',
        limit: 1
    }, {
        timeoutMs: 20000,
        intervalMs: 500
    });
    logger.log(`broadcast:runtime-ping ${JSON.stringify(ping)}`);

    const pagesByModel = new Map();
    for (const model of requestedModels) {
        let page = findModelPage(context, model);
        if (!page) {
            page = await context.newPage();
            logger.log(`broadcast:open ${model} ${MODEL_URLS[model]}`);
            await page.goto(MODEL_URLS[model], {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
            await page.waitForTimeout(5000);
        }
        pagesByModel.set(model, page);
    }

    logger.log('broadcast:send');
    const response = await sendRuntimeMessageWithRetry(panelPage, {
        type: 'BROADCAST',
        text: GROUP_PROMPT,
        targets: requestedModels,
        attachments: []
    }, {
        timeoutMs: 90000,
        intervalMs: 1000
    });
    logger.log(`broadcast:response ${JSON.stringify(response)}`);

    const state = await waitForGroupState({
        panelPage,
        models: requestedModels,
        timeoutMs: 90000,
        intervalMs: 1000
    });
    logger.log(`broadcast:model-state ${JSON.stringify(state)}`);

    for (const [model, page] of pagesByModel.entries()) {
        await captureArtifact(page, path.join(artifactDir, `${model.toLowerCase()}-after.png`))
            .catch((error) => logger.warn(`broadcast:screenshot:${model} ${error.message}`));
    }

    const summary = {
        models: requestedModels,
        response,
        state
    };
    fs.writeFileSync(path.join(artifactDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    const failures = classifyGroupBroadcast(summary);
    const responseFailures = failures.filter((item) => item.code !== 'live_token_missing');
    console.log('\n=== GROUP BROADCAST RESULTS ===');
    for (const model of requestedModels) {
        const modelState = state?.[model] || {};
        const summaryText = String(modelState.lastSummary || '').replace(/\s+/g, ' ').trim();
        const ok = !responseFailures.some((item) => item.model === model);
        console.log(`${ok ? 'OK' : 'FAIL'} ${model}: ${modelState.status || 'unknown'} ${summaryText.slice(0, 80)}`);
    }
    console.log(`\nArtifacts saved to: ${artifactDir}`);

    if (failures.length > 0) {
        logger.warn(`broadcast:failed ${JSON.stringify(failures)}`);
    }
    if (responseFailures.length > 0) {
        process.exitCode = 1;
    }
} catch (error) {
    const message = String(error?.message || error || '').toLowerCase();
    if (message.includes('econnrefused') || message.includes('debugging endpoint')) {
        console.error(buildMissingCdpMessage(paths.cdpEndpoint));
    } else {
        console.error('Group broadcast test failed:', error);
    }
    logger.error(`broadcast:error ${error?.stack || error?.message || String(error)}`);
    process.exitCode = 1;
} finally {
    await closeBrowserQuietly(browser);
}

function findModelPage(context, model) {
    return context.pages().find((page) => {
        const url = String(page.url() || '');
        if (model === 'ChatGPT') return url.includes('chatgpt.com');
        if (model === 'Gemini') return url.includes('gemini.google.com');
        if (model === 'Grok') return url.includes('grok.com');
        if (model === 'Doubao') return url.includes('doubao.com/chat');
        if (model === 'DeepSeek') return url.includes('chat.deepseek.com');
        return false;
    }) || null;
}

function classifyGroupBroadcast(summary) {
    const failures = [];
    const sentModels = Array.isArray(summary?.response?.sentModels) ? summary.response.sentModels : [];
    const failedModels = Array.isArray(summary?.response?.failed) ? summary.response.failed : [];

    if (summary?.response?.status !== 'broadcast_done') {
        failures.push({
            model: '*',
            code: summary?.response?.code || 'broadcast_not_done',
            reason: summary?.response?.message || 'BROADCAST did not complete'
        });
    }

    for (const model of summary.models || []) {
        const state = summary.state?.[model] || {};
        const lastSummary = String(state.lastSummary || '');
        if (!sentModels.includes(model)) {
            failures.push({ model, code: 'model_not_sent', reason: 'Model missing from sentModels' });
        } else if (failedModels.some((item) => item?.model === model)) {
            failures.push({ model, code: 'model_failed', reason: 'Model listed in failed[]' });
        } else if (state.status !== 'idle' || !lastSummary.includes(LIVE_TOKEN)) {
            failures.push({ model, code: 'live_token_missing', reason: 'Model state did not settle with LIVE_OK' });
        }
    }

    return failures;
}

async function waitForGroupState({
    panelPage,
    models,
    timeoutMs,
    intervalMs
}) {
    const deadline = Date.now() + timeoutMs;
    let latest = {};

    while (Date.now() < deadline) {
        latest = await readModelState(panelPage);
        const allSettled = models.every((model) => {
            const modelState = latest?.[model] || {};
            return modelState.status === 'idle'
                && String(modelState.lastSummary || '').includes(LIVE_TOKEN);
        });
        if (allSettled) return latest;
        await panelPage.waitForTimeout(intervalMs);
    }

    return latest;
}

async function readModelState(panelPage) {
    return panelPage.evaluate(async () => (
        (await chrome.storage.local.get('rt_model_state')).rt_model_state || {}
    ));
}
