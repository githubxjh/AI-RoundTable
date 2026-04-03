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

function createAdapterBaseHarness() {
    const runtimeMessages = [];
    const observerRecords = [];

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

        observe(target, options) {
            observerRecords.push({ target, options });
        }

        disconnect() {}
    }

    class BareDataTransfer {
        constructor() {
            const files = [];
            this.files = files;
            this.items = {
                add(file) {
                    files.push(file);
                }
            };
        }
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
        File: class BareFile {
            constructor(parts = [], name = '', options = {}) {
                this.parts = parts;
                this.name = name;
                this.type = options.type || '';
            }
        },
        DataTransfer: BareDataTransfer,
        atob(value) {
            return Buffer.from(String(value || ''), 'base64').toString('binary');
        }
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
            sendMessage(payload) {
                runtimeMessages.push(payload);
                return Promise.resolve();
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(adapterBaseSource, context, {
        filename: 'adapter_base.js'
    });

    return {
        AdapterBase: context.window.AdapterBase,
        runtimeMessages,
        observerRecords
    };
}

runTest('adapter watchdog promotes a settled response to idle even without new DOM mutations', async () => {
    const { AdapterBase, runtimeMessages } = createAdapterBaseHarness();
    assert.equal(typeof AdapterBase, 'function');

    class TestAdapter extends AdapterBase {
        constructor() {
            super('TestModel');
            this.checkCount = 0;
            this._responseWatchdogIntervalMs = 15;
        }

        async handleInput(text) {
            return {
                inputEl: null,
                text,
                sendButtonBefore: null
            };
        }

        async confirmSendTriggered() {
            return true;
        }

        onSendPostProcessing() {
            this.isGenerating = true;
            this.sendUpdate('generating', 'Waiting for response...');
        }

        checkForNewResponse() {
            this.checkCount += 1;
            if (this.checkCount >= 2) {
                this.isGenerating = false;
                this.sendUpdate('idle', 'LIVE_OK');
            }
        }
    }

    const adapter = new TestAdapter();
    await adapter.handlePrompt({ text: 'Reply with LIVE_OK only. No explanation.' });
    await new Promise((resolve) => setTimeout(resolve, 90));

    assert.ok(
        adapter.checkCount >= 2,
        `Expected watchdog polling to run at least twice, got ${adapter.checkCount}`
    );
    assert.equal(
        runtimeMessages.some((payload) => payload.status === 'idle' && payload.summary === 'LIVE_OK'),
        true
    );

    const countAfterIdle = adapter.checkCount;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(adapter.checkCount, countAfterIdle);
});

runTest('adapter observation watches attribute changes that can signal generation finished', () => {
    const { AdapterBase, observerRecords } = createAdapterBaseHarness();

    class TestAdapter extends AdapterBase {
        constructor() {
            super('TestModel');
        }
    }

    new TestAdapter();

    assert.ok(observerRecords.length >= 1, 'Expected MutationObserver.observe to be called');
    const lastObserve = observerRecords.at(-1)?.options || {};
    assert.equal(lastObserve.childList, true);
    assert.equal(lastObserve.subtree, true);
    assert.equal(lastObserve.characterData, true);
    assert.equal(lastObserve.attributes, true);
    assert.equal(Array.isArray(lastObserve.attributeFilter), true);
    assert.equal(lastObserve.attributeFilter.includes('class'), true);
    assert.equal(lastObserve.attributeFilter.includes('aria-disabled'), true);
});

runTest('generating updates from a fresh page bootstrap the watchdog after route changes', async () => {
    const { AdapterBase, runtimeMessages } = createAdapterBaseHarness();

    class TestAdapter extends AdapterBase {
        constructor() {
            super('TestModel');
            this.checkCount = 0;
            this._responseWatchdogIntervalMs = 15;
            this.isGenerating = true;
        }

        checkForNewResponse() {
            this.checkCount += 1;
            if (this.checkCount >= 2) {
                this.isGenerating = false;
                this.sendUpdate('idle', 'LIVE_OK');
            }
        }
    }

    const adapter = new TestAdapter();
    adapter.sendUpdate('generating', 'LIVE_OK');
    await new Promise((resolve) => setTimeout(resolve, 90));

    assert.ok(
        adapter.checkCount >= 2,
        `Expected generating update to bootstrap polling, got ${adapter.checkCount}`
    );
    assert.equal(
        runtimeMessages.some((payload) => payload.status === 'idle' && payload.summary === 'LIVE_OK'),
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

console.log(`Completed ${passed}/${tests.length} adapter watchdog checks.`);
