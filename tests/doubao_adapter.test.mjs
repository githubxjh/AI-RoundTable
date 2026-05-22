import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const adapterBaseSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_base.js'),
    'utf8'
);
const doubaoSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_doubao.js'),
    'utf8'
).replace(/new DoubaoAdapter\(\);\s*$/, 'window.__TestDoubaoAdapter = DoubaoAdapter;\n');

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

class FakeNode {
    constructor({
        text = '',
        attrs = {},
        className = '',
        childrenBySelector = {},
        closestSelectors = []
    } = {}) {
        this.innerText = text;
        this.textContent = text;
        this.attrs = attrs;
        this.className = className;
        this.childrenBySelector = childrenBySelector;
        this.closestSelectors = closestSelectors;
        this.disabled = false;
    }

    getAttribute(name) {
        if (name === 'class') return this.className;
        return this.attrs[name] || '';
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        return this.childrenBySelector[selector] || [];
    }

    closest(selector) {
        return this.closestSelectors.some((item) => selector.includes(item)) ? this : null;
    }

    getClientRects() {
        return [{}];
    }

    matches(selector) {
        return selector.includes('button') && this.attrs.tagName === 'button';
    }

    focus() {}

    dispatchEvent() {}
}

function createHarness({ querySelectorAll = () => [], querySelector = () => null } = {}) {
    const runtimeMessages = [];

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
        querySelector,
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
            sendMessage(payload) {
                runtimeMessages.push(payload);
                return Promise.resolve();
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(adapterBaseSource, context, { filename: 'adapter_base.js' });
    vm.runInContext(doubaoSource, context, { filename: 'adapter_doubao.js' });

    return {
        DoubaoAdapter: context.window.__TestDoubaoAdapter,
        runtimeMessages
    };
}

runTest('doubao adapter extracts the latest answer from the modern message DOM', () => {
    const userMessage = new FakeNode({
        text: '用户问题',
        className: 'flex-row flex w-full justify-end',
        childrenBySelector: {
            '[class*="send-msg-bubble"]': [new FakeNode({ text: '用户问题' })]
        }
    });
    const olderAnswer = new FakeNode({
        className: 'relative flex-row flex w-full',
        childrenBySelector: {
            '.flow-markdown-body': [new FakeNode({ text: '旧回答' })]
        }
    });
    const latestAnswer = new FakeNode({
        className: 'relative flex-row flex w-full',
        childrenBySelector: {
            '.flow-markdown-body': [new FakeNode({ text: '最新豆包回答 LIVE_OK' })]
        }
    });

    const { DoubaoAdapter } = createHarness({
        querySelectorAll(selector) {
            if (selector === '[data-message-id]') return [userMessage, olderAnswer, latestAnswer];
            return [];
        }
    });
    const adapter = new DoubaoAdapter();

    assert.equal(adapter.getLastAssistantText(), '最新豆包回答 LIVE_OK');
});

runTest('doubao adapter ignores collapsed thinking blocks in modern messages', () => {
    const thinkingText = new FakeNode({
        text: '已完成思考',
        closestSelectors: ['block_type:10040']
    });
    const answerText = new FakeNode({ text: '最终回答 LIVE_OK' });
    const message = new FakeNode({
        className: 'relative flex-row flex w-full',
        childrenBySelector: {
            '.flow-markdown-body': [thinkingText, answerText]
        }
    });

    const { DoubaoAdapter } = createHarness({
        querySelectorAll(selector) {
            if (selector === '[data-message-id]') return [message];
            return [];
        }
    });
    const adapter = new DoubaoAdapter();

    assert.equal(adapter.getLastAssistantText(), '最终回答 LIVE_OK');
});

runTest('doubao adapter syncs an existing completed answer after page load', async () => {
    const latestAnswer = new FakeNode({
        className: 'relative flex-row flex w-full',
        childrenBySelector: {
            '.flow-markdown-body': [new FakeNode({ text: '页面已有回答 LIVE_OK' })]
        }
    });

    const { DoubaoAdapter, runtimeMessages } = createHarness({
        querySelectorAll(selector) {
            if (selector === '[data-message-id]') return [latestAnswer];
            return [];
        }
    });
    new DoubaoAdapter();

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(
        runtimeMessages.some((payload) => payload.status === 'idle' && payload.summary === '页面已有回答 LIVE_OK'),
        true
    );
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

console.log(`Completed ${passed}/${tests.length} Doubao adapter checks.`);
