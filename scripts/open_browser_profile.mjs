import path from 'node:path';

import {
    DEFAULT_PROFILE_OPEN_MODELS,
    normalizeLiveModels
} from './lib/live_workflow.mjs';
import {
    assertProfileReady,
    attachContextDiagnostics,
    closeContextQuietly,
    createFileLogger,
    getLiveTargetUrl,
    importPlaywright,
    launchExtensionContext,
    openExtensionPanel,
    sanitizeArtifactName,
    waitForPanelReady
} from './lib/playwright_runtime.mjs';
import {
    buildTestingPaths
} from './lib/playwright_env.mjs';

const argv = process.argv.slice(2);
const requestedModels = normalizeLiveModels(
    argv.filter((arg) => arg !== '--headless' && arg !== '--headed'),
    DEFAULT_PROFILE_OPEN_MODELS
);
const paths = buildTestingPaths();
const artifactDir = path.join(paths.artifactDir, 'profile-open');
const logger = createFileLogger(path.join(artifactDir, 'profile-open.log'));

let context;

try {
    assertProfileReady(paths.automationUserDataDir);

    const playwright = await importPlaywright();
    const launched = await launchExtensionContext({
        playwright,
        extensionPath: paths.extensionPath,
        browserChannel: paths.automationBrowserChannel,
        chromeExecutable: paths.chromeExecutable,
        userDataDir: paths.automationUserDataDir,
        artifactDir,
        headless: false
    });

    context = launched.context;
    attachContextDiagnostics(context, { logger });
    logger.log(`profile-open:extension-id ${launched.extensionId}`);

    const panelPage = await openExtensionPanel(context, launched.extensionId, { logger });
    await waitForPanelReady(panelPage);
    logger.log('profile-open:panel-ready');

    for (const model of requestedModels) {
        const page = await context.newPage();
        const targetUrl = getLiveTargetUrl(model);
        await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        logger.log(`profile-open:${sanitizeArtifactName(model)} ${targetUrl}`);
    }

    console.log('Persistent test browser is open.');
    console.log('Use this window to log in or clear site verification once.');
    console.log(`Opened models: ${requestedModels.join(', ')}`);
    console.log('Close the browser window when you are done.');

    await waitForContextShutdown(context);
} catch (error) {
    logger.error(`profile-open:failure ${error?.stack || error?.message || String(error)}`);
    console.error('Failed to open the persistent test browser.');
    console.error(error);
    process.exitCode = 1;
} finally {
    await closeContextQuietly(context);
}

async function waitForContextShutdown(currentContext) {
    await new Promise((resolve) => {
        let settled = false;

        const finish = async () => {
            if (settled) return;
            settled = true;
            await closeContextQuietly(currentContext);
            resolve();
        };

        currentContext.on('close', () => {
            if (settled) return;
            settled = true;
            resolve();
        });

        process.once('SIGINT', finish);
        process.once('SIGTERM', finish);
    });
}
