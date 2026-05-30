import assert from 'node:assert/strict';

import {
    ADVANCED_TEMP_ROOT,
    buildAdvancedDownloadFilename,
    buildAttachmentDataUrl,
    createDeferredDownloadCleanup,
    createCdpNetworkDiagnostics,
    inferDownloadRootFromStagedFile,
    setFileInputFilesWithCdp,
    setFileInputFilesViaCdpFileChooser,
    validateAdvancedAttachmentFilePaths,
    sanitizeDownloadName
} from '../src/background/advanced_attachment_service.mjs';

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('builds safe relative filenames under the advanced temp root', () => {
    assert.equal(sanitizeDownloadName('..\\brief:final?.pdf'), 'brief_final_.pdf');
    assert.equal(
        buildAdvancedDownloadFilename('task/../42', '..\\brief:final?.pdf'),
        `${ADVANCED_TEMP_ROOT}/task_.._42/brief_final_.pdf`
    );
});

runTest('builds data URLs from normalized attachment payloads', () => {
    const url = buildAttachmentDataUrl({
        name: 'tiny.txt',
        mimeType: 'text/plain',
        base64: 'SGVsbG8='
    });

    assert.equal(url, 'data:text/plain;base64,SGVsbG8=');
});

runTest('infers the browser download root from staged advanced attachment files', () => {
    assert.equal(
        inferDownloadRootFromStagedFile(`C:\\Users\\xiepro\\Downloads\\${ADVANCED_TEMP_ROOT}\\task\\a.png`),
        'C:\\Users\\xiepro\\Downloads'
    );
});

runTest('deferred cleanup removes files then erases download records', async () => {
    const calls = [];
    const chromeApi = {
        downloads: {
            removeFile(id, callback) {
                calls.push(['removeFile', id]);
                callback?.();
            },
            erase(query, callback) {
                calls.push(['erase', query.id]);
                callback?.([]);
            }
        },
        runtime: {}
    };

    const cleanup = createDeferredDownloadCleanup(chromeApi, { delayMs: 0 });
    await cleanup([11, 12]);

    assert.deepEqual(calls, [
        ['removeFile', 11],
        ['erase', 11],
        ['removeFile', 12],
        ['erase', 12]
    ]);
});

runTest('cdp file injection dispatches input and change after setting files', async () => {
    const calls = [];
    const chromeApi = {
        debugger: {
            attach(_target, _version, callback) {
                calls.push(['attach']);
                callback?.();
            },
            detach(_target, callback) {
                calls.push(['detach']);
                callback?.();
            },
            sendCommand(_target, method, params, callback) {
                calls.push([method, params]);
                if (method === 'DOM.getDocument') {
                    callback?.({ root: { nodeId: 1 } });
                    return;
                }
                if (method === 'DOM.querySelector') {
                    callback?.({ nodeId: 7 });
                    return;
                }
                if (method === 'DOM.resolveNode') {
                    callback?.({ object: { objectId: 'input-object' } });
                    return;
                }
                callback?.({});
            }
        },
        runtime: {}
    };

    const result = await setFileInputFilesWithCdp(
        42,
        'input[type="file"]',
        [`C:\\Users\\xiepro\\Downloads\\${ADVANCED_TEMP_ROOT}\\task\\a.png`],
        chromeApi
    );

    assert.equal(result.nodeId, 7);
    assert.equal(result.fileCount, 1);
    assert.equal(result.networkDiagnostics.status, 'unavailable');
    assert.equal(calls.some(([method]) => method === 'DOM.setFileInputFiles'), true);
    const runtimeCall = calls.find(([method]) => method === 'Runtime.callFunctionOn');
    assert.ok(runtimeCall, 'Runtime.callFunctionOn should dispatch DOM events');
    assert.match(runtimeCall[1].functionDeclaration, /input/);
    assert.match(runtimeCall[1].functionDeclaration, /change/);
});

