import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const adapterBaseSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_base.js'),
    'utf8'
);

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
        MutationObserver: BareMutationObserver,
        document: {
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
            }
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
    context.chrome = {
        runtime: {
            onMessage: {
                addListener() {}
            },
            sendMessage() {
                return Promise.resolve();
            }
        },
        storage: {
            local: {
                get(_keys, callback) {
                    callback?.({});
                },
                set() {}
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(`${adapterBaseSource}\nwindow.__TestAdapterBase = AdapterBase;`, context, {
        filename: 'adapter_base.js'
    });

    return { AdapterBase: context.window.__TestAdapterBase };
}

runTest('preuploaded CDP attachments wait for readiness without reassigning files', async () => {
    const { AdapterBase } = createHarness();
    const inputEl = { multiple: true, files: { length: 2 } };

    class TestAdapter extends AdapterBase {
        constructor() {
            super('TestModel');
            this.attachFilesCalled = false;
            this.waitedCount = 0;
        }

        startObservation() {}

        async attachFiles() {
            this.attachFilesCalled = true;
        }

        async findAttachmentInput() {
            return inputEl;
        }

        async waitAttachmentReady(_inputEl, files) {
            this.waitedCount = files.length;
        }

        async handleInput(text) {
            this.handledText = text;
            return { inputEl: null, text, skipConfirm: true };
        }
    }

    const adapter = new TestAdapter();
    const result = await adapter.handlePrompt({
        text: 'hello',
        preuploadedAttachmentCount: 2
    });

    assert.equal(result.status, 'input_simulated');
    assert.equal(adapter.attachFilesCalled, false);
    assert.equal(adapter.waitedCount, 2);
    assert.equal(adapter.handledText, 'hello');
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

console.log(`Completed ${passed}/${tests.length} preuploaded attachment adapter checks.`);
