export const ADVANCED_TEMP_ROOT = 'AI-RoundTable-temp';

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30000;
const DEFAULT_CLEANUP_DELAY_MS = 30000;
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
    }

    return { taskId, downloadIds, filePaths };
}

export async function setFileInputFilesWithCdp(tabId, selector, filePaths, chromeApi = chrome) {
    const inputSelector = String(selector || 'input[type="file"]').trim() || 'input[type="file"]';
    const files = (Array.isArray(filePaths) ? filePaths : []).map(String).filter(Boolean);
    if (!Number.isInteger(tabId) || tabId < 0) {
        throw new Error('A valid tabId is required for CDP attachment upload');
    }
    if (files.length === 0) {
        throw new Error('At least one local file path is required for CDP attachment upload');
    }

    return withDebuggerSession(tabId, chromeApi, async () => {
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
        return { nodeId, fileCount: files.length };
    });
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