runTest('cdp file chooser injection sets files through the opened input backend node', async () => {
    const calls = [];
    const listeners = new Set();
    const chromeApi = {
        debugger: {
            onEvent: {
                addListener(listener) {
                    listeners.add(listener);
                    calls.push(['onEvent.addListener']);
                },
                removeListener(listener) {
                    listeners.delete(listener);
                    calls.push(['onEvent.removeListener']);
                }
            },
            attach(_target, _version, callback) {
                calls.push(['attach']);
                callback?.();
            },
            detach(_target, callback) {
                calls.push(['detach']);
                callback?.();
            },
            sendCommand(target, method, params, callback) {
                calls.push([method, params]);
                if (method === 'Runtime.evaluate') {
                    setTimeout(() => {
                        for (const listener of listeners) {
                            listener(target, 'Page.fileChooserOpened', {
                                mode: 'selectSingle',
                                backendNodeId: 31
                            });
                        }
                    }, 0);
                    callback?.({ result: { value: { clicked: true } } });
                    return;
                }
                if (method === 'DOM.resolveNode') {
                    callback?.({ object: { objectId: 'chooser-input' } });
                    return;
                }
                callback?.({});
            }
        },
        runtime: {}
    };

    const result = await setFileInputFilesViaCdpFileChooser(
        42,
        [`C:\\Users\\xiepro\\Downloads\\${ADVANCED_TEMP_ROOT}\\task\\a.png`],
        {
            triggerExpression: 'window.__clickUpload()',
            downloadRoot: 'C:\\Users\\xiepro\\Downloads'
        },
        chromeApi
    );

    assert.equal(result.backendNodeId, 31);
    assert.equal(result.fileCount, 1);
    assert.deepEqual(result.trigger, { clicked: true });
    assert.equal(calls.some(([method]) => method === 'Page.setInterceptFileChooserDialog'), true);
    const runtimeEval = calls.find(([method]) => method === 'Runtime.evaluate');
    assert.equal(runtimeEval[1].userGesture, true);
    assert.equal(runtimeEval[1].expression, 'window.__clickUpload()');
    const setFiles = calls.find(([method]) => method === 'DOM.setFileInputFiles');
    assert.deepEqual(setFiles[1], {
        backendNodeId: 31,
        files: [`C:\\Users\\xiepro\\Downloads\\${ADVANCED_TEMP_ROOT}\\task\\a.png`]
    });
    assert.equal(calls.some(([method]) => method === 'Runtime.callFunctionOn'), true);
    assert.equal(calls.some(([method]) => method === 'onEvent.removeListener'), true);
});

runTest('cdp network diagnostics records only sanitized request metadata', async () => {
    const listeners = new Set();
    const calls = [];
    const chromeApi = {
        debugger: {
            onEvent: {
                addListener(listener) {
                    listeners.add(listener);
                },
                removeListener(listener) {
                    listeners.delete(listener);
                }
            },
            sendCommand(_target, method, _params, callback) {
                calls.push(method);
                callback?.({});
            }
        },
        runtime: {}
    };

    const diagnostics = createCdpNetworkDiagnostics(chromeApi, 42, { maxEvents: 10 });
    await diagnostics.start();
    for (const listener of listeners) {
        listener({ tabId: 42 }, 'Network.requestWillBeSent', {
            requestId: 'upload-1',
            type: 'Fetch',
            timestamp: 101,
            request: {
                method: 'POST',
                url: 'https://gemini.google.com/_/upload?token=secret',
                headers: { cookie: 'SID=secret' },
                postData: 'file-body'
            }
        });
        listener({ tabId: 42 }, 'Network.responseReceived', {
            requestId: 'upload-1',
            type: 'Fetch',
            timestamp: 102,
            response: {
                url: 'https://gemini.google.com/_/upload?token=secret',
                status: 200,
                mimeType: 'application/json',
                headers: { 'set-cookie': 'SID=secret' }
            }
        });
        listener({ tabId: 41 }, 'Network.loadingFailed', {
            requestId: 'other-tab',
            timestamp: 103,
            errorText: 'ignored'
        });
    }
    await diagnostics.stop();

    const snapshot = diagnostics.snapshot();
    assert.equal(calls.includes('Network.enable'), true);
    assert.equal(calls.includes('Network.disable'), true);
    assert.equal(snapshot.events.length, 2);
    assert.deepEqual(snapshot.events[0], {
        event: 'requestWillBeSent',
        requestId: 'upload-1',
        method: 'POST',
        host: 'gemini.google.com',
        path: '/_/upload',
        resourceType: 'Fetch',
        timestamp: 101
    });
    assert.equal(snapshot.events[1].status, 200);
    assert.equal(snapshot.events[1].mimeType, 'application/json');

    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes('secret'), false);
    assert.equal(serialized.includes('cookie'), false);
    assert.equal(serialized.includes('file-body'), false);
});

runTest('cdp injection rejects staged paths outside the advanced temp root', async () => {
    assert.throws(
        () => validateAdvancedAttachmentFilePaths([
            'C:\\Users\\xiepro\\Downloads\\private.png'
        ], {
            downloadRoot: 'C:\\Users\\xiepro\\Downloads',
            tempRootName: ADVANCED_TEMP_ROOT
        }),
        /outside the Advanced attachment temp root/
    );
});

