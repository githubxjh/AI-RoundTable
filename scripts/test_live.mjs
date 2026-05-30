import path from 'node:path';

import {
    DEFAULT_LIVE_CORE_MODELS,
    normalizeLiveModels
} from './lib/live_workflow.mjs';
import {
    attachContextDiagnostics,
    assertProfileReady,
    assertAttachedChromeTarget,
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
import {
    getLiveArtifactFolder,
    LIVE_BACKEND
} from './lib/live_backend.mjs';
import {
    runLiveSanity
} from './lib/live_sanity_runner.mjs';

const argv = process.argv.slice(2);
const requestedModels = normalizeLiveModels(
    argv.filter((arg) => arg !== '--headless' && arg !== '--headed'),
    DEFAULT_LIVE_CORE_MODELS
);
const paths = buildTestingPaths();
const liveArtifactDir = path.join(paths.artifactDir, getLiveArtifactFolder(LIVE_BACKEND.attach));
const logger = createFileLogger(path.join(liveArtifactDir, 'live.log'));

let browser;

try {
    const ignoredFlags = argv.filter((arg) => arg === '--headless' || arg === '--headed');
    const missing = assertChromePaths(paths);
    if (missing.length > 0) {
        throw new Error(missing.join('\n'));
    }
    if (ignoredFlags.length > 0) {
        logger.warn(`live:attach ignores flags ${ignoredFlags.join(',')}`);
    }
    assertProfileReady(paths.automationUserDataDir);

    logger.log(
        `live:start backend=${LIVE_BACKEND.attach} cdp=${paths.cdpEndpoint} attachProfile=${paths.automationUserDataDir} models=${requestedModels.join(',')}`
    );

    const playwright = await importPlaywright();
    const attached = await connectToChromeOverCdp({
        playwright,
        artifactDir: liveArtifactDir,
        endpoint: paths.cdpEndpoint,
        timeoutMs: 15000
    });

    browser = attached.browser;
    const context = attached.context;
    attachContextDiagnostics(context, { logger });
    await assertAttachedChromeTarget(context, {
        expectedUserDataDir: paths.automationUserDataDir,
        expectedCdpPort: paths.cdpPort,
        logger
    });

    const extensionId = await resolveAttachedExtensionId({
        context,
        repoRoot: paths.repoRoot,
        profileName: `${paths.automationProfileName} @ ${paths.automationUserDataDir}`,
        preferencesPath: paths.automationPreferencesPath,
        securePreferencesPath: paths.automationSecurePreferencesPath
    });
    logger.log(`live:extension-id ${extensionId}`);

    const panelPage = await openExtensionPanel(context, extensionId, { logger });
    await waitForPanelReady(panelPage);
    await clearExtensionStorage(panelPage);

    const pingResponse = await sendRuntimeMessageWithRetry(panelPage, {
        type: 'ROUND_LIST',
        limit: 1
    }, {
        timeoutMs: 20000,
        intervalMs: 1000
    });
    logger.log(`live:runtime-ping-response ${JSON.stringify(pingResponse)}`);

    const results = await runLiveSanity({
        context,
        panelPage,
        models: requestedModels,
        artifactDir: liveArtifactDir,
        logger
    });

    const failed = results.filter((item) => item.status !== 'ok');
    if (failed.length > 0) {
        logger.warn(`live:completed-with-failures count=${failed.length}`);
        console.error('Live sanity test completed with failures.');
        for (const item of failed) {
            console.error(
                `- ${item.model}: status=${item.status} code=${item.code || 'n/a'} title=${item.title || 'n/a'} url=${item.url || 'n/a'}`
            );
        }
        process.exitCode = 1;
    } else {
        logger.log('live:success');
        console.log(`Live sanity test completed for: ${requestedModels.join(', ')}`);
    }
} catch (error) {
    const normalizedError = normalizeAttachError(error, paths.cdpEndpoint);
    logger.error(`live:failure ${normalizedError?.stack || normalizedError?.message || String(normalizedError)}`);
    console.error('Live sanity test failed.');
    console.error(normalizedError);
    process.exitCode = 1;
} finally {
    logger.log('live:disconnect-browser');
    await closeBrowserQuietly(browser);
}

function normalizeAttachError(error, endpoint) {
    const message = String(error?.message || error || '').toLowerCase();

    if (
        message.includes('debugging endpoint is not ready')
        || message.includes('econnrefused')
        || message.includes('browsertype.connectovercdp')
    ) {
        return new Error(buildMissingCdpMessage(endpoint));
    }

    return error instanceof Error ? error : new Error(String(error || 'Unknown error'));
}
