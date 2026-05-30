import assert from 'node:assert/strict';

import {
    collectGeminiUploadDiagnosticsFromPage,
    summarizeGeminiUploadDiagnostics
} from '../src/background/gemini_attachment_diagnostics.mjs';

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

function createNode({
    tagName = 'BUTTON',
    role = '',
    ariaLabel = '',
    title = '',
    text = '',
    className = '',
    visible = true,
    accept = '',
    multiple = false,
    special = false,
    fileInput = false
} = {}) {
    return {
        tagName,
        innerText: text,
        textContent: text,
        className,
        multiple,
        getAttribute(name) {
            if (name === 'role') return role;
            if (name === 'aria-label') return ariaLabel;
            if (name === 'title') return title;
            if (name === 'accept') return accept;
            return '';
        },
        getClientRects() {
            return visible ? [{}] : [];
        },
        matches(selector) {
            if (fileInput && selector === 'input[type="file"]') return true;
            if (special && selector.includes('[xapfileselectortrigger]')) return true;
            if (special && selector.includes('.hidden-local-file-upload-button')) return true;
            if (special && selector.includes('.hidden-local-upload-button')) return true;
            if (special && selector.includes('.hidden-local-file-image-selector-button')) return true;
            return selector
                .split(',')
                .map((part) => part.trim())
                .some((part) => part === tagName.toLowerCase());
        },
        closest() {
            return this;
        }
    };
}

function withPage(nodes, fn) {
    const previousDocument = globalThis.document;
    const previousLocation = globalThis.location;
    globalThis.document = {
        title: 'Gemini',
        querySelectorAll() {
            return nodes;
        }
    };
    globalThis.location = { href: 'https://gemini.google.com/app' };
    try {
        return fn();
    } finally {
        globalThis.document = previousDocument;
        globalThis.location = previousLocation;
    }
}

runTest('collects visible Gemini local upload menu candidates without page text sweep', () => {
    const upload = createNode({
        role: 'menuitem',
        text: '上传文件',
        className: 'mat-mdc-menu-item'
    });
    const drive = createNode({
        role: 'menuitem',
        text: '从 Google Drive 添加',
        className: 'mat-mdc-menu-item'
    });

    const diagnostics = withPage([upload, drive], () => collectGeminiUploadDiagnosticsFromPage());

    assert.equal(diagnostics.status, 'ok');
    assert.equal(diagnostics.counts.candidates, 2);
    assert.equal(diagnostics.counts.visibleLocalCandidates, 1);
    assert.equal(summarizeGeminiUploadDiagnostics(diagnostics), 'found_visible_local_upload:1');
});

runTest('summarizes hidden Gemini upload trigger when visible menu item is absent', () => {
    const hidden = createNode({
        className: 'hidden-local-file-upload-button',
        visible: false,
        special: true
    });

    const diagnostics = withPage([hidden], () => collectGeminiUploadDiagnosticsFromPage());

    assert.equal(diagnostics.counts.hiddenTriggers, 1);
    assert.equal(summarizeGeminiUploadDiagnostics(diagnostics), 'found_hidden_upload_trigger:1');
});

runTest('reports file input availability for static upload variants', () => {
    const input = createNode({
        tagName: 'INPUT',
        fileInput: true,
        accept: '.pdf,image/*',
        multiple: true,
        visible: false
    });

    const diagnostics = withPage([input], () => collectGeminiUploadDiagnosticsFromPage());

    assert.equal(diagnostics.counts.fileInputs, 1);
    assert.equal(diagnostics.candidates[0].accept, '.pdf,image/*');
});

runTest('ignores unrelated menu items to avoid collecting chat-adjacent text', () => {
    const unrelated = createNode({
        role: 'menuitem',
        text: 'Rename this conversation'
    });
    const upload = createNode({
        role: 'menuitem',
        text: 'Upload file'
    });

    const diagnostics = withPage([unrelated, upload], () => collectGeminiUploadDiagnosticsFromPage());

    assert.equal(diagnostics.counts.candidates, 1);
    assert.equal(diagnostics.candidates[0].text, 'Upload file');
});

runTest('ignores history more-options buttons even when the conversation title mentions attachments', () => {
    const historyMenu = createNode({
        ariaLabel: '"Chrome MV3 附件发送挑战与对策"的更多选项',
        iconName: 'more_vert',
        className: 'gem-conversation-actions-menu-button'
    });
    const uploadTools = createNode({
        ariaLabel: '上传和工具',
        iconName: 'plus'
    });

    const diagnostics = withPage([historyMenu, uploadTools], () => collectGeminiUploadDiagnosticsFromPage());

    assert.equal(diagnostics.counts.candidates, 1);
    assert.equal(diagnostics.counts.uploadMenuCandidates, 1);
    assert.equal(diagnostics.candidates[0].ariaLabel, '上传和工具');
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

console.log(`Completed ${passed}/${tests.length} Gemini attachment diagnostics checks.`);
