import {
    buildMissingExtensionMessage,
    buildChromeLaunchArgs,
    DEFAULT_CHROME_START_URLS,
    findRepoExtensionIdInProfile,
    launchChromeProcess,
    waitForCdpEndpoint
} from './lib/chrome_attach.mjs';
import {
    assertChromePaths,
    buildTestingPaths,
    copyChromeProfile,
    getLockedProfileSourceFiles,
    isChromeRunning,
    isProfileCopyReady
} from './lib/playwright_env.mjs';

const paths = buildTestingPaths();
const missing = assertChromePaths(paths);

if (missing.length > 0) {
    console.error(missing.join('\n'));
    process.exit(1);
}

if (isChromeRunning()) {
    console.error('Chrome is already running. Fully close Chrome before starting the attach-mode test session.');
    process.exit(1);
}

if (!isProfileCopyReady(paths.automationUserDataDir, paths.automationProfileName)) {
    const lockedFiles = getLockedProfileSourceFiles(paths.chromeProfileDir);
    if (lockedFiles.length > 0) {
        console.error('Chrome profile files are still locked. Fully close Chrome before starting the attach-mode test session.');
        lockedFiles.forEach((filePath) => console.error(`LOCKED ${filePath}`));
        process.exit(1);
    }

    copyChromeProfile({
        sourceRoot: paths.chromeUserDataSource,
        sourceProfileName: paths.chromeProfileName,
        destinationRoot: paths.automationUserDataDir,
        destinationProfileName: paths.automationProfileName
    });

    console.log(`Initialized dedicated attach profile: ${paths.automationUserDataDir}`);
}

const launchArgs = buildChromeLaunchArgs({
    cdpPort: paths.cdpPort,
    userDataDir: paths.automationUserDataDir,
    profileName: paths.automationProfileName,
    startupUrls: DEFAULT_CHROME_START_URLS
});

const pid = launchChromeProcess(paths.chromeExecutable, launchArgs);

try {
    await waitForCdpEndpoint(paths.cdpEndpoint, { timeoutMs: 30000 });
} catch (error) {
    console.error('Chrome started, but the debugging endpoint did not become ready.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}

const extensionMatch = findRepoExtensionIdInProfile({
    preferencesPath: paths.automationPreferencesPath,
    securePreferencesPath: paths.automationSecurePreferencesPath,
    repoRoot: paths.repoRoot
});

console.log(`Started Chrome test session (pid=${pid}) on ${paths.cdpEndpoint}`);
console.log(`Attach profile root: ${paths.automationUserDataDir}`);
console.log(`Attach profile name: ${paths.automationProfileName}`);
console.log('Chrome opened with the dedicated persistent test profile so Google and GPT login can be reused across runs.');

if (extensionMatch?.extensionId) {
    console.log(`Detected AI RoundTable unpacked extension: ${extensionMatch.extensionId}`);
} else {
    console.log(buildMissingExtensionMessage({
        profileName: `${paths.automationProfileName} @ ${paths.automationUserDataDir}`,
        repoRoot: paths.repoRoot
    }));
}

console.log('Next steps:');
console.log('1. In that Chrome window, confirm AI RoundTable is loaded in chrome://extensions.');
console.log('2. Log in to Gemini / Doubao / Grok / ChatGPT if needed.');
console.log('3. Back in this repo, run `npm.cmd run test:live:core` or `test-live-core.cmd`.');
