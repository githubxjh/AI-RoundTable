import assert from 'node:assert/strict';

let runtimeModule;

try {
    runtimeModule = await import('../scripts/lib/playwright_runtime.mjs');
} catch (error) {
    runtimeModule = { __importError: error };
}

const {
    parseChromeVersionText,
    validateAttachedChromeTarget,
    closeBrowserQuietly,
    ensureExtensionDeveloperRuntime,
    openExtensionPanel,
    reloadExtensionRuntime,
    resolveAttachedExtensionId
} = runtimeModule;

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('playwright runtime module is loadable', () => {
    assert.ok(!runtimeModule.__importError, runtimeModule.__importError?.message);
    assert.equal(typeof resolveAttachedExtensionId, 'function');
    assert.equal(typeof openExtensionPanel, 'function');
    assert.equal(typeof closeBrowserQuietly, 'function');
    assert.equal(typeof ensureExtensionDeveloperRuntime, 'function');
    assert.equal(typeof reloadExtensionRuntime, 'function');
    assert.equal(typeof parseChromeVersionText, 'function');
    assert.equal(typeof validateAttachedChromeTarget, 'function');
});

runTest('parseChromeVersionText extracts localized Chrome command and profile paths', () => {
    const parsed = parseChromeVersionText([
        'Google Chrome\t148.0.7778.179',
        '命令行\t"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9333 --user-data-dir="C:\\Users\\xiepro\\Desktop\\AI-RoundTable\\tools\\browser-profile\\chrome-user-data"',
        '个人资料路径\tC:\\Users\\xiepro\\Desktop\\AI-RoundTable\\tools\\browser-profile\\chrome-user-data\\Default'
    ].join('\n'));

    assert.match(parsed.commandLine, /remote-debugging-port=9333/);
    assert.match(parsed.profilePath, /AI-RoundTable/);
});

runTest('validateAttachedChromeTarget rejects a different project Chrome on the same machine', () => {
    const validation = validateAttachedChromeTarget({
        commandLine: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="D:\\丹纳赫实施资料上传\\.chrome-upload-profile"',
        profilePath: 'D:\\丹纳赫实施资料上传\\.chrome-upload-profile\\Default'
    }, {
        expectedUserDataDir: 'C:\\Users\\xiepro\\Desktop\\AI-RoundTable\\tools\\browser-profile\\chrome-user-data',
        expectedCdpPort: 9333
    });

    assert.equal(validation.ok, false);
    assert.match(validation.errors.join('\n'), /9333/);
    assert.match(validation.errors.join('\n'), /AI-RoundTable/);
});

runTest('validateAttachedChromeTarget accepts the dedicated AI-RoundTable attach profile', () => {
    const validation = validateAttachedChromeTarget({
        commandLine: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9333 --user-data-dir="C:\\Users\\xiepro\\Desktop\\AI-RoundTable\\tools\\browser-profile\\chrome-user-data"',
        profilePath: 'C:\\Users\\xiepro\\Desktop\\AI-RoundTable\\tools\\browser-profile\\chrome-user-data\\Default'
    }, {
        expectedUserDataDir: 'C:\\Users\\xiepro\\Desktop\\AI-RoundTable\\tools\\browser-profile\\chrome-user-data',
        expectedCdpPort: 9333
    });

    assert.equal(validation.ok, true);
});

runTest('resolveAttachedExtensionId falls back to an existing sidepanel page', async () => {
    const extensionId = await resolveAttachedExtensionId({
        context: {
            serviceWorkers() {
                return [];
            },
            pages() {
                return [
                    {
                        url() {
                            return 'https://chatgpt.com/';
                        }
                    },
                    {
                        url() {
                            return 'chrome-extension://pdhkkaaejmcmmjclmhmldhghlfohpjii/src/sidepanel/panel.html';
                        }
                    }
                ];
            }
        },
        repoRoot: 'C:\\Users\\xiepro\\Desktop\\AI-RoundTable',
        profileName: 'Default',
        preferencesPath: 'Z:\\missing\\Preferences',
        securePreferencesPath: 'Z:\\missing\\Secure Preferences'
    });

    assert.equal(extensionId, 'pdhkkaaejmcmmjclmhmldhghlfohpjii');
});

