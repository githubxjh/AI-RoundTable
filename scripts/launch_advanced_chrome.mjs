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
    assertChromePaths,
    assertChromeForTestingPath,
    buildTestingPaths,
    clearProfileRuntimeCaches,
    copyChromeProfile,
    getLockedProfileSourceFiles,
    isProfileCopyReady
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

const paths = buildTestingPaths({ defaultCdpPort: DEFAULT_ADVANCED_CDP_PORT });
const advancedExtensionPath = path.join(paths.repoRoot, 'output', 'advanced-release', 'AI-RoundTable-advanced');
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

if (!existsSync(path.join(advancedExtensionPath, 'manifest.json'))) {
    console.error(`Advanced extension package not found: ${advancedExtensionPath}`);
    console.error('Run `cmd /c npm.cmd run release:advanced` first.');
    process.exit(1);
}

const advancedProfileReady = isProfileCopyReady(
    paths.advancedAutomationUserDataDir,
    paths.automationProfileName
);
const sourceProfileRoot = isProfileCopyReady(paths.automationUserDataDir, paths.automationProfileName)
    ? paths.automationUserDataDir
    : paths.chromeUserDataSource;
const sourceProfileDir = isProfileCopyReady(paths.automationUserDataDir, paths.automationProfileName)
    ? paths.automationProfileDir
    : paths.profileSourceDir;
const sourceProfileName = isProfileCopyReady(paths.automationUserDataDir, paths.automationProfileName)
    ? paths.automationProfileName
    : paths.chromeProfileName;

if (!advancedProfileReady) {
    const lockedFiles = getLockedProfileSourceFiles(sourceProfileDir);
    if (lockedFiles.length > 0) {
        console.error('Chrome profile source files are locked. Close the AI-RoundTable/profile Chrome window, then rerun this command.');
        lockedFiles.forEach((filePath) => console.error(`LOCKED ${filePath}`));
        process.exit(1);
    }

    copyChromeProfile({
        sourceRoot: sourceProfileRoot,
        sourceProfileName,
        destinationRoot: paths.advancedAutomationUserDataDir,
        destinationProfileName: paths.automationProfileName
    });

    console.log(`Initialized Advanced attach profile: ${paths.advancedAutomationUserDataDir}`);
    console.log(`Copied login state from: ${sourceProfileDir}`);
}

const existingEndpoint = await probeExistingEndpoint(paths);
if (existingEndpoint.active) {
    const existing = await verifyAdvancedRuntime(paths, advancedExtensionPath).catch((error) => ({ error }));
    if (existing?.ok) {
        console.log(`Advanced Chrome test session is already running on ${paths.cdpEndpoint}`);
        console.log(`Attach profile root: ${paths.advancedAutomationUserDataDir}`);
        console.log(`Advanced extension path: ${advancedExtensionPath}`);
        process.exit(0);
    }

    console.error(`CDP endpoint is already active at ${paths.cdpEndpoint}, but it is not the Advanced runtime.`);
    console.error(existing?.error?.message || 'Unknown runtime mismatch.');
    console.error('Close the existing AI-RoundTable attach Chrome window for this profile, then rerun this command.');
    process.exit(1);
}

const removedRuntimeCaches = clearProfileRuntimeCaches(
    paths.advancedAutomationUserDataDir,
    paths.automationProfileName
);
if (removedRuntimeCaches.length > 0) {
    console.log(`Cleared Advanced profile runtime caches: ${removedRuntimeCaches.length}`);
}

const launchArgs = buildChromeLaunchArgs({
    cdpPort: paths.cdpPort,
    userDataDir: paths.advancedAutomationUserDataDir,
    profileName: paths.automationProfileName,
    extensionPath: advancedExtensionPath,
    startupUrls: [
        'chrome://extensions/',
        ...DEFAULT_CHROME_START_URLS.filter((url) => url !== 'chrome://extensions/'),
        'https://chatgpt.com/',
        'https://www.doubao.com/chat/',
        'https://chat.deepseek.com/'
    ]
});

const pid = launchChromeProcess(paths.chromeForTestingExecutable, launchArgs);

try {
    await waitForCdpEndpoint(paths.cdpEndpoint, { timeoutMs: 30000 });
    const verification = await verifyAdvancedRuntime(paths, advancedExtensionPath);
    if (!verification.ok) {
        throw verification.error || new Error('Advanced runtime verification failed.');
    }
} catch (error) {
    console.error('Advanced Chrome started, but runtime verification failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}

const extensionMatch = findRepoExtensionIdInProfile({
    preferencesPath: paths.advancedAutomationPreferencesPath,
    securePreferencesPath: paths.advancedAutomationSecurePreferencesPath,
    repoRoot: advancedExtensionPath
});

console.log(`Started Advanced Chrome test session (pid=${pid}) on ${paths.cdpEndpoint}`);
console.log(`Chrome for Testing executable: ${paths.chromeForTestingExecutable}`);
console.log(`Attach profile root: ${paths.advancedAutomationUserDataDir}`);
console.log(`Advanced extension path: ${advancedExtensionPath}`);
if (extensionMatch?.extensionId) {
    console.log(`Detected Advanced unpacked extension: ${extensionMatch.extensionId}`);
} else {
    console.log(buildMissingExtensionMessage({
        profileName: `${paths.automationProfileName} @ ${paths.advancedAutomationUserDataDir}`,
        repoRoot: advancedExtensionPath
    }));
}
console.log('Next steps: run attachment live tests with this CDP port and verify attachmentResults use cdp_advanced.');

async function verifyAdvancedRuntime(currentPaths, expectedExtensionPath) {
    const playwright = await importPlaywright();
    const browser = await playwright.chromium.connectOverCDP(currentPaths.cdpEndpoint, {
        timeout: 15000
    });
    try {
        const context = browser.contexts()[0];
        await assertAttachedChromeTarget(context, {
            expectedUserDataDir: currentPaths.advancedAutomationUserDataDir,
            expectedCdpPort: currentPaths.cdpPort
        });

        const extensionId = await resolveAttachedExtensionId({
            context,
            repoRoot: expectedExtensionPath,
            profileName: `${currentPaths.automationProfileName} @ ${currentPaths.advancedAutomationUserDataDir}`,
            preferencesPath: currentPaths.advancedAutomationPreferencesPath,
            securePreferencesPath: currentPaths.advancedAutomationSecurePreferencesPath
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
            throw new Error(`Advanced extension background runtime did not respond cleanly: ${JSON.stringify(pingResponse)}`);
        }
        const manifest = await panel.evaluate(() => chrome.runtime.getManifest());
        const permissions = new Set(Array.isArray(manifest.permissions) ? manifest.permissions : []);
        if (!permissions.has('debugger') || !permissions.has('downloads')) {
            throw new Error(
                `Advanced extension is not active. Runtime permissions: ${(manifest.permissions || []).join(',') || '(none)'}`
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
