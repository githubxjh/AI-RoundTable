import assert from 'node:assert/strict';

let chromeAttachModule;

try {
    chromeAttachModule = await import('../scripts/lib/chrome_attach.mjs');
} catch (error) {
    chromeAttachModule = { __importError: error };
}

const {
    buildChromeLaunchArgs,
    buildMissingCdpMessage,
    buildMissingExtensionMessage,
    findRepoExtensionIdFromProfileData
} = chromeAttachModule;

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('chrome attach module is loadable', () => {
    assert.ok(!chromeAttachModule.__importError, chromeAttachModule.__importError?.message);
    assert.equal(typeof buildChromeLaunchArgs, 'function');
    assert.equal(typeof findRepoExtensionIdFromProfileData, 'function');
});

runTest('buildChromeLaunchArgs starts real Chrome with remote debugging on the requested profile', () => {
    const args = buildChromeLaunchArgs({
        cdpPort: 9222,
        userDataDir: 'C:\\Users\\xiepro\\AppData\\Local\\Google\\Chrome\\User Data',
        profileName: 'Default',
        extensionPath: 'C:\\Users\\xiepro\\Desktop\\AI-RoundTable',
        startupUrls: ['chrome://extensions/', 'https://gemini.google.com/']
    });

    assert.deepEqual(args, [
        '--remote-debugging-port=9222',
        '--user-data-dir=C:\\Users\\xiepro\\AppData\\Local\\Google\\Chrome\\User Data',
        '--profile-directory=Default',
        '--new-window',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions-except=C:\\Users\\xiepro\\Desktop\\AI-RoundTable',
        '--load-extension=C:\\Users\\xiepro\\Desktop\\AI-RoundTable',
        'chrome://extensions/',
        'https://gemini.google.com/'
    ]);
});

runTest('findRepoExtensionIdFromProfileData matches the unpacked repo path', () => {
    const match = findRepoExtensionIdFromProfileData({
        extensions: {
            settings: {
                abc123: {
                    path: 'C:\\Users\\xiepro\\Desktop\\AI-RoundTable'
                },
                def456: {
                    path: 'C:\\Users\\xiepro\\Desktop\\Other-Extension'
                }
            }
        }
    }, 'C:\\Users\\xiepro\\Desktop\\AI-RoundTable');

    assert.deepEqual(match, {
        extensionId: 'abc123',
        source: 'profile-settings',
        extensionPath: 'C:\\Users\\xiepro\\Desktop\\AI-RoundTable'
    });
});

runTest('missing extension and cdp messages give actionable setup guidance', () => {
    const extensionMessage = buildMissingExtensionMessage({
        profileName: 'Default',
        repoRoot: 'C:\\Users\\xiepro\\Desktop\\AI-RoundTable'
    });
    const cdpMessage = buildMissingCdpMessage('http://127.0.0.1:9222');

    assert.match(extensionMessage, /Load unpacked/i);
    assert.match(extensionMessage, /AI-RoundTable/i);
    assert.match(cdpMessage, /test:chrome:launch/i);
    assert.match(cdpMessage, /9222/);
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

console.log(`Completed ${passed}/${tests.length} chrome attach checks.`);
