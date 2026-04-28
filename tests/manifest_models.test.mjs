import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
const serviceWorkerSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'background', 'service_worker.js'),
    'utf8'
);

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

function getModelNamesFromServiceWorker() {
    const match = serviceWorkerSource.match(/const MODEL_NAMES = (\[[^\]]+\]);/);
    assert.ok(match, 'MODEL_NAMES declaration should be present');
    return Function(`return ${match[1]};`)();
}

runTest('manifest injects DeepSeek and does not inject Claude', () => {
    assert.ok(manifest.host_permissions.includes('https://chat.deepseek.com/*'));
    assert.equal(manifest.host_permissions.includes('https://claude.ai/*'), false);

    const scriptEntries = manifest.content_scripts || [];
    const allScriptPaths = scriptEntries.flatMap((entry) => entry.js || []);
    assert.ok(allScriptPaths.includes('src/content/adapter_deepseek.js'));
    assert.equal(allScriptPaths.includes('src/content/adapter_claude.js'), false);

    const deepseekEntry = scriptEntries.find((entry) => (
        (entry.matches || []).includes('https://chat.deepseek.com/*')
    ));
    assert.ok(deepseekEntry, 'DeepSeek content script match should exist');
});

runTest('runtime enabled model registry includes DeepSeek and excludes Claude', () => {
    const modelNames = getModelNamesFromServiceWorker();

    assert.ok(modelNames.includes('DeepSeek'));
    assert.equal(modelNames.includes('Claude'), false);
    assert.deepEqual(modelNames, ['ChatGPT', 'Grok', 'Gemini', 'Doubao', 'DeepSeek']);
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

console.log(`Completed ${passed}/${tests.length} manifest model checks.`);
