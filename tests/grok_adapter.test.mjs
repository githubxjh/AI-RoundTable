import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const adapterBaseSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_base.js'),
    'utf8'
);
const grokSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_grok.js'),
    'utf8'
).replace(/new GrokAdapter\(\);\s*$/, 'window.__TestGrokAdapter = GrokAdapter;\n');

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

function createHarness() {
    const runtimeMessages = [];

    class BareEvent {
        constructor(type, init = {}) {
            this.type = type;
            Object.assign(this, init);
        }
    }

    class BareMutationObserver {
        observe() {}
        disconnect() {}
    }

    const document = {
        body: {},
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
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
    vm.runInContext(grokSource, context, { filename: 'adapter_grok.js' });

    return {
        GrokAdapter: context.window.__TestGrokAdapter,
        runtimeMessages
    };
}

runTest('grok handleInput returns dispatch state for base send confirmation', async () => {
    const { GrokAdapter, runtimeMessages } = createHarness();
    const adapter = new GrokAdapter();
    const inputEl = {
        innerText: '',
        textContent: '',
        focus() {},
        dispatchEvent() {},
        getAttribute() {
            return '';
        }
    };
    const sendBtn = {
        disabled: false,
        getAttribute() {
            return '';
        },
        getClientRects() {
            return [{}];
        },
        dispatchEvent() {}
    };

    adapter.waitForElement = async () => inputEl;
    adapter.delay = async () => {};
    adapter.simulateUserInput = (node, text) => {
        node.innerText = text;
        node.textContent = text;
    };
    adapter.findSendButton = () => sendBtn;
    adapter.simulateClick = () => {
        inputEl.innerText = '';
        inputEl.textContent = '';
    };

    const result = await adapter.handleInput('Reply with LIVE_OK only. No explanation.');

    assert.equal(result.inputEl, inputEl);
    assert.equal(result.text, 'Reply with LIVE_OK only. No explanation.');
    assert.equal(result.sendButtonBefore, sendBtn);
    assert.equal(
        runtimeMessages.some((payload) => payload.status === 'generating'),
        false,
        'Grok handleInput should not mark generating before base confirmation passes'
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

console.log(`Completed ${passed}/${tests.length} Grok adapter checks.`);
