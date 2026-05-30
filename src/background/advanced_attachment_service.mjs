export const ADVANCED_TEMP_ROOT = 'AI-RoundTable-temp';

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30000;
const DEFAULT_CLEANUP_DELAY_MS = 30000;
const DEFAULT_NETWORK_SETTLE_MS = 1000;
const CDP_PROTOCOL_VERSION = '1.3';

export function sanitizeDownloadName(name) {
    const raw = String(name || '').trim();
    const basename = raw.split(/[\\/]+/).filter(Boolean).pop() || 'attachment.bin';
    const cleaned = basename
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/^\.+/, '')
        .trim();
    return cleaned || 'attachment.bin';
}

export function buildAdvancedDownloadFilename(taskId, name) {
    const safeTaskId = sanitizeDownloadPathSegment(taskId || 'task');
    return `${ADVANCED_TEMP_ROOT}/${safeTaskId}/${sanitizeDownloadName(name)}`;
}

export function buildAttachmentDataUrl(attachment = {}) {
    const mimeType = String(attachment?.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
    const base64 = String(attachment?.base64 || '').trim();
    return `data:${mimeType};base64,${base64}`;
}

export function createDeferredDownloadCleanup(chromeApi = chrome, options = {}) {
    const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : DEFAULT_CLEANUP_DELAY_MS;
    return async function cleanup(downloadIds = []) {
        const ids = [...new Set((Array.isArray(downloadIds) ? downloadIds : []).map(Number).filter(Number.isFinite))];
        if (ids.length === 0) return;
        if (delayMs > 0) {
            await delay(delayMs);
        }
        for (const id of ids) {
            await removeDownloadFile(chromeApi, id).catch((error) => {
                console.warn(`Advanced attachment cleanup removeFile failed for ${id}:`, error);
            });
            await eraseDownloadRecord(chromeApi, id).catch((error) => {
                console.warn(`Advanced attachment cleanup erase failed for ${id}:`, error);
            });
        }
    };
}

export async function stageAdvancedAttachments(chromeApi = chrome, attachments = [], options = {}) {
    const taskId = options.taskId || createAttachmentTaskId();
    const downloadIds = [];
    const filePaths = [];
    let downloadRoot = '';

    for (const attachment of attachments) {
        const filename = buildAdvancedDownloadFilename(taskId, attachment?.name);
        const id = await downloadAttachment(chromeApi, attachment, filename);
        downloadIds.push(id);
        const item = await waitForDownloadComplete(chromeApi, id, {
            timeoutMs: options.timeoutMs || DEFAULT_DOWNLOAD_TIMEOUT_MS
        });
        if (!item?.filename) {
            throw new Error(`Download did not expose a local filename for ${attachment?.name || 'attachment'}`);
        }
        filePaths.push(item.filename);
        if (!downloadRoot) {
            downloadRoot = inferDownloadRootFromStagedFile(item.filename);
        }
    }

    return { taskId, downloadIds, filePaths, downloadRoot };
}

export async function setFileInputFilesWithCdp(tabId, selector, filePaths, optionsOrChromeApi = {}, maybeChromeApi) {
    const inputSelector = String(selector || 'input[type="file"]').trim() || 'input[type="file"]';
    const files = (Array.isArray(filePaths) ? filePaths : []).map(String).filter(Boolean);
    const hasChromeShape = Boolean(optionsOrChromeApi?.debugger || optionsOrChromeApi?.downloads || optionsOrChromeApi?.runtime);
    const options = hasChromeShape ? {} : (optionsOrChromeApi || {});
    const chromeApi = hasChromeShape ? optionsOrChromeApi : (maybeChromeApi || chrome);
    if (!Number.isInteger(tabId) || tabId < 0) {
        throw new Error('A valid tabId is required for CDP attachment upload');
    }
    if (files.length === 0) {
        throw new Error('At least one local file path is required for CDP attachment upload');
    }
    validateAdvancedAttachmentFilePaths(files, options);

    return withDebuggerSession(tabId, chromeApi, async () => {
        const networkDiagnostics = createCdpNetworkDiagnostics(chromeApi, tabId, {
            maxEvents: options.networkMaxEvents
        });
        let networkStopped = false;
        const stopNetworkDiagnostics = async () => {
            if (networkStopped) return networkDiagnostics.snapshot();
            networkStopped = true;
            await networkDiagnostics.stop();
            return networkDiagnostics.snapshot();
        };

        await networkDiagnostics.start();
        try {
            const { root } = await sendDebuggerCommand(chromeApi, tabId, 'DOM.getDocument', {
                depth: -1,
                pierce: true
            });
            const query = await sendDebuggerCommand(chromeApi, tabId, 'DOM.querySelector', {
                nodeId: root.nodeId,
                selector: inputSelector
            });
            const nodeId = Number(query?.nodeId || 0);
            if (!nodeId) {
                throw new Error(`CDP file input not found for selector: ${inputSelector}`);
            }
            await sendDebuggerCommand(chromeApi, tabId, 'DOM.setFileInputFiles', {
                nodeId,
                files
            });
            const { object } = await sendDebuggerCommand(chromeApi, tabId, 'DOM.resolveNode', {
                nodeId
            });
            if (object?.objectId) {
                await sendDebuggerCommand(chromeApi, tabId, 'Runtime.callFunctionOn', {
                    objectId: object.objectId,
                    functionDeclaration: `function() {
                        this.dispatchEvent(new Event('input', { bubbles: true }));
                        this.dispatchEvent(new Event('change', { bubbles: true }));
                    }`,
                    awaitPromise: true
                });
            }
            await delay(getNetworkSettleMs(options));
            const network = await stopNetworkDiagnostics();
            return { nodeId, fileCount: files.length, networkDiagnostics: network };
        } catch (error) {
            error.networkDiagnostics = await stopNetworkDiagnostics();
            throw error;
        } finally {
            await stopNetworkDiagnostics();
        }
    });
}

export function inferDownloadRootFromStagedFile(filename, tempRootName = ADVANCED_TEMP_ROOT) {
    const normalized = String(filename || '').replace(/\\/g, '/');
    const tempRoot = sanitizeDownloadPathSegment(tempRootName);
    const marker = `/${tempRoot}/`;
    const index = normalized.indexOf(marker);
    if (index < 0) return '';
    return normalized.slice(0, index).replace(/\//g, '\\');
}

export async function setFileInputFilesViaCdpFileChooser(tabId, filePaths, options = {}, chromeApi = chrome) {
    const files = (Array.isArray(filePaths) ? filePaths : []).map(String).filter(Boolean);
    const triggerExpression = String(options?.triggerExpression || '').trim();
    const timeoutMs = Number.isFinite(options?.timeoutMs) ? Math.max(1000, options.timeoutMs) : 10000;

    if (!Number.isInteger(tabId) || tabId < 0) {
        throw new Error('A valid tabId is required for CDP file chooser attachment upload');
    }
    if (files.length === 0) {
        throw new Error('At least one local file path is required for CDP file chooser attachment upload');
    }
    if (!triggerExpression) {
        throw new Error('A file chooser trigger expression is required for CDP attachment upload');
    }
    validateAdvancedAttachmentFilePaths(files, options);

    return withDebuggerSession(tabId, chromeApi, async () => {
        let removeFileChooserListener = () => {};
        const networkDiagnostics = createCdpNetworkDiagnostics(chromeApi, tabId, {
            maxEvents: options.networkMaxEvents
        });
        let networkStopped = false;
        const stopNetworkDiagnostics = async () => {
            if (networkStopped) return networkDiagnostics.snapshot();
            networkStopped = true;
            await networkDiagnostics.stop();
            return networkDiagnostics.snapshot();
        };
        try {
            await sendDebuggerCommand(chromeApi, tabId, 'Page.enable');
            await sendDebuggerCommand(chromeApi, tabId, 'DOM.enable');
            await networkDiagnostics.start();

            const chooserPromise = waitForFileChooserOpened(chromeApi, tabId, { timeoutMs });
            removeFileChooserListener = chooserPromise.removeListener || removeFileChooserListener;

            await sendDebuggerCommand(chromeApi, tabId, 'Page.setInterceptFileChooserDialog', {
                enabled: true
            });
            const triggerResult = await sendDebuggerCommand(chromeApi, tabId, 'Runtime.evaluate', {
                expression: triggerExpression,
                awaitPromise: true,
                returnByValue: true,
                userGesture: true
            });
            if (triggerResult?.exceptionDetails) {
                chooserPromise.catch(() => {});
                throw new Error(formatRuntimeEvaluationError(triggerResult.exceptionDetails));
            }

            const chooser = await chooserPromise.catch((error) => {
                const triggerSummary = safeJsonForError(triggerResult?.result?.value || triggerResult);
                throw new Error(`${error?.message || 'Timed out waiting for CDP file chooser to open'}; trigger=${triggerSummary}`);
            });
            const backendNodeId = Number(chooser?.backendNodeId || 0);
            if (!backendNodeId) {
                throw new Error('CDP file chooser did not expose a backend node id');
            }

            await sendDebuggerCommand(chromeApi, tabId, 'DOM.setFileInputFiles', {
                backendNodeId,
                files
            });
            await dispatchFileInputEventsForBackendNode(chromeApi, tabId, backendNodeId);
            await delay(getNetworkSettleMs(options));
            const network = await stopNetworkDiagnostics();
            return {
                backendNodeId,
                fileCount: files.length,
                mode: chooser?.mode || '',
                trigger: triggerResult?.result?.value || null,
                networkDiagnostics: network
            };
        } catch (error) {
            error.networkDiagnostics = await stopNetworkDiagnostics();
            throw error;
        } finally {
            removeFileChooserListener();
            await stopNetworkDiagnostics();
            await sendDebuggerCommand(chromeApi, tabId, 'Page.setInterceptFileChooserDialog', {
                enabled: false
            }).catch((error) => {
                console.warn(`Advanced attachment file chooser intercept cleanup failed for tab ${tabId}:`, error);
            });
        }
    });
}

export function createCdpNetworkDiagnostics(chromeApi = chrome, tabId, options = {}) {
    const maxEvents = Number.isFinite(options.maxEvents) ? Math.max(1, options.maxEvents) : 80;
    const targetTabId = Number(tabId);
    const events = [];
    let listener = null;
    let status = 'not_started';
    let reason = '';

    const append = (event) => {
        if (events.length >= maxEvents) return;
        events.push(event);
    };

    const handleEvent = (source, method, params = {}) => {
        if (Number(source?.tabId) !== targetTabId) return;
        if (method === 'Network.requestWillBeSent') {
            const urlParts = sanitizeNetworkUrl(params?.request?.url);
            append({
                event: 'requestWillBeSent',
                requestId: String(params?.requestId || ''),
                method: String(params?.request?.method || ''),
                host: urlParts.host,
                path: urlParts.path,
                resourceType: String(params?.type || ''),
                timestamp: normalizeTimestamp(params?.timestamp)
            });
            return;
        }
        if (method === 'Network.responseReceived') {
            const urlParts = sanitizeNetworkUrl(params?.response?.url);
            append({
                event: 'responseReceived',
                requestId: String(params?.requestId || ''),
                host: urlParts.host,
                path: urlParts.path,
                resourceType: String(params?.type || ''),
                status: Number(params?.response?.status || 0),
                mimeType: String(params?.response?.mimeType || ''),
                timestamp: normalizeTimestamp(params?.timestamp)
            });
            return;
        }
        if (method === 'Network.loadingFinished') {
            append({
                event: 'loadingFinished',
                requestId: String(params?.requestId || ''),
                timestamp: normalizeTimestamp(params?.timestamp)
            });
            return;
        }
        if (method === 'Network.loadingFailed') {
            append({
                event: 'loadingFailed',
                requestId: String(params?.requestId || ''),
                failedReason: String(params?.errorText || ''),
                timestamp: normalizeTimestamp(params?.timestamp)
            });
        }
    };

    return {
        async start() {
            if (!Number.isInteger(targetTabId) || targetTabId < 0) {
                status = 'unavailable';
                reason = 'A valid tabId is required for CDP network diagnostics';
                return;
            }
            const onEvent = chromeApi?.debugger?.onEvent;
            if (!onEvent || typeof onEvent.addListener !== 'function') {
                status = 'unavailable';
                reason = 'Chrome debugger network events are unavailable';
                return;
            }
            listener = handleEvent;
            onEvent.addListener(listener);
            try {
                await sendDebuggerCommand(chromeApi, targetTabId, 'Network.enable');
                status = 'ok';
                reason = '';
            } catch (error) {
                status = 'unavailable';
                reason = error?.message || 'Network.enable failed';
            }
        },
        async stop() {
            if (listener) {
                const removeListener = chromeApi?.debugger?.onEvent?.removeListener;
                if (typeof removeListener === 'function') {
                    removeListener.call(chromeApi.debugger.onEvent, listener);
                }
                listener = null;
            }
            if (status === 'ok') {
                await sendDebuggerCommand(chromeApi, targetTabId, 'Network.disable').catch((error) => {
                    status = 'stopped_with_error';
                    reason = error?.message || 'Network.disable failed';
                });
            }
            if (status === 'not_started') status = 'stopped';
        },
        snapshot() {
            return {
                status,
                eventCount: events.length,
                events: events.map((event) => ({ ...event })),
                ...(reason ? { reason } : {})
            };
        }
    };
}

function getNetworkSettleMs(options = {}) {
    if (!Number.isFinite(options.networkSettleMs)) return DEFAULT_NETWORK_SETTLE_MS;
    return Math.max(0, options.networkSettleMs);
}

function sanitizeNetworkUrl(value) {
    try {
        const parsed = new URL(String(value || ''));
        return {
            host: parsed.host,
            path: parsed.pathname || '/'
        };
    } catch {
        return { host: '', path: '' };
    }
}

function normalizeTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatRuntimeEvaluationError(exceptionDetails = {}) {
    return String(
        exceptionDetails?.exception?.description
        || exceptionDetails?.exception?.value
        || exceptionDetails?.text
        || 'CDP file chooser trigger expression failed'
    );
}

function safeJsonForError(value) {
    try {
        return JSON.stringify(value).slice(0, 800);
    } catch {
        return String(value || '').slice(0, 800);
    }
}

export function validateAdvancedAttachmentFilePaths(filePaths = [], options = {}) {
    const tempRootName = sanitizeDownloadPathSegment(options.tempRootName || ADVANCED_TEMP_ROOT);
    const downloadRoot = String(options.downloadRoot || '').trim();
    const normalizedFiles = (Array.isArray(filePaths) ? filePaths : []).map(String).filter(Boolean);
    const allowedFilePaths = (Array.isArray(options.allowedFilePaths) ? options.allowedFilePaths : [])
        .map((item) => normalizeLocalPathForCompare(item))
        .filter(Boolean);

    for (const filePath of normalizedFiles) {
        if (allowedFilePaths.length > 0) {
            if (!allowedFilePaths.includes(normalizeLocalPathForCompare(filePath))) {
                throw new Error(`Attachment file path is not in the current Advanced attachment staging set: ${filePath}`);
            }
            continue;
        }

        const normalized = filePath.replace(/\\/g, '/');
        const needle = `/${tempRootName}/`;
        const hasTempRoot = normalized.includes(needle)
            || normalized.endsWith(`/${tempRootName}`)
            || normalized.startsWith(`${tempRootName}/`);
        if (!hasTempRoot) {
            throw new Error(`Attachment file path is outside the Advanced attachment temp root: ${filePath}`);
        }
        if (downloadRoot) {
            const root = downloadRoot.replace(/\\/g, '/').replace(/\/+$/, '');
            if (!normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
                throw new Error(`Attachment file path is outside the expected download root: ${filePath}`);
            }
        }
    }

    return true;
}

function normalizeLocalPathForCompare(value) {
    return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export async function withDebuggerSession(tabId, chromeApi = chrome, fn) {
    const target = { tabId };
    await callChrome(chromeApi.debugger.attach, chromeApi.debugger, target, CDP_PROTOCOL_VERSION);
    try {
        return await fn();
    } finally {
        await callChrome(chromeApi.debugger.detach, chromeApi.debugger, target).catch((error) => {
            console.warn(`Advanced attachment debugger detach failed for tab ${tabId}:`, error);
        });
    }
}

function waitForFileChooserOpened(chromeApi, tabId, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000;
    let timer = null;
    let settled = false;
    let listener = null;

    const promise = new Promise((resolve, reject) => {
        listener = (source, method, params) => {
            if (settled) return;
            if (method !== 'Page.fileChooserOpened') return;
            if (Number(source?.tabId) !== Number(tabId)) return;
            settled = true;
            clearTimeout(timer);
            resolve(params || {});
        };

        const onEvent = chromeApi?.debugger?.onEvent;
        if (!onEvent || typeof onEvent.addListener !== 'function') {
            reject(new Error('Chrome debugger file chooser events are unavailable'));
            return;
        }

        onEvent.addListener(listener);
        timer = setTimeout(() => {
            settled = true;
            reject(new Error('Timed out waiting for CDP file chooser to open'));
        }, timeoutMs);
    });

    promise.removeListener = () => {
        if (!listener) return;
        const removeListener = chromeApi?.debugger?.onEvent?.removeListener;
        if (typeof removeListener === 'function') {
            removeListener.call(chromeApi.debugger.onEvent, listener);
        }
        listener = null;
    };
    return promise;
}

async function dispatchFileInputEventsForBackendNode(chromeApi, tabId, backendNodeId) {
    const { object } = await sendDebuggerCommand(chromeApi, tabId, 'DOM.resolveNode', {
        backendNodeId
    });
    if (!object?.objectId) return;
    await sendDebuggerCommand(chromeApi, tabId, 'Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function() {
            this.dispatchEvent(new Event('input', { bubbles: true }));
            this.dispatchEvent(new Event('change', { bubbles: true }));
        }`,
        awaitPromise: true
    });
}

function sanitizeDownloadPathSegment(value) {
    const cleaned = String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/^_+|_+$/g, '');
    return cleaned || 'task';
}

function createAttachmentTaskId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function downloadAttachment(chromeApi, attachment, filename) {
    return callChrome(chromeApi.downloads.download, chromeApi.downloads, {
        url: buildAttachmentDataUrl(attachment),
        filename,
        saveAs: false,
        conflictAction: 'uniquify'
    });
}

async function waitForDownloadComplete(chromeApi, id, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_DOWNLOAD_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const items = await callChrome(chromeApi.downloads.search, chromeApi.downloads, { id });
        const item = Array.isArray(items) ? items[0] : null;
        if (item?.state === 'complete') return item;
        if (item?.state === 'interrupted') {
            throw new Error(`Download interrupted for attachment id ${id}`);
        }
        await delay(150);
    }

    throw new Error(`Timed out waiting for attachment download id ${id}`);
}

async function removeDownloadFile(chromeApi, id) {
    return callChrome(chromeApi.downloads.removeFile, chromeApi.downloads, id);
}

async function eraseDownloadRecord(chromeApi, id) {
    return callChrome(chromeApi.downloads.erase, chromeApi.downloads, { id });
}

async function sendDebuggerCommand(chromeApi, tabId, method, params = {}) {
    return callChrome(chromeApi.debugger.sendCommand, chromeApi.debugger, { tabId }, method, params);
}

function callChrome(fn, thisArg, ...args) {
    if (typeof fn !== 'function') {
        return Promise.reject(new Error('Required Chrome API is unavailable'));
    }
    return new Promise((resolve, reject) => {
        fn.call(thisArg, ...args, (result) => {
            const error = chromeRuntimeLastError(thisArg);
            if (error) {
                reject(new Error(error.message || String(error)));
                return;
            }
            resolve(result);
        });
    });
}

function chromeRuntimeLastError(thisArg) {
    return thisArg?.runtime?.lastError || globalThis.chrome?.runtime?.lastError || null;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
