import assert from 'node:assert/strict';
import path from 'node:path';

let envModule;

try {
    envModule = await import('../scripts/lib/playwright_env.mjs');
} catch (error) {
    envModule = { __importError: error };
}

const {
    buildTestingPaths,
    buildExtensionLaunchArgs,
    shouldCopyProfileEntry
} = envModule;

const repoRoot = path.resolve(process.cwd());

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('playwright env module is loadable', () => {
    assert.ok(!envModule.__importError, envModule.__importError?.message);
    assert.equal(typeof buildTestingPaths, 'function');
    assert.equal(typeof buildExtensionLaunchArgs, 'function');
    assert.equal(typeof shouldCopyProfileEntry, 'function');
});

runTest('default testing paths target repo-local output and browser-profile directories', () => {
    const paths = buildTestingPaths({ repoRoot, env: {} });

    assert.equal(paths.repoRoot, repoRoot);
    assert.equal(paths.extensionPath, repoRoot);
    assert.equal(paths.automationBrowserChannel, 'chromium');
    assert.equal(
        paths.chromeExecutable,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    );
    assert.equal(
        paths.chromeUserDataSource,
        'C:\\Users\\xiepro\\AppData\\Local\\Google\\Chrome\\User Data'
    );
    assert.equal(
        paths.profileSourceDir,
        'C:\\Users\\xiepro\\AppData\\Local\\Google\\Chrome\\User Data\\Default'
    );
    assert.equal(paths.chromeProfileName, 'Default');
    assert.equal(
        paths.chromeProfileDir,
        'C:\\Users\\xiepro\\AppData\\Local\\Google\\Chrome\\User Data\\Default'
    );
    assert.equal(
        paths.chromePreferencesPath,
        'C:\\Users\\xiepro\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Preferences'
    );
    assert.equal(
        paths.chromeSecurePreferencesPath,
        'C:\\Users\\xiepro\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Secure Preferences'
    );
    assert.equal(
        paths.automationUserDataDir,
        path.join(repoRoot, 'tools', 'browser-profile', 'chrome-user-data')
    );
    assert.equal(paths.automationProfileName, 'Default');
    assert.equal(
        paths.automationProfileDir,
        path.join(repoRoot, 'tools', 'browser-profile', 'chrome-user-data', 'Default')
    );
    assert.equal(
        paths.automationPreferencesPath,
        path.join(repoRoot, 'tools', 'browser-profile', 'chrome-user-data', 'Default', 'Preferences')
    );
    assert.equal(
        paths.automationSecurePreferencesPath,
        path.join(repoRoot, 'tools', 'browser-profile', 'chrome-user-data', 'Default', 'Secure Preferences')
    );
    assert.equal(
        paths.smokeUserDataDir,
        path.join(repoRoot, 'output', 'playwright', 'smoke-user-data')
    );
    assert.equal(
        paths.artifactDir,
        path.join(repoRoot, 'output', 'playwright')
    );
    assert.equal(paths.cdpPort, 9222);
    assert.equal(paths.cdpEndpoint, 'http://127.0.0.1:9222');
});

runTest('explicit environment overrides win over defaults', () => {
    const paths = buildTestingPaths({
        repoRoot,
        env: {
            AI_RT_PLAYWRIGHT_CHANNEL: 'chrome-beta',
            AI_RT_CHROME_EXE: 'D:\\Apps\\Chrome\\chrome.exe',
            AI_RT_CHROME_USER_DATA_SOURCE: 'D:\\Profiles\\Chrome User Data',
            AI_RT_TEST_PROFILE_DIR: 'D:\\Automation\\AI RoundTable Profile',
            AI_RT_CDP_PORT: '9333',
            AI_RT_CHROME_PROFILE_NAME: 'Profile 7'
        }
    });

    assert.equal(paths.automationBrowserChannel, 'chrome-beta');
    assert.equal(paths.chromeExecutable, 'D:\\Apps\\Chrome\\chrome.exe');
    assert.equal(paths.chromeUserDataSource, 'D:\\Profiles\\Chrome User Data');
    assert.equal(paths.chromeProfileName, 'Profile 7');
    assert.equal(paths.profileSourceDir, 'D:\\Profiles\\Chrome User Data\\Profile 7');
    assert.equal(paths.automationUserDataDir, 'D:\\Automation\\AI RoundTable Profile');
    assert.equal(paths.automationProfileName, 'Default');
    assert.equal(paths.automationProfileDir, 'D:\\Automation\\AI RoundTable Profile\\Default');
    assert.equal(paths.cdpPort, 9333);
    assert.equal(paths.cdpEndpoint, 'http://127.0.0.1:9333');
});

runTest('invalid cdp port falls back to default', () => {
    const paths = buildTestingPaths({
        repoRoot,
        env: {
            AI_RT_CDP_PORT: 'not-a-number'
        }
    });

    assert.equal(paths.cdpPort, 9222);
    assert.equal(paths.cdpEndpoint, 'http://127.0.0.1:9222');
});

runTest('extension launch args always load only this extension directory', () => {
    const args = buildExtensionLaunchArgs('C:\\repo\\AI-RoundTable');

    assert.deepEqual(args, [
        '--disable-extensions-except=C:\\repo\\AI-RoundTable',
        '--load-extension=C:\\repo\\AI-RoundTable'
    ]);
});

runTest('profile copy filter excludes cache-like content and keeps login/session data', () => {
    assert.equal(shouldCopyProfileEntry('Local State'), true);
    assert.equal(shouldCopyProfileEntry('Default\\Network\\Cookies'), true);
    assert.equal(shouldCopyProfileEntry('Default\\Local Storage\\leveldb\\000003.log'), true);
    assert.equal(shouldCopyProfileEntry('Default\\Extension State\\000003.log'), false);
    assert.equal(shouldCopyProfileEntry('Default\\Local Extension Settings\\abcdef\\LOG'), false);
    assert.equal(shouldCopyProfileEntry('Default\\Service Worker\\CacheStorage\\001.log'), false);
    assert.equal(shouldCopyProfileEntry('Default\\Code Cache\\js\\index'), false);
    assert.equal(shouldCopyProfileEntry('Default\\Cache\\Cache_Data\\f_000123'), false);
    assert.equal(shouldCopyProfileEntry('Default\\GPUCache\\data_0'), false);
});

let passed = 0;

for (const { name, fn } of tests) {
    try {
        fn();
        passed += 1;
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        throw error;
    }
}

console.log(`Completed ${passed}/${tests.length} Playwright environment checks.`);
