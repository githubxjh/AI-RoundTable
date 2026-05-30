import assert from 'node:assert/strict';
import fs from 'node:fs';
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
    DEFAULT_ADVANCED_CDP_PORT,
    assertChromeForTestingPath,
    clearProfileRuntimeCaches,
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
    assert.equal(DEFAULT_ADVANCED_CDP_PORT, 9333);
    assert.equal(typeof assertChromeForTestingPath, 'function');
    assert.equal(typeof clearProfileRuntimeCaches, 'function');
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
    assert.equal(
        paths.advancedAutomationUserDataDir,
        path.join(repoRoot, 'tools', 'browser-profile', 'chrome-user-data-advanced')
    );
    assert.equal(paths.automationProfileName, 'Default');
    assert.equal(
        paths.automationProfileDir,
        path.join(repoRoot, 'tools', 'browser-profile', 'chrome-user-data', 'Default')
    );
    assert.equal(
        paths.advancedAutomationProfileDir,
        path.join(repoRoot, 'tools', 'browser-profile', 'chrome-user-data-advanced', 'Default')
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
        paths.advancedAutomationPreferencesPath,
        path.join(repoRoot, 'tools', 'browser-profile', 'chrome-user-data-advanced', 'Default', 'Preferences')
    );
    assert.equal(
        paths.advancedAutomationSecurePreferencesPath,
        path.join(repoRoot, 'tools', 'browser-profile', 'chrome-user-data-advanced', 'Default', 'Secure Preferences')
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

runTest('advanced testing paths can default to the dedicated 9333 CDP port', () => {
    const paths = buildTestingPaths({
        repoRoot,
        env: {},
        defaultCdpPort: DEFAULT_ADVANCED_CDP_PORT
    });

    assert.equal(paths.cdpPort, 9333);
    assert.equal(paths.cdpEndpoint, 'http://127.0.0.1:9333');
});

runTest('explicit environment overrides win over defaults', () => {
    const paths = buildTestingPaths({
        repoRoot,
        env: {
            AI_RT_PLAYWRIGHT_CHANNEL: 'chrome-beta',
            AI_RT_CHROME_EXE: 'D:\\Apps\\Chrome\\chrome.exe',
            AI_RT_CHROME_FOR_TESTING_EXE: 'D:\\Apps\\Chrome for Testing\\chrome.exe',
            AI_RT_CHROME_USER_DATA_SOURCE: 'D:\\Profiles\\Chrome User Data',
            AI_RT_TEST_PROFILE_DIR: 'D:\\Automation\\AI RoundTable Profile',
            AI_RT_ADVANCED_TEST_PROFILE_DIR: 'D:\\Automation\\AI RoundTable Advanced Profile',
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
    assert.equal(paths.advancedAutomationUserDataDir, 'D:\\Automation\\AI RoundTable Advanced Profile');
    assert.equal(paths.chromeForTestingExecutable, 'D:\\Apps\\Chrome for Testing\\chrome.exe');
    assert.equal(paths.automationProfileName, 'Default');
    assert.equal(paths.automationProfileDir, 'D:\\Automation\\AI RoundTable Profile\\Default');
    assert.equal(paths.cdpPort, 9333);
    assert.equal(paths.cdpEndpoint, 'http://127.0.0.1:9333');
});

runTest('chrome for testing path validator gives setup guidance when missing', () => {
    const message = assertChromeForTestingPath({
        chromeForTestingExecutable: path.join(repoRoot, 'missing-cft.exe')
    });

    assert.match(message, /Chrome for Testing executable not found/);
    assert.match(message, /playwright install chromium/);
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

runTest('runtime cache cleanup removes extension caches and keeps session storage', () => {
    const tempRoot = path.join(
        repoRoot,
        'output',
        'playwright',
        'unit-profile-cache-cleanup',
        `run-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    const profileDir = path.join(tempRoot, 'Default');
    const cacheFile = path.join(profileDir, 'Extension Scripts', '000001.log');
    const serviceWorkerCacheFile = path.join(profileDir, 'Service Worker', 'ScriptCache', 'index');
    const sessionFile = path.join(profileDir, 'Local Storage', 'leveldb', '000003.log');

    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.mkdirSync(path.dirname(serviceWorkerCacheFile), { recursive: true });
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(cacheFile, 'cached-extension-script', 'utf8');
    fs.writeFileSync(serviceWorkerCacheFile, 'cached-service-worker-script', 'utf8');
    fs.writeFileSync(sessionFile, 'session-data', 'utf8');

    const removed = clearProfileRuntimeCaches(tempRoot, 'Default');

    assert.ok(removed.some((item) => item.endsWith(path.join('Default', 'Extension Scripts'))));
    assert.ok(removed.some((item) => item.endsWith(path.join('Service Worker', 'ScriptCache'))));
    assert.equal(fs.existsSync(sessionFile), true);
    fs.rmSync(tempRoot, { recursive: true, force: true });
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