runTest('openExtensionPanel reuses an existing sidepanel page when one is already attached', async () => {
    let newPageCalled = false;
    const existingPage = {
        url() {
            return 'chrome-extension://pdhkkaaejmcmmjclmhmldhghlfohpjii/src/sidepanel/panel.html';
        },
        on() {},
        async bringToFront() {
            this.broughtToFront = true;
        }
    };

    const panel = await openExtensionPanel({
        pages() {
            return [
                {
                    url() {
                        return 'https://gemini.google.com/';
                    }
                },
                existingPage
            ];
        },
        async newPage() {
            newPageCalled = true;
            return {
                on() {},
                async goto() {}
            };
        }
    }, 'pdhkkaaejmcmmjclmhmldhghlfohpjii');

    assert.equal(panel, existingPage);
    assert.equal(existingPage.broughtToFront, true);
    assert.equal(newPageCalled, false);
});

runTest('reloadExtensionRuntime reloads from an extension page and waits for the worker', async () => {
    let evaluated = false;
    let closed = false;
    const worker = {
        url() {
            return 'chrome-extension://pdhkkaaejmcmmjclmhmldhghlfohpjii/src/background/service_worker.js';
        }
    };
    const page = {
        on() {},
        async goto(url) {
            assert.equal(url, 'chrome-extension://pdhkkaaejmcmmjclmhmldhghlfohpjii/src/sidepanel/panel.html');
        },
        async evaluate(fn) {
            globalThis.chrome = {
                runtime: {
                    reload() {
                        evaluated = true;
                    }
                }
            };
            try {
                fn();
            } finally {
                delete globalThis.chrome;
            }
        },
        async close() {
            closed = true;
        }
    };
    const context = {
        serviceWorkers() {
            return [worker];
        },
        async newPage() {
            return page;
        },
        async waitForEvent(eventName) {
            assert.equal(eventName, 'serviceworker');
            return worker;
        }
    };

    const result = await reloadExtensionRuntime(context, 'pdhkkaaejmcmmjclmhmldhghlfohpjii');

    assert.equal(result, worker);
    assert.equal(evaluated, true);
    assert.equal(closed, true);
});

runTest('reloadExtensionRuntime accepts a recovered runtime ping when no worker event is exposed', async () => {
    let evaluated = false;
    let messageSent = false;
    let workerWaits = 0;
    const page = {
        broughtToFront: false,
        url() {
            return this.panel ? 'chrome-extension://pdhkkaaejmcmmjclmhmldhghlfohpjii/src/sidepanel/panel.html' : 'about:blank';
        },
        on() {},
        async bringToFront() {
            this.broughtToFront = true;
        },
        async goto() {},
        async evaluate(fn, payload) {
            const document = {
                body: {
                    dataset: {
                        panelReady: 'true'
                    }
                }
            };
            globalThis.document = document;
            globalThis.chrome = {
                runtime: {
                    reload() {
                        evaluated = true;
                    },
                    async sendMessage(message) {
                        messageSent = message;
                        return { status: 'ok' };
                    }
                }
            };
            globalThis.__AI_RT_PANEL_STATUS__ = 'true';
            try {
                return await fn(payload);
            } finally {
                delete globalThis.chrome;
                delete globalThis.document;
                delete globalThis.__AI_RT_PANEL_STATUS__;
            }
        },
        async waitForFunction(fn) {
            globalThis.document = {
                body: {
                    dataset: {
                        panelReady: 'true'
                    }
                }
            };
            globalThis.__AI_RT_PANEL_STATUS__ = 'true';
            try {
                return fn();
            } finally {
                delete globalThis.document;
                delete globalThis.__AI_RT_PANEL_STATUS__;
            }
        },
        async waitForTimeout() {},
        async close() {}
    };
    const panelPage = { ...page, panel: true };
    const context = {
        serviceWorkers() {
            return [];
        },
        async newPage() {
            return page;
        },
        async waitForEvent(eventName) {
            assert.equal(eventName, 'serviceworker');
            workerWaits += 1;
            return null;
        },
        pages() {
            return [panelPage];
        }
    };

    const result = await reloadExtensionRuntime(context, 'pdhkkaaejmcmmjclmhmldhghlfohpjii', { timeoutMs: 1000 });

    assert.equal(result, null);
    assert.equal(evaluated, true);
    assert.deepEqual(messageSent, { type: 'ROUND_LIST', limit: 1 });
    assert.equal(workerWaits, 1);
});

