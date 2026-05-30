import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const adapterBaseSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_base.js'),
    'utf8'
);
const geminiSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'content', 'adapter_gemini.js'),
    'utf8'
).replace(/new GeminiAdapter\(\);\s*$/, 'window.__TestGeminiAdapter = GeminiAdapter;\n');

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
            sendMessage() {
                return Promise.resolve();
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(adapterBaseSource, context, { filename: 'adapter_base.js' });
    vm.runInContext(geminiSource, context, { filename: 'adapter_gemini.js' });

    return {
        GeminiAdapter: context.window.__TestGeminiAdapter,
        document
    };
}

function createButton({ ariaLabel = '', title = '', text = '', iconName = '' } = {}) {
    return {
        disabled: false,
        innerText: text,
        getAttribute(name) {
            if (name === 'aria-label') return ariaLabel;
            if (name === 'title') return title;
            return '';
        },
        getClientRects() {
            return [{}];
        },
        matches(selector) {
            return selector === 'button' || selector.includes('button');
        },
        closest() {
            return this;
        },
        querySelector(selector) {
            if (selector === 'mat-icon' && iconName) {
                return {
                    getAttribute(name) {
                        return name === 'data-mat-icon-name' ? iconName : '';
                    }
                };
            }
            return null;
        }
    };
}

function createVisibleNode({ ariaBusy = '', className = '', text = '' } = {}) {
    return {
        isContentEditable: false,
        innerText: text,
        textContent: text,
        className,
        getAttribute(name) {
            if (name === 'aria-busy') return ariaBusy;
            return '';
        },
        getClientRects() {
            return [{}];
        },
        closest() {
            return null;
        }
    };
}

runTest('gemini handleInput activates the native send button click', async () => {
    const { GeminiAdapter } = createHarness();
    const adapter = new GeminiAdapter();
    const inputEl = {
        innerText: '',
        textContent: '',
        focus() {},
        dispatchEvent() {},
        getAttribute() {
            return '';
        }
    };
    let nativeClickCount = 0;
    const sendBtn = {
        disabled: false,
        getAttribute() {
            return '';
        },
        getClientRects() {
            return [{}];
        },
        dispatchEvent() {},
        click() {
            nativeClickCount += 1;
        }
    };

    adapter.waitForElement = async () => inputEl;
    adapter.delay = async () => {};
    adapter.simulateUserInput = (node, text) => {
        node.innerText = text;
        node.textContent = text;
    };
    let sendButtonTimeout = 0;
    adapter.waitForAvailableSendButton = async (timeoutMs) => {
        sendButtonTimeout = timeoutMs;
        return sendBtn;
    };

    const result = await adapter.handleInput('Reply with LIVE_OK only. No explanation.');

    assert.equal(nativeClickCount, 1);
    assert.equal(sendButtonTimeout, 7000);
    assert.equal(result.inputEl, inputEl);
    assert.equal(result.text, 'Reply with LIVE_OK only. No explanation.');
    assert.equal(result.sendButtonBefore, sendBtn);
});

runTest('gemini generation detector ignores sidebar titles containing stop words', () => {
    const { GeminiAdapter, document } = createHarness();
    const adapter = new GeminiAdapter();
    const sidebarAction = createButton({
        ariaLabel: '\u201c\u4e2d\u79d1\u9662\u8c03\u6574\u8bc4\u4ef7\u4f53\u7cfb\uff0c\u505c\u6b62\u7248\u9762\u8d39\u201d\u7684\u66f4\u591a\u9009\u9879'
    });

    document.querySelector = () => null;
    document.querySelectorAll = (selector) => (
        selector === 'button, [role="button"]' ? [sidebarAction] : []
    );

    assert.equal(adapter.isGeneratingIndicatorActive(), false);
});

runTest('gemini generation detector accepts real stop generation labels', () => {
    const { GeminiAdapter, document } = createHarness();
    const adapter = new GeminiAdapter();
    const stopAction = createButton({
        ariaLabel: '\u505c\u6b62\u751f\u6210'
    });

    document.querySelector = () => null;
    document.querySelectorAll = (selector) => (
        selector === 'button, [role="button"]' ? [stopAction] : []
    );

    assert.equal(adapter.isGeneratingIndicatorActive(), true);
});

runTest('gemini generation detector accepts visible busy response panels', () => {
    const { GeminiAdapter, document } = createHarness();
    const adapter = new GeminiAdapter();
    const busyResponse = createVisibleNode({
        ariaBusy: 'true',
        className: 'markdown markdown-main-panel'
    });

    document.querySelector = () => null;
    document.querySelectorAll = (selector) => (
        selector.includes('[aria-busy="true"]') ? [busyResponse] : []
    );

    assert.equal(adapter.isGeneratingIndicatorActive(), true);
});

runTest('gemini send button lookup ignores history action labels containing send words', () => {
    const { GeminiAdapter, document } = createHarness();
    const adapter = new GeminiAdapter();
    const historyAction = createButton({
        ariaLabel: '\u201cChrome MV3 \u9644\u4ef6\u53d1\u9001\u6311\u6218\u4e0e\u5bf9\u7b56\u201d\u7684\u66f4\u591a\u9009\u9879',
        iconName: 'more_vert'
    });
    const composerSend = createButton({
        ariaLabel: '\u53d1\u9001',
        iconName: 'arrow_upward'
    });

    document.querySelectorAll = () => [historyAction, composerSend];

    assert.equal(adapter.findSendButton(), composerSend);
});

runTest('gemini prepares a CDP file chooser trigger when no static file input exists', async () => {
    const { GeminiAdapter } = createHarness();
    const adapter = new GeminiAdapter();
    let opened = false;

    adapter.openAttachmentUIIfNeeded = async () => {
        opened = true;
    };
    adapter.findAttachmentInput = async () => null;

    const result = await adapter.prepareAttachmentInput();

    assert.equal(opened, true);
    assert.equal(result.status, 'attachment_input_ready');
    assert.equal(result.inputMode, 'file_chooser');
    assert.match(result.triggerExpression, /local-images-files-uploader-button/);
    assert.match(result.triggerExpression, /xapfileselectortrigger/);
    assert.match(result.triggerExpression, /role="menuitem"/);
    assert.match(result.triggerExpression, /上传文件/);
    assert.match(result.triggerExpression, /Google Drive/);
    assert.match(result.triggerExpression, /visibleLocalFileButton/);
    assert.match(result.triggerExpression, /hiddenLocalFileButton/);
    assert.match(result.triggerExpression, /pointerdown/);
    assert.match(result.triggerExpression, /uploadMenuScore/);
    assert.match(result.triggerExpression, /gem-conversation-actions-menu-button/);
    assert.match(result.triggerExpression, /more_vert/);
    assert.match(result.triggerExpression, /上传和工具/);
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

console.log(`Completed ${passed}/${tests.length} Gemini adapter checks.`);
