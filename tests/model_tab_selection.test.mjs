import assert from 'node:assert/strict';

let selectionModule;

try {
    selectionModule = await import('../src/background/model_tab_selection.mjs');
} catch (error) {
    selectionModule = { __importError: error };
}

const {
    createEmptyModelTabs,
    getModelForTabUrl,
    selectModelTabs
} = selectionModule;

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('model tab selection module is loadable', () => {
    assert.ok(!selectionModule.__importError, selectionModule.__importError?.message);
    assert.equal(typeof createEmptyModelTabs, 'function');
    assert.equal(typeof getModelForTabUrl, 'function');
    assert.equal(typeof selectModelTabs, 'function');
});

runTest('detects known model tabs from supported URLs', () => {
    assert.equal(getModelForTabUrl('https://chatgpt.com/'), 'ChatGPT');
    assert.equal(getModelForTabUrl('https://grok.com/'), 'Grok');
    assert.equal(getModelForTabUrl('https://x.com/i/grok'), 'Grok');
    assert.equal(getModelForTabUrl('https://gemini.google.com/app'), 'Gemini');
    assert.equal(getModelForTabUrl('https://www.doubao.com/chat/'), 'Doubao');
    assert.equal(getModelForTabUrl('https://flow-chat.gf.bytedance.net/chat'), 'Doubao');
    assert.equal(getModelForTabUrl('https://chat.deepseek.com/'), 'DeepSeek');
    assert.equal(getModelForTabUrl('https://example.com/'), '');
});

runTest('prefers the active Gemini tab in the last focused window over a later matching tab', () => {
    const selected = selectModelTabs([
        {
            id: 10,
            url: 'https://gemini.google.com/app',
            windowId: 1,
            active: true,
            highlighted: true,
            lastAccessed: 100
        },
        {
            id: 11,
            url: 'https://gemini.google.com/gem/example',
            windowId: 2,
            active: false,
            highlighted: false,
            lastAccessed: 999999
        }
    ], {
        lastFocusedWindowId: 1
    });

    assert.equal(selected.Gemini, 10);
});

runTest('falls back to the most recently accessed same-model tab when no tab is active', () => {
    const selected = selectModelTabs([
        {
            id: 20,
            url: 'https://chat.deepseek.com/',
            windowId: 1,
            active: false,
            lastAccessed: 100
        },
        {
            id: 21,
            url: 'https://chat.deepseek.com/',
            windowId: 1,
            active: false,
            lastAccessed: 300
        }
    ], {
        lastFocusedWindowId: 1
    });

    assert.equal(selected.DeepSeek, 21);
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

console.log(`Completed ${passed}/${tests.length} model tab selection checks.`);
