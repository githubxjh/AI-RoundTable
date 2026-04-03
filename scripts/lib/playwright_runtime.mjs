import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
    buildExtensionLaunchArgs,
    ensureDir,
    getExtensionPageUrl,
    normalizeProfileRelativePath
} from './playwright_env.mjs';
import {
    buildMissingExtensionMessage,
    findRepoExtensionIdInProfile,
    waitForCdpEndpoint
} from './chrome_attach.mjs';

export {
    normalizeLiveModels
} from './live_workflow.mjs';

export async function importPlaywright() {
    try {
        return await import('playwright');
    } catch {
        throw new Error('Playwright is not installed. Run `npm install --save-dev playwright` first.');
    }
}

export function parseHeadlessFlag(argv = [], defaultHeadless = false) {
    if (argv.includes('--headless')) return true;
    if (argv.includes('--headed')) return false;
    return defaultHeadless;
}

export function createFileLogger(logPath) {
    ensureDir(path.dirname(logPath));
    fs.writeFileSync(logPath, '', 'utf8');

    const write = (level, message) => {
        const line = `[${new Date().toISOString()}] [${level}] ${message}`;
        fs.appendFileSync(logPath, `${line}\n`, 'utf8');

        if (level === 'ERROR') {
            console.error(line);
            return;
        }
        if (level === 'WARN') {
            console.warn(line);
            return;
        }
        console.log(line);
    };

    return {
        path: logPath,
        log(message) {
            write('INFO', message);
        },
        warn(message) {
            write('WARN', message);
        },
        error(message) {
            write('ERROR', message);
        }
    };
}

