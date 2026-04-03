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
    getLockedProfileSourceFiles,
    isChromeRunning
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

const lockedFiles = getLockedProfileSourceFiles(paths.chromeProfileDir);
if (lockedFiles.length > 0) {
    console.error('Chrome profile files are still locked. Fully close Chrome before starting the attach-mode test session.');
    lockedFiles.forEach((filePath) => console.error(`LOCKED ${filePath}`));
    process.exit(1);
}

const launchArgs = buildChromeLaunchArgs({
    cdpPort: paths.cdpPort,
    userDataDir: paths.chromeUserDataSource,
    profileName: paths.chromeProfileName,
    startupUrls: DEFAULT_CHROME_START_URLS
});

const pid = launchChromeProcess(paths.chromeExecutable, launchArgs);

try {
    await waitForCdpEndpoint(paths.cdpEndpoint, { timeoutMs: 20000 });
} catch (error) {
    console.error('Chrome started, but the debugging endpoint did not become ready.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}

const extensionMatch = findRepoExtensionIdInProfile({
    preferencesPath: paths.chromePreferencesPath,
    securePreferencesPath: paths.chromeSecurePreferencesPath,
    repoRoot: paths.repoRoot
});

console.log(`Started Chrome test session (pid=${pid}) on ${paths.cdpEndpoint}`);
console.log(`Profile: ${paths.chromeProfileName}`);
console.log('Chrome opened with your normal profile so Google and GPT login can happen in the real browser.');

if (extensionMatch?.extensionId) {
    console.log(`Detected AI RoundTable unpacked extension: ${extensionMatch.extensionId}`);
} else {
    console.log(buildMissingExtensionMessage({
        profileName: paths.chromeProfileName,
        repoRoot: paths.repoRoot
    }));
}

console.log('Next steps:');
console.log('1. In that Chrome window, confirm AI RoundTable is loaded in chrome://extensions.');
console.log('2. Log in to Gemini / Doubao / Grok / ChatGPT if needed.');
console.log('3. Back in this repo, run `npm.cmd run test:live:core` or `test-live-core.cmd`.');