runTest('ensureExtensionDeveloperRuntime enables developer mode and reloads a disabled unpacked extension', async () => {
    const calls = [];
    const page = {
        on() {},
        async goto(url) {
            calls.push(['goto', url]);
        },
        async waitForTimeout(timeoutMs) {
            calls.push(['wait', timeoutMs]);
        },
        async evaluate(fn, payload) {
            const state = {
                developerMode: false,
                extensionEnabled: false
            };
            globalThis.chrome = {
                developerPrivate: {
                    async getProfileConfiguration() {
                        return {
                            canLoadUnpacked: true,
                            inDeveloperMode: state.developerMode,
                            isDeveloperModeControlledByPolicy: false
                        };
                    },
                    async updateProfileConfiguration(config) {
                        calls.push(['updateProfileConfiguration', config]);
                        if (config.inDeveloperMode) state.developerMode = true;
                    },
                    async reload(extensionId) {
                        calls.push(['reload', extensionId]);
                        state.extensionEnabled = true;
                    },
                    async getExtensionInfo(extensionId) {
                        calls.push(['getExtensionInfo', extensionId]);
                        return {
                            id: extensionId,
                            state: state.extensionEnabled ? 'ENABLED' : 'DISABLED',
                            disableReasons: {
                                unsupportedDeveloperExtension: !state.developerMode
                            },
                            manifestErrors: [],
                            runtimeErrors: [],
                            views: state.extensionEnabled
                                ? [{
                                    type: 'EXTENSION_SERVICE_WORKER_BACKGROUND',
                                    url: `chrome-extension://${extensionId}/src/background/service_worker.js`
                                }]
                                : []
                        };
                    }
                }
            };
            try {
                return await fn(payload);
            } finally {
                delete globalThis.chrome;
            }
        },
        async close() {
            calls.push(['close']);
        }
    };
    const context = {
        async newPage() {
            return page;
        }
    };

    const result = await ensureExtensionDeveloperRuntime(context, 'pdhkkaaejmcmmjclmhmldhghlfohpjii', {
        timeoutMs: 1000,
        intervalMs: 1
    });

    assert.equal(result.state, 'ENABLED');
    assert.deepEqual(calls[0], [
        'goto',
        'chrome://extensions/?id=pdhkkaaejmcmmjclmhmldhghlfohpjii'
    ]);
    assert.deepEqual(calls[1], [
        'updateProfileConfiguration',
        { inDeveloperMode: true }
    ]);
    assert.deepEqual(calls[2], ['reload', 'pdhkkaaejmcmmjclmhmldhghlfohpjii']);
    assert.deepEqual(calls.at(-1), ['close']);
});

runTest('ensureExtensionDeveloperRuntime reports disabled extension reasons', async () => {
    const page = {
        on() {},
        async goto() {},
        async waitForTimeout() {},
        async evaluate(fn, payload) {
            globalThis.chrome = {
                developerPrivate: {
                    async getProfileConfiguration() {
                        return {
                            canLoadUnpacked: true,
                            inDeveloperMode: true,
                            isDeveloperModeControlledByPolicy: false
                        };
                    },
                    async reload() {},
                    async getExtensionInfo(extensionId) {
                        return {
                            id: extensionId,
                            state: 'DISABLED',
                            disableReasons: {
                                unsupportedDeveloperExtension: true
                            },
                            manifestErrors: [],
                            runtimeErrors: [],
                            views: []
                        };
                    }
                }
            };
            try {
                return await fn(payload);
            } finally {
                delete globalThis.chrome;
            }
        },
        async close() {}
    };
    const context = {
        async newPage() {
            return page;
        }
    };

    await assert.rejects(
        ensureExtensionDeveloperRuntime(context, 'pdhkkaaejmcmmjclmhmldhghlfohpjii', {
            timeoutMs: 5,
            intervalMs: 1
        }),
        /unsupportedDeveloperExtension/
    );
});

runTest('closeBrowserQuietly disconnects from an attached browser without closing Chrome', async () => {
    let disconnected = false;
    let closed = false;

    await closeBrowserQuietly({
        disconnect() {
            disconnected = true;
        },
        async close() {
            closed = true;
        }
    });

    assert.equal(disconnected, true);
    assert.equal(closed, false);
});

runTest('closeBrowserQuietly closes the Playwright CDP connection without closing Chrome', async () => {
    let connectionClosed = false;
    let closed = false;

    await closeBrowserQuietly({
        _connection: {
            close() {
                connectionClosed = true;
            }
        },
        async close() {
            closed = true;
        }
    });

    assert.equal(connectionClosed, false);
    assert.equal(closed, true);
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

console.log(`Completed ${passed}/${tests.length} Playwright runtime checks.`);