export async function launchExtensionContext({
    playwright,
    extensionPath,
    browserChannel = 'chromium',
    chromeExecutable,
    userDataDir,
    artifactDir,
    headless = false
} = {}) {
    ensureDir(userDataDir);
    ensureDir(artifactDir);

    const { chromium } = playwright;
    const launchOptions = {
        headless,
        args: [
            ...buildExtensionLaunchArgs(extensionPath),
            '--no-first-run',
            '--no-default-browser-check'
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
        viewport: {
            width: 1440,
            height: 1200
        }
    };

    if (browserChannel) {
        launchOptions.channel = browserChannel;
    } else if (chromeExecutable) {
        launchOptions.executablePath = chromeExecutable;
    }

    const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    const serviceWorker = context.serviceWorkers()[0]
        || await context.waitForEvent('serviceworker', { timeout: 20000 });
    const extensionId = new URL(serviceWorker.url()).host;

    return {
        browser: null,
        context,
        extensionId,
        serviceWorker
    };
}

export async function connectToChromeOverCdp({
    playwright,
    endpoint,
    artifactDir,
    timeoutMs = 30000
} = {}) {
    ensureDir(artifactDir);
    await waitForCdpEndpoint(endpoint, { timeoutMs });

    const browser = await playwright.chromium.connectOverCDP(endpoint, {
        timeout: timeoutMs
    });
    const [context] = browser.contexts();

    if (!context) {
        throw new Error(`Connected to ${endpoint}, but no default browser context was exposed.`);
    }

    return {
        browser,
        context
    };
}

export async function resolveAttachedExtensionId({
    context,
    repoRoot,
    profileName,
    preferencesPath,
    securePreferencesPath
} = {}) {
    const byWorker = context.serviceWorkers().find((worker) => {
        const url = String(worker.url() || '');
        return url.endsWith('/src/background/service_worker.js');
    });
    if (byWorker) {
        return new URL(byWorker.url()).host;
    }

    const fromProfile = findRepoExtensionIdInProfile({
        preferencesPath,
        securePreferencesPath,
        repoRoot
    });
    if (fromProfile?.extensionId) {
        return fromProfile.extensionId;
    }

    throw new Error(buildMissingExtensionMessage({
        profileName,
        repoRoot
    }));
}

export function attachPageDiagnostics(page, {
    label = 'page',
    logger = null
} = {}) {
    const log = logger?.log?.bind(logger) || console.log;
    const warn = logger?.warn?.bind(logger) || console.warn;
    const error = logger?.error?.bind(logger) || console.error;

    page.on('console', (message) => {
        log(`[${label}] console.${message.type()} ${message.text()}`);
    });
    page.on('pageerror', (pageError) => {
        error(`[${label}] pageerror ${pageError?.stack || pageError?.message || String(pageError)}`);
    });
    page.on('dialog', (dialog) => {
        warn(`[${label}] dialog.${dialog.type()} ${dialog.message()}`);
    });
    page.on('requestfailed', (request) => {
        warn(
            `[${label}] requestfailed ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim()
        );
    });
}

export function attachContextDiagnostics(context, {
    logger = null
} = {}) {
    const log = logger?.log?.bind(logger) || console.log;

    context.pages().forEach((page) => {
        log(`[context] page-existing ${page.url() || 'about:blank'}`);
    });
    context.serviceWorkers().forEach((worker) => {
        log(`[context] serviceworker-existing ${worker.url()}`);
    });

    context.on('page', (page) => {
        log(`[context] page-created ${page.url() || 'about:blank'}`);
    });
    context.on('serviceworker', (worker) => {
        log(`[context] serviceworker ${worker.url()}`);
    });
}

export async function openExtensionPanel(context, extensionId, {
    logger = null
} = {}) {
    const page = await context.newPage();
    attachPageDiagnostics(page, {
        label: 'panel',
        logger
    });
    await page.goto(getExtensionPageUrl(extensionId), { waitUntil: 'domcontentloaded' });
    return page;
}

export async function waitForPanelReady(page, {
    timeoutMs = 20000
} = {}) {
    await page.waitForFunction(() => {
        const status = document.body?.dataset?.panelReady || globalThis.__AI_RT_PANEL_STATUS__;
        return status === 'true' || status === 'error';
    }, null, { timeout: timeoutMs });

    const readyState = await page.evaluate(() => ({
        status: document.body?.dataset?.panelReady || globalThis.__AI_RT_PANEL_STATUS__ || 'unknown',
        error: globalThis.__AI_RT_PANEL_ERROR__ || ''
    }));

    if (readyState.status !== 'true') {
        throw new Error(
            `Panel initialization failed: ${readyState.error || 'Unknown panel error'}`
        );
    }
}

export async function seedExtensionStorage(page, bundle) {
    await page.evaluate(async (data) => {
        await chrome.storage.local.clear();
        await chrome.storage.local.set(data);
    }, bundle);
}

export async function readExtensionStorage(page, keyOrKeys) {
    return page.evaluate(async (keys) => chrome.storage.local.get(keys), keyOrKeys);
}

export async function clearExtensionStorage(page) {
    await page.evaluate(async () => {
        await chrome.storage.local.clear();
    });
}

export async function captureArtifact(page, artifactPath) {
    ensureDir(path.dirname(artifactPath));
    await page.screenshot({
        path: artifactPath,
        fullPage: true
    });
}

export async function capturePageHtml(page, artifactPath) {
    ensureDir(path.dirname(artifactPath));
    const html = await page.content();
    fs.writeFileSync(artifactPath, html, 'utf8');
}

export async function captureLivePageSnapshot(page) {
    return page.evaluate(() => ({
        url: location.href,
        title: document.title || '',
        bodyText: (document.body?.innerText || '').slice(0, 20000),
        html: (document.documentElement?.outerHTML || '').slice(0, 120000)
    }));
}

export async function sendRuntimeMessage(page, payload) {
    return page.evaluate(async (message) => chrome.runtime.sendMessage(message), payload);
}

export async function sendRuntimeMessageWithRetry(page, payload, {
    timeoutMs = 20000,
    intervalMs = 1000,
    isRetryable = defaultRuntimeRetryable
} = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            return await sendRuntimeMessage(page, payload);
        } catch (error) {
            lastError = error;
            if (!isRetryable(error)) {
                throw error;
            }
            await page.waitForTimeout(intervalMs);
        }
    }

    throw lastError || new Error('Timed out waiting for extension runtime messaging to recover.');
}

export function sanitizeArtifactName(name) {
    return String(name || '')
        .trim()
        .replace(/[<>:"/\\|?*\s]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}

export function assertNoKnownGarbledFragments(text) {
    const fragments = ['娴ｇ姵', '闂傤噣', '鐠囧嘲', '閸欘亣', '娑撳秷'];
    for (const fragment of fragments) {
        assert.equal(
            String(text || '').includes(fragment),
            false,
            `Unexpected garbled fragment found: ${fragment}`
        );
    }
}

export function getLiveTargetUrl(model) {
    switch (model) {
        case 'ChatGPT':
            return 'https://chatgpt.com/';
        case 'Claude':
            return 'https://claude.ai/';
        case 'Grok':
            return 'https://grok.com/';
        case 'Gemini':
            return 'https://gemini.google.com/';
        case 'Doubao':
            return 'https://www.doubao.com/chat/';
        default:
            throw new Error(`Unsupported live model: ${model}`);
    }
}

export function assertProfileReady(profileRoot) {
    const defaultDir = path.join(profileRoot, 'Default');
    if (!fs.existsSync(profileRoot) || !fs.existsSync(defaultDir)) {
        throw new Error(
            `Automation profile not found at ${profileRoot}. Please run \`npm run test:profile:init\` first.`
        );
    }
}

export function summarizeProfileRoot(profileRoot) {
    return normalizeProfileRelativePath(profileRoot);
}

export async function closeContextQuietly(context) {
    if (!context) return;
    try {
        await context.close();
    } catch (error) {
        console.warn('Failed to close browser context cleanly.', error);
    }
}

export async function closeBrowserQuietly(browser) {
    if (!browser) return;
    try {
        await browser.close();
    } catch (error) {
        console.warn('Failed to disconnect browser cleanly.', error);
    }
}

function defaultRuntimeRetryable(error) {
    const message = String(error?.message || error || '');
    return message.includes('Could not establish connection. Receiving end does not exist.');
}
