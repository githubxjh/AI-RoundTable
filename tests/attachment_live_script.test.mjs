import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'test_attachment.mjs'),
    'utf8'
);
const packageJson = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'package.json'),
    'utf8'
));
const advancedLaunchSource = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'launch_advanced_chrome.mjs'),
    'utf8'
);
const groupBroadcastSource = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'test_group_broadcast.mjs'),
    'utf8'
);
const serviceWorkerSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'background', 'service_worker.js'),
    'utf8'
);

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('attachment live script defines the PNG fixture before building the payload', () => {
    const fixtureIndex = source.indexOf('const TEST_PNG_BASE64');
    const payloadIndex = source.indexOf('const testAttachment');

    assert.notEqual(fixtureIndex, -1, 'TEST_PNG_BASE64 must be defined');
    assert.notEqual(payloadIndex, -1, 'testAttachment payload must be defined');
    assert.ok(
        fixtureIndex < payloadIndex,
        'TEST_PNG_BASE64 must be initialized before testAttachment reads it'
    );
});

runTest('attachment live script can use a caller supplied PDF fixture', () => {
    assert.match(source, /parseAttachmentTestArgs/);
    assert.match(source, /--file/);
    assert.match(source, /readAttachmentFromFile/);
    assert.match(source, /application\/pdf/);
    assert.match(source, /fs\.readFileSync\(resolvedPath\)/);
    assert.match(source, /toString\('base64'\)/);
});

runTest('attachment live script creates a target page for each model before diagnostics', () => {
    const loopIndex = source.indexOf('for (const model of requestedModels)');
    const pageIndex = source.indexOf('const targetPage = await context.newPage();', loopIndex);
    const diagnosticsIndex = source.indexOf('attachPageDiagnostics(targetPage', loopIndex);

    assert.notEqual(loopIndex, -1, 'model loop must exist');
    assert.notEqual(pageIndex, -1, 'targetPage must be created inside the model loop');
    assert.notEqual(diagnosticsIndex, -1, 'targetPage diagnostics must be attached');
    assert.ok(
        pageIndex < diagnosticsIndex,
        'targetPage must be created before diagnostics attach to it'
    );
});

runTest('attachment live script probes the running runtime instead of hot-reloading it', () => {
    assert.match(source, /ATTACHMENT_CAPABILITIES/);
    assert.match(source, /assertExpectedRuntimeCapabilities/);
    assert.doesNotMatch(source, /reloadExtensionRuntime/);
    assert.doesNotMatch(source, /chrome:\/\/extensions\/\?id=/);
    assert.doesNotMatch(source, /dev-reload-button/);
});

runTest('attachment live script allows Gemini CDP and rejects other unproven paths', () => {
    assert.match(source, /ChatGPT.*Advanced CDP/s);
    assert.match(source, /Grok.*Advanced CDP/s);
    assert.match(source, /Doubao automated attachments/s);
    assert.match(source, /DeepSeek Advanced CDP attachments/s);
    assert.match(source, /Gemini.+status !== 'supported'.+method !== 'cdp_advanced'.+code !== 'attachment_cdp_available'/s);
});

runTest('attachment live script defaults to the Advanced CDP port and profile', () => {
    assert.match(source, /DEFAULT_ADVANCED_CDP_PORT/);
    assert.match(source, /buildTestingPaths\(\{ defaultCdpPort: DEFAULT_ADVANCED_CDP_PORT \}\)/);
    assert.match(source, /advancedAutomationUserDataDir/);
});

runTest('attachment live script opens Gemini app directly instead of the root page', () => {
    assert.match(source, /case 'Gemini': return 'https:\/\/gemini\.google\.com\/app'/);
});

runTest('advanced chrome launcher verifies the advanced runtime permissions before tests', () => {
    assert.equal(
        packageJson.scripts['test:chrome:launch:advanced'],
        'node scripts/launch_advanced_chrome.mjs'
    );
    assert.match(advancedLaunchSource, /output.+advanced-release.+AI-RoundTable-advanced/s);
    assert.match(advancedLaunchSource, /DEFAULT_ADVANCED_CDP_PORT/);
    assert.match(advancedLaunchSource, /buildTestingPaths\(\{ defaultCdpPort: DEFAULT_ADVANCED_CDP_PORT \}\)/);
    assert.match(advancedLaunchSource, /chromeForTestingExecutable/);
    assert.match(advancedLaunchSource, /advancedAutomationUserDataDir/);
    assert.match(advancedLaunchSource, /debugger/);
    assert.match(advancedLaunchSource, /downloads/);
    assert.match(advancedLaunchSource, /ensureExtensionDeveloperRuntime/);
    assert.match(advancedLaunchSource, /sendRuntimeMessageWithRetry/);
    assert.match(advancedLaunchSource, /ROUND_LIST/);
    assert.match(advancedLaunchSource, /Advanced extension is not active/);
    assert.match(advancedLaunchSource, /CDP endpoint is already active/);
});

runTest('advanced chrome launcher does not clear profile caches before checking an existing endpoint', () => {
    const cacheIndex = advancedLaunchSource.indexOf('clearProfileRuntimeCaches(');
    const endpointIndex = advancedLaunchSource.indexOf('const existingEndpoint = await probeExistingEndpoint(paths);');

    assert.notEqual(cacheIndex, -1, 'Advanced launcher must still clear profile runtime caches for fresh launches');
    assert.notEqual(endpointIndex, -1, 'Advanced launcher must probe existing CDP endpoint');
    assert.ok(
        endpointIndex < cacheIndex,
        'Existing CDP endpoint must be verified before clearing profile caches that may be locked by Chrome'
    );
});

runTest('group broadcast script verifies one BROADCAST reaches every requested model', () => {
    assert.equal(
        packageJson.scripts['test:live:group'],
        'node scripts/test_group_broadcast.mjs'
    );
    assert.match(groupBroadcastSource, /type:\s*'BROADCAST'/);
    assert.match(groupBroadcastSource, /sentModels/);
    assert.match(groupBroadcastSource, /rt_model_state/);
    assert.match(groupBroadcastSource, /LIVE_OK/);
    assert.match(groupBroadcastSource, /waitForGroupState/);
    assert.match(groupBroadcastSource, /timeoutMs:\s*90000/);
    assert.match(groupBroadcastSource, /responseFailures/);
    assert.match(groupBroadcastSource, /live_token_missing/);
    assert.match(groupBroadcastSource, /advancedAutomationUserDataDir/);
});

runTest('background routes prepared Gemini file chooser uploads through the CDP chooser path', () => {
    assert.match(serviceWorkerSource, /setFileInputFilesViaCdpFileChooser/);
    assert.match(serviceWorkerSource, /prepare\.inputMode === 'file_chooser'/);
    assert.match(serviceWorkerSource, /triggerExpression: prepare\.triggerExpression/);
    assert.match(serviceWorkerSource, /setFileInputFilesWithCdp\(tabId, prepare\.inputSelector/);
    assert.match(serviceWorkerSource, /VERIFY_PREUPLOADED_ATTACHMENTS/);
    assert.match(serviceWorkerSource, /verifyPreuploadedAttachmentsForCdp/);
    assert.match(serviceWorkerSource, /attachment_preupload_ready/);
    assert.match(serviceWorkerSource, /inputMode: response\.inputMode \|\| 'file_input'/);
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

console.log(`Completed ${passed}/${tests.length} attachment live script checks.`);