runTest('cdp injection accepts exact file paths from the current staging allowlist', () => {
    const stagedPath = 'C:\\Users\\xiepro\\AppData\\Local\\Temp\\playwright-artifacts-FNMSpp\\3d37c698-c26b-4e6d-a6bb-982709b54af6';

    assert.equal(
        validateAdvancedAttachmentFilePaths([stagedPath], {
            allowedFilePaths: [stagedPath]
        }),
        true
    );
});

runTest('cdp file chooser injection validates local file path boundaries before attaching debugger', async () => {
    const calls = [];
    const chromeApi = {
        debugger: {
            onEvent: {
                addListener() {},
                removeListener() {}
            },
            attach(_target, _version, callback) {
                calls.push(['attach']);
                callback?.();
            },
            detach(_target, callback) {
                calls.push(['detach']);
                callback?.();
            },
            sendCommand(_target, method, params, callback) {
                calls.push([method, params]);
                callback?.({});
            }
        },
        runtime: {}
    };

    await assert.rejects(
        () => setFileInputFilesViaCdpFileChooser(
            42,
            ['C:\\Users\\xiepro\\Downloads\\private.png'],
            {
                triggerExpression: 'window.__clickUpload()',
                downloadRoot: 'C:\\Users\\xiepro\\Downloads',
                tempRootName: ADVANCED_TEMP_ROOT
            },
            chromeApi
        ),
        /outside the Advanced attachment temp root/
    );
    assert.equal(calls.some(([method]) => method === 'attach'), false);
});

runTest('cdp file chooser injection accepts exact current-stage paths outside the temp root', async () => {
    const stagedPath = 'C:\\Users\\xiepro\\AppData\\Local\\Temp\\playwright-artifacts-FNMSpp\\3d37c698-c26b-4e6d-a6bb-982709b54af6';
    const calls = [];
    const listeners = new Set();
    const chromeApi = {
        debugger: {
            onEvent: {
                addListener(listener) {
                    listeners.add(listener);
                },
                removeListener(listener) {
                    listeners.delete(listener);
                }
            },
            attach(_target, _version, callback) {
                calls.push(['attach']);
                callback?.();
            },
            detach(_target, callback) {
                calls.push(['detach']);
                callback?.();
            },
            sendCommand(target, method, params, callback) {
                calls.push([method, params]);
                if (method === 'Runtime.evaluate') {
                    setTimeout(() => {
                        for (const listener of listeners) {
                            listener(target, 'Page.fileChooserOpened', {
                                mode: 'selectSingle',
                                backendNodeId: 41
                            });
                        }
                    }, 0);
                    callback?.({ result: { value: { clicked: true } } });
                    return;
                }
                if (method === 'DOM.resolveNode') {
                    callback?.({ object: { objectId: 'chooser-input' } });
                    return;
                }
                callback?.({});
            }
        },
        runtime: {}
    };

    const result = await setFileInputFilesViaCdpFileChooser(
        42,
        [stagedPath],
        {
            triggerExpression: 'window.__clickUpload()',
            allowedFilePaths: [stagedPath]
        },
        chromeApi
    );

    assert.equal(result.backendNodeId, 41);
    assert.equal(calls.some(([method]) => method === 'attach'), true);
});

runTest('cdp file chooser injection surfaces trigger expression errors before waiting for timeout', async () => {
    const chromeApi = {
        debugger: {
            onEvent: {
                addListener() {},
                removeListener() {}
            },
            attach(_target, _version, callback) {
                callback?.();
            },
            detach(_target, callback) {
                callback?.();
            },
            sendCommand(_target, method, _params, callback) {
                if (method === 'Runtime.evaluate') {
                    callback?.({
                        exceptionDetails: {
                            text: 'Uncaught',
                            exception: {
                                description: 'Gemini local file uploader button was not found'
                            }
                        }
                    });
                    return;
                }
                callback?.({});
            }
        },
        runtime: {}
    };

    await assert.rejects(
        () => setFileInputFilesViaCdpFileChooser(
            42,
            [`C:\\Users\\xiepro\\Downloads\\${ADVANCED_TEMP_ROOT}\\task\\a.png`],
            {
                triggerExpression: 'window.__missingUploadButton()',
                downloadRoot: 'C:\\Users\\xiepro\\Downloads',
                timeoutMs: 1
            },
            chromeApi
        ),
        /Gemini local file uploader button was not found/
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

console.log(`Completed ${passed}/${tests.length} advanced attachment service checks.`);
