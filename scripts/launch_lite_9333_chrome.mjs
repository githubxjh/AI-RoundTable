import { existsSync } from 'node:fs';
import path from 'node:path';

import {
    buildChromeLaunchArgs,
    buildMissingExtensionMessage,
    DEFAULT_CHROME_START_URLS,
    findRepoExtensionIdInProfile,
    launchChromeProcess,
    waitForCdpEndpoint
} from './lib/chrome_attach.mjs';
import {
    DEFAULT_ADVANCED_CDP_PORT,
    assertChromeForTestingPath,
    assertChromePaths,
    buildTestingPaths,
    clearProfileRuntimeCaches
} from './lib/playwright_env.mjs';
import {
    assertAttachedChromeTarget,
    closeBrowserQuietly,
    ensureExtensionDeveloperRuntime,
    importPlaywright,
    openExtensionPanel,
    resolveAttachedExtensionId,
    sendRuntimeMessageWithRetry,
    waitForPanelReady
} from './lib/playwright_runtime.mjs';

const paths = buildTestingPaths({
    defaultCdpPort: DEFAULT_ADVANCED_CDP_PORT,
    env: {
        ...process.env,
        AI_RT_CDP_PORT: String(DEFAULT_ADVANCED_CDP_PORT),
        AI_RT_TEST_PROFILE_DIR: process.env.AI_RT_TEST_PROFILE_DIR
            || process.env.AI_RT_ADVANCED_TEST_PROFILE_DIR
            || path.join(process.cwd(), 'tools', 'browser-profile', 'chrome-user-data-advanced'),
        AI_RT_EXTENSION_PATH: process.env.AI_RT_EXTENSION_PATH
            || path.join(process.cwd(), 'output', 'public-release', 'AI-RoundTable-extension-test')
    }
});
const missing = assertChromePaths(paths);
const missingCft = assertChromeForTestingPath(paths);

if (missing.length > 0) {
    console.error(missing.join('\n'));
    process.exit(1);
}

if (missingCft) {
    console.error(missingCft);
    process.exit(1);
}

if (!existsSync(path.join(paths.extensionPath, 'manifest.json'))) {
    console.error(`Lite public extension package not found: ${paths.extensionPath}`);
    console.error('Run `cmd /c npm.cmd run release:public` first.');
    process.exit(1);
}

const existingEndpoint = await probeExistingEndpoint(paths);
if (existingEndpoint.active) {
    const existing = await verifyLiteRuntime(paths).catch((error) => ({ error }));
    if (existing?.ok) {
        console.log(`Lite 9333 Chrome test session is already running on ${paths.cdpEndpoint}`);
        console.log(`Attach profile root: ${paths.automationUserDataDir}`);
        console.log(`Lite extension path: ${paths.extensionPath}`);
        process.exit(0);
    }

    console.error(`CDP endpoint is already active at ${paths.cdpEndpoint}, but it is not the Lite public runtime.`);
    console.error(existing?.error?.message || 'Unknown runtime mismatch.');
    console.error('Close the existing 9333 AI-RoundTable Chrome window, then rerun this command.');
    process.exit(1);
}

const removedRuntimeCaches = clearProfileRuntimeCaches(
    paths.automationUserDataDir,
    paths.automationProfileName
);
if (removedRuntimeCaches.length > 0) {
    console.log(`Cleared Lite 9333 profile runtime caches: ${removedRuntimeCaches.length}`);
}

const launchArgs = buildChromeLaunchArgs({
    cdpPort: paths.cdpPort,
    userDataDir: paths.automationUserDataDir,
    profileName: paths.automationProfileName,
    extensionPath: paths.extensionPath,
    startupUrls: [
        'chrome://extensions/',
        ...DEFAULT_CHROME_START_URLS.filter((url) => url !== 'chrome://extensions/'),
        'https://chatgpt.com/',
        'https://gemini.google.com/app',
        'https://grok.com/',
        'https://www.doubao.com/chat/',
        'https://chat.deepseek.com/'
    ]
});

const pid = launchChromeProcess(paths.chromeForTestingExecutable, launchArgs);

try {
    await waitForCdpEndpoint(paths.cdpEndpoint, { timeoutMs: 30000 });
    const verification = await verifyLiteRuntime(paths);
    if (!verification.ok) {
        throw verification.error || new Error('Lite runtime verification failed.');
    }
} catch (error) {
    console.error('Lite 9333 Chrome started, but runtime verification failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}

const extensionMatch = findRepoExtensionIdInProfile({
    preferencesPath: paths.automationPreferencesPath,
    securePreferencesPath: paths.automationSecurePreferencesPath,
    repoRoot: paths.extensionPath
});

console.log(`Started Lite 9333 Chrome test session (pid=${pid}) on ${paths.cdpEndpoint}`);
console.log(`Chrome for Testing executable: ${paths.chromeForTestingExecutable}`);
console.log(`Attach profile root: ${paths.automationUserDataDir}`);
console.log(`Lite extension path: ${paths.extensionPath}`);
if (extensionMatch?.extensionId) {
    console.log(`Detected Lite unpacked extension: ${extensionMatch.extensionId}`);
} else {
    console.log(buildMissingExtensionMessage({
        profileName: `${paths.automationProfileName} @ ${paths.automationUserDataDir}`,
        repoRoot: paths.extensionPath
    }));
}
console.log('Next steps: run Lite live text tests on CDP port 9333.');

async function verifyLiteRuntime(currentPaths) {
    const playwright = await importPlaywright();
    const browser = await playwright.chromium.connectOverCDP(currentPaths.cdpEndpoint, {
        timeout: 15000
    });
    try {
        const context = browser.contexts()[0];
        await assertAttachedChromeTarget(context, {
            expectedUserDataDir: currentPaths.automationUserDataDir,
            expectedCdpPort: currentPaths.cdpPort
        });

        const extensionId = await resolveAttachedExtensionId({
            context,
            repoRoot: currentPaths.extensionPath,
            profileName: `${currentPaths.automationProfileName} @ ${currentPaths.automationUserDataDir}`,
            preferencesPath: currentPaths.automationPreferencesPath,
            securePreferencesPath: currentPaths.automationSecurePreferencesPath
        });
        await ensureExtensionDeveloperRuntime(context, extensionId, {
            timeoutMs: 20000,
            intervalMs: 500
        });
        const panel = await openExtensionPanel(context, extensionId);
        await waitForPanelReady(panel);
        const pingResponse = await sendRuntimeMessageWithRetry(panel, {
            type: 'ROUND_LIST',
            limit: 1
        }, {
            timeoutMs: 20000,
            intervalMs: 500
        });
        if (pingResponse?.status !== 'ok') {
            throw new Error(`Lite extension background runtime did not respond cleanly: ${JSON.stringify(pingResponse)}`);
        }
        const manifest = await panel.evaluate(() => chrome.runtime.getManifest());
        const permissions = new Set(Array.isArray(manifest.permissions) ? manifest.permissions : []);
        if (permissions.has('debugger') || permissions.has('downloads')) {
            throw new Error(
                `Lite extension is not active. Runtime permissions: ${(manifest.permissions || []).join(',') || '(none)'}`
            );
        }
        return {
            ok: true,
            extensionId,
            permissions: manifest.permissions || []
        };
    } finally {
        await closeBrowserQuietly(browser);
    }
}

async function probeExistingEndpoint(currentPaths) {
    try {
        await waitForCdpEndpoint(currentPaths.cdpEndpoint, {
            timeoutMs: 1000,
            intervalMs: 250
        });
        return { active: true };
    } catch {
        return { active: false };
    }
}
