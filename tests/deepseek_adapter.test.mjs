import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const adapterBaseSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_base.js'),
    'utf8'
);
const deepseekSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_deepseek.js'),
    'utf8'
).replace(/new DeepSeekAdapter\(\);\s*$/, 'window.__TestDeepSeekAdapter = DeepSeekAdapter;\n');

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

class FakeNode {
    constructor({
        text = '',
        disabled = false,
        attrs = {},
        classes = [],
        rects = [{}],
        parent = null
    } = {}) {
        this.innerText = text;
        this.textContent = text;
        this.disabled = disabled;
        this.attrs = attrs;
        this.classes = new Set(classes);
        this.rects = rects;
        this.parentElement = parent;
        this.isContentEditable = false;
    }

    getAttribute(name) {
        if (name === 'class') return [...this.classes].join(' ');
        return this.attrs[name] || '';
    }

    getClientRects() {
        return this.rects;
    }

    matches(selector) {
        if (selector.includes('button') && this.attrs.tagName === 'button') return true;
        if (selector.includes('[role="button"]') && this.attrs.role === 'button') return true;
        return false;
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (selector === '.ds-think-content' && current.classes.has('ds-think-content')) return current;
            if (selector === 'form' && current.attrs.tagName === 'form') return current;
            if (selector.includes('textarea') && current.attrs.tagName === 'textarea') return current;
            current = current.parentElement;
        }
        return null;
    }

    querySelectorAll() {
        return [];
    }

    focus() {}

    dispatchEvent() {}
}

function createHarness({ querySelectorAll = () => [] } = {}) {
    class BareEvent {
        constructor(type, init = {}) {
            this.type = type;
            Object.assign(this, init);
        }
    }

    class BareMutationObserver {
        constructor(callback) {
            this.callback = callback;
        }

        observe() {}

        disconnect() {}
    }

    const document = {
        body: {},
        querySelector() {
            return null;
        },
        querySelectorAll,
        queryCommandSupported() {
            return false;
        },
        execCommand() {
            return false;
        },
        createRange() {
            return {
                selectNodeContents() {},
                setStart() {},
                setEnd() {},
                collapse() {}
            };
        }
    };

    const context = {
        console,
        setTimeout,
        clearTimeout,
        Promise,
        Date,
        Math,
        Array,
        Object,
        String,
        Boolean,
        Number,
        RegExp,
        URL,
        Event: BareEvent,
        KeyboardEvent: BareEvent,
        MouseEvent: BareEvent,
        MutationObserver: BareMutationObserver,
        document
    };

    context.window = {
        document,
        getSelection() {
            return {
                removeAllRanges() {},
                addRange() {}
            };
        },
        HTMLTextAreaElement: function HTMLTextAreaElement() {}
    };
    Object.defineProperty(context.window.HTMLTextAreaElement.prototype, 'value', {
        set(value) {
            this._value = value;
        }
    });

    context.chrome = {
        runtime: {
            onMessage: {
                addListener() {}
            },
            sendMessage() {
                return Promise.resolve();
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(adapterBaseSource, context, { filename: 'adapter_base.js' });
    vm.runInContext(deepseekSource, context, { filename: 'adapter_deepseek.js' });

    return {
        DeepSeekAdapter: context.window.__TestDeepSeekAdapter
    };
}

runTest('deepseek adapter module is loadable and targets textarea input', () => {
    const { DeepSeekAdapter } = createHarness();
    const adapter = new DeepSeekAdapter();

    assert.equal(typeof DeepSeekAdapter, 'function');
    assert.match(adapter.getInputSelector(), /textarea/);
});

runTest('deepseek adapter chooses the send button instead of nearby tool buttons', () => {
    const uploadButton = new FakeNode({
        text: 'Attach',
        attrs: { tagName: 'button', 'aria-label': 'Attach file' }
    });
    const searchButton = new FakeNode({
        text: '联网搜索',
        attrs: { tagName: 'button', title: '联网搜索' }
    });
    const sendButton = new FakeNode({
        text: '',
        attrs: { tagName: 'button', 'aria-label': '发送' }
    });
    const { DeepSeekAdapter } = createHarness({
        querySelectorAll(selector) {
            if (selector.includes('button')) return [uploadButton, searchButton, sendButton];
            return [];
        }
    });
    const adapter = new DeepSeekAdapter();

    assert.equal(adapter.findSendButton(), sendButton);
});

runTest('deepseek adapter extracts final answer and ignores thinking markdown', () => {
    const thinkingWrapper = new FakeNode({ classes: ['ds-think-content'] });
    const thinking = new FakeNode({
        text: '这是一段思考过程，不应该进入最终回答。',
        parent: thinkingWrapper
    });
    const firstAnswer = new FakeNode({ text: '上一条最终回答' });
    const lastAnswer = new FakeNode({ text: '最终回答 LIVE_OK' });

    const { DeepSeekAdapter } = createHarness({
        querySelectorAll(selector) {
            if (selector === '.ds-markdown') return [thinking, firstAnswer, lastAnswer];
            return [];
        }
    });
    const adapter = new DeepSeekAdapter();

    assert.equal(adapter.getLastAssistantText(), '最终回答 LIVE_OK');
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

console.log(`Completed ${passed}/${tests.length} DeepSeek adapter checks.`);
