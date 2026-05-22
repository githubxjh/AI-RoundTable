import assert from 'node:assert/strict';

import {
    ATTACHMENT_METHODS,
    ATTACHMENT_STATUS,
    getAttachmentCapability,
    getAttachmentKind,
    normalizeAttachmentPayloads,
    summarizeAttachmentCapabilities
} from '../src/utils/attachment_capabilities.mjs';

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('classifies supported attachment kinds from mime type and extension', () => {
    assert.equal(getAttachmentKind({ name: 'diagram.png', mimeType: 'image/png' }), 'image');
    assert.equal(getAttachmentKind({ name: 'brief.pdf', mimeType: '' }), 'pdf');
    assert.equal(getAttachmentKind({ name: 'notes.md', mimeType: 'text/markdown' }), 'text');
    assert.equal(getAttachmentKind({ name: 'archive.zip', mimeType: 'application/zip' }), 'unknown');
});

runTest('keeps DeepSeek manual in Lite while allowing Advanced CDP', () => {
    const attachments = [{ name: 'brief.pdf', mimeType: 'application/pdf', size: 1024, base64: 'abc' }];

    const lite = getAttachmentCapability('DeepSeek', attachments, { advanced: false });
    assert.equal(lite.status, ATTACHMENT_STATUS.manualRequired);
    assert.equal(lite.method, ATTACHMENT_METHODS.manual);

    const advanced = getAttachmentCapability('DeepSeek', attachments, { advanced: true });
    assert.equal(advanced.status, ATTACHMENT_STATUS.supported);
    assert.equal(advanced.method, ATTACHMENT_METHODS.cdpAdvanced);
});

runTest('summarizes mixed Lite attachment outcomes for user confirmation', () => {
    const attachments = [{ name: 'photo.png', mimeType: 'image/png', size: 68, base64: 'abc' }];
    const summary = summarizeAttachmentCapabilities(['ChatGPT', 'Gemini', 'DeepSeek'], attachments, { advanced: false });

    assert.deepEqual(summary.autoModels, ['ChatGPT', 'Gemini']);
    assert.deepEqual(summary.manualModels, ['DeepSeek']);
    assert.equal(summary.hasManualRequired, true);
});

runTest('normalizes attachment payloads with shared Lite limits', () => {
    const result = normalizeAttachmentPayloads([
        { name: 'notes.md', mimeType: '', size: 12, base64: 'YWJj' }
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.attachments[0].mimeType, 'text/markdown');
});

runTest('rejects unsupported attachment payloads before broadcast', () => {
    const result = normalizeAttachmentPayloads([
        { name: 'archive.zip', mimeType: 'application/zip', size: 12, base64: 'YWJj' }
    ]);

    assert.equal(result.ok, false);
    assert.match(result.message, /Unsupported attachment type/);
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

console.log(`Completed ${passed}/${tests.length} attachment capability checks.`);
