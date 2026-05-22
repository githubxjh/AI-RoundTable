import assert from 'node:assert/strict';

import {
    ADVANCED_TEMP_ROOT,
    buildAdvancedDownloadFilename,
    buildAttachmentDataUrl,
    createDeferredDownloadCleanup,
    sanitizeDownloadName
} from '../src/background/advanced_attachment_service.mjs';

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('builds safe relative filenames under the advanced temp root', () => {
    assert.equal(sanitizeDownloadName('..\\brief:final?.pdf'), 'brief_final_.pdf');
    assert.equal(
        buildAdvancedDownloadFilename('task/../42', '..\\brief:final?.pdf'),
        `${ADVANCED_TEMP_ROOT}/task_.._42/brief_final_.pdf`
    );
});

runTest('builds data URLs from normalized attachment payloads', () => {
    const url = buildAttachmentDataUrl({
        name: 'tiny.txt',
        mimeType: 'text/plain',
        base64: 'SGVsbG8='
    });

    assert.equal(url, 'data:text/plain;base64,SGVsbG8=');
});

runTest('deferred cleanup removes files then erases download records', async () => {
    const calls = [];
    const chromeApi = {
        downloads: {
            removeFile(id, callback) {
                calls.push(['removeFile', id]);
                callback?.();
            },
            erase(query, callback) {
                calls.push(['erase', query.id]);
                callback?.([]);
            }
        },
        runtime: {}
    };

    const cleanup = createDeferredDownloadCleanup(chromeApi, { delayMs: 0 });
    await cleanup([11, 12]);

    assert.deepEqual(calls, [
        ['removeFile', 11],
        ['erase', 11],
        ['removeFile', 12],
        ['erase', 12]
    ]);
});

let passed = 0;

for (const { name, fn } of tests) {
    try {
        await fn();
        passed += 1;
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        throw error;
    }
}

console.log(`Completed ${passed}/${tests.length} advanced attachment service checks.`);
