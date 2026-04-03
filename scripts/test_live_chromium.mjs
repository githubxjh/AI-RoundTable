import path from 'node:path';

import {
    DEFAULT_LIVE_CORE_MODELS,
    normalizeLiveModels
} from './lib/live_workflow.mjs';
import {
    attachContextDiagnostics,
    clearExtensionStorage,
    closeContextQuietly,
    createFileLogger,
    importPlaywright,
    launchExtensionContext,
    openExtensionPanel,
    parseHeadlessFlag,
    sendRuntimeMessageWithRetry,
    waitForPanelReady
} from './lib/playwright_runtime.mjs';
import {
    buildTestingPaths
} from './lib/playwright_env.mjs';
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
const headless = parseHeadlessFlag(argv, false);
const paths = buildTestingPaths();
const liveArtifactDir = path.join(paths.artifactDir, getLiveArtifactFolder(LIVE_BACKEND.chromium));
const logger = createFileLogger(path.join(liveArtifactDir, 'live.log'));

let context;

try {
    logger.log(
        `live:start backend=${LIVE_BACKEND.chromium} headless=${String(headless)} models=${requestedModels.join(',')}`
    );

    const playwright = await importPlaywright();
    const launched = await launchExtensionContext({
        playwright,
        extensionPath: paths.extensionPath,
        browserChannel: paths.automationBrowserChannel,
        chromeExecutable: paths.chromeExecutable,
        userDataDir: paths.automationUserDataDir,
        artifactDir: liveArtifactDir,
        headless
    });

    context = launched.context;
    attachContextDiagnostics(context, { logger });
    logger.log(`live:extension-id ${launched.extensionId}`);

    const panelPage = await openExtensionPanel(context, launched.extensionId, { logger });
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
        console.error('Chromium live sanity test completed with failures.');
        for (const item of failed) {
            console.error(
                `- ${item.model}: status=${item.status} code=${item.code || 'n/a'} title=${item.title || 'n/a'} url=${item.url || 'n/a'}`
            );
        }
        process.exitCode = 1;
    } else {
        logger.log('live:success');
        console.log(`Chromium live sanity test completed for: ${requestedModels.join(', ')}`);
    }
} catch (error) {
    logger.error(`live:failure ${error?.stack || error?.message || String(error)}`);
    console.error('Chromium live sanity test failed.');
    console.error(error);
    process.exitCode = 1;
} finally {
    logger.log('live:close-context');
    await closeContextQuietly(context);
}
