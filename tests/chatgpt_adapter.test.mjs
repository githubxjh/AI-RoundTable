import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const adapterBaseSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_base.js'),
    'utf8'
);
const chatgptSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_gpt.js'),
    'utf8'
).replace(/new ChatGPTAdapter\(\);\s*$/, 'window.__TestChatGPTAdapter = ChatGPTAdapter;\n');

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

function createHarness() {
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
        MutationObserver: BareMutationObserver
    };

    context.document = {
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

    context.window = {
        document: context.document,
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
    vm.runInContext(adapterBaseSource, context, {
        filename: 'adapter_base.js'
    });
    vm.runInContext(chatgptSource, context, {
        filename: 'adapter_gpt.js'
    });

    return {
        ChatGPTAdapter: context.window.__TestChatGPTAdapter
    };
}

runTest('chatgpt adapter finalizes when a partial trailing underscore becomes a stable final answer', () => {
    const { ChatGPTAdapter } = createHarness();
    assert.equal(typeof ChatGPTAdapter, 'function');

    const adapter = new ChatGPTAdapter();
    const updates = [];

    adapter.expectingNewMessage = false;
    adapter.stableText = 'LIVE_OK_';
    adapter.stableTicks = 1;
    adapter.lastSentContent = 'LIVE_OK_';
    adapter.isGenerating = true;
    adapter.getLastAssistantText = () => 'LIVE_OK';
    adapter.isGeneratingIndicatorActive = () => false;
    adapter.sendUpdate = (status, summary) => {
        updates.push({ status, summary });
    };

    adapter.checkForNewResponse();

    assert.equal(
        updates.some((item) => item.status === 'idle' && item.summary === 'LIVE_OK'),
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

console.log(`Completed ${passed}/${tests.length} ChatGPT adapter checks.`);
