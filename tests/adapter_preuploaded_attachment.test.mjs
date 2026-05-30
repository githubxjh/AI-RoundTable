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

    return { AdapterBase: context.window.__TestAdapterBase, document: context.document };
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

runTest('selector-based attachment wait accepts a visible generic file preview', async () => {
    const { AdapterBase } = createHarness();
    const inputEl = { multiple: true, files: { length: 1 } };

    class TestAdapter extends AdapterBase {
        constructor() {
            super('TestModel');
            this._attachmentReadyTimeoutMs = 200;
        }

        startObservation() {}

        getAttachmentBusySelectors() {
            return ['[data-busy]'];
        }

        getAttachmentReadySelectors() {
            return ['[data-missing-ready]'];
        }

        findSendButton() {
            return null;
        }

        _detectGenericFilePreview() {
            return true;
        }
    }

    const adapter = new TestAdapter();
    await adapter.waitAttachmentReady(inputEl, [null]);
});

runTest('preuploaded CDP attachments can be ready from visible previews without a retained file input', async () => {
    const { AdapterBase, document } = createHarness();
    let queriedSelector = '';
    const preview = {
        tagName: 'DIV',
        closest() {
            return null;
        },
        getClientRects() {
            return [{}];
        }
    };
    class TestAdapter extends AdapterBase {
        constructor() {
            super('TestModel');
            this._attachmentReadyTimeoutMs = 200;
        }
        async findAttachmentInput() {
            return null;
        }
        findSendButton() {
            return {
                disabled: false,
                getAttribute() {
                    return '';
                },
                getClientRects() {
                    return [{}];
                }
            };
        }
    }

    document.querySelectorAll = (selector) => {
        queriedSelector = selector;
        return selector.includes('file-preview') ? [preview] : [];
    };
    document.defaultView = {
        getComputedStyle() {
            return { display: 'block', visibility: 'visible', opacity: '1' };
        }
    };

    const adapter = new TestAdapter();
    await adapter.waitForPreuploadedAttachments(1);

    assert.match(queriedSelector, /file-preview/);
});

runTest('preuploaded CDP attachments still fail when no input or preview exists', async () => {
    const { AdapterBase, document } = createHarness();
    class TestAdapter extends AdapterBase {
        constructor() {
            super('TestModel');
            this._attachmentReadyTimeoutMs = 80;
        }
        async findAttachmentInput() {
            return null;
        }
    }

    document.querySelectorAll = () => [];

    const adapter = new TestAdapter();
    await assert.rejects(
        () => adapter.waitForPreuploadedAttachments(1),
        /File input was not found after CDP attachment upload/
    );
});

runTest('attachment send confirmation treats an empty composer as submitted', async () => {
    const { AdapterBase } = createHarness();

    class TestAdapter extends AdapterBase {
        constructor() {
            super('TestModel');
            this._hasAttachments = true;
        }

        startObservation() {}
    }

    const adapter = new TestAdapter();
    const inputEl = {
        textContent: '',
        innerText: '',
        getAttribute() {
            return '';
        }
    };

    assert.equal(adapter.hasInputBeenSubmitted(inputEl, ''), true);
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
