import path from 'node:path';
import fs from 'node:fs';

import {
    DEFAULT_LIVE_CORE_MODELS,
    normalizeLiveModels
} from './lib/live_workflow.mjs';
import {
    attachContextDiagnostics,
    attachPageDiagnostics,
    assertProfileReady,
    captureArtifact,
    capturePageHtml,
    clearExtensionStorage,
    closeBrowserQuietly,
    connectToChromeOverCdp,
    createFileLogger,
    importPlaywright,
    openExtensionPanel,
    readExtensionStorage,
    resolveAttachedExtensionId,
    sanitizeArtifactName,
    sendRuntimeMessageWithRetry,
    waitForPanelReady
} from './lib/playwright_runtime.mjs';
import {
    assertChromePaths,
    buildTestingPaths
} from './lib/playwright_env.mjs';
import {
    buildMissingCdpMessage
} from './lib/chrome_attach.mjs';

// Models that need pre-upload via Playwright (extension can't do trusted clicks)
const PLAYWRIGHT_UPLOAD_MODELS = new Set(['DeepSeek']);

async function uploadFilesViaPlaywright(page, model, testAttachment, logger) {
    const safeName = sanitizeArtifactName(model);
    if (model !== 'DeepSeek') return false;

    logger.log(`${safeName}:playwright-upload start`);

    const buf = Buffer.from(testAttachment.base64, 'base64');

    try {
        // Re-navigate to ensure fresh page
        await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3500);

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 8000 }),
            page.evaluate(() => {
                const textarea = document.querySelector('textarea[name="search"]');
                if (!textarea) return;
                let p = textarea.parentElement;
                for (let i = 0; i < 8 && p; i++) {
                    const iconBtns = Array.from(p.querySelectorAll('[role="button"]'))
                        .filter(b => b.getClientRects().length > 0 && !b.innerText?.trim());
                    if (iconBtns.length >= 2) { iconBtns[0].click(); return; }
                    p = p.parentElement;
                }
            })
        ]);

        await fileChooser.setFiles({ name: testAttachment.name, mimeType: testAttachment.mimeType, buffer: buf });
        logger.log(`${safeName}:playwright-upload file chooser set`);

        // Wait for upload preview to appear (poll for up to 12s)
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
            const uploaded = await page.evaluate(() =>
                Array.from(document.querySelectorAll('.f14f0c0b, [class*="file-upload"], [class*="upload-file"]'))
                    .some(e => e.getClientRects().length > 0)
            );
            if (uploaded) break;
            await page.waitForTimeout(400);
        }

        logger.log(`${safeName}:playwright-upload done`);
        return true;
    } catch (e) {
        logger.warn(`${safeName}:playwright-upload failed ${e.message}`);
        return false;
    }
}

const argv = process.argv.slice(2);
const requestedModels = normalizeLiveModels(argv, DEFAULT_LIVE_CORE_MODELS);
const paths = buildTestingPaths();
const artifactDir = path.join(paths.artifactDir, 'attachment-test');
const logger = createFileLogger(path.join(artifactDir, 'attachment.log'));

fs.mkdirSync(artifactDir, { recursive: true });

let browser;

try {
    const missing = assertChromePaths(paths);
    if (missing.length > 0) {
        throw new Error(missing.join('\n'));
    }
    assertProfileReady(paths.automationUserDataDir);

    logger.log(`test:attachment:start models=${requestedModels.join(',')} cdp=${paths.cdpEndpoint}`);

    const playwright = await importPlaywright();
    const attached = await connectToChromeOverCdp({
        playwright,
        artifactDir,
        endpoint: paths.cdpEndpoint,
        timeoutMs: 15000
    });

    browser = attached.browser;
    const context = attached.context;
    attachContextDiagnostics(context, { logger });

    const extensionId = await resolveAttachedExtensionId({
        context,
        repoRoot: paths.repoRoot,
        profileName: `${paths.automationProfileName} @ ${paths.automationUserDataDir}`,
        preferencesPath: paths.automationPreferencesPath,
        securePreferencesPath: paths.automationSecurePreferencesPath
    });
    logger.log(`extension-id ${extensionId}`);

    // Reload the extension to ensure latest content scripts are loaded
    logger.log('reloading extension...');
    const extPage = await context.newPage();
    await extPage.goto(`chrome://extensions/?id=${extensionId}`, { waitUntil: 'domcontentloaded' });
    await extPage.waitForTimeout(1000);
    await extPage.evaluate((extId) => {
        const btn = document.querySelector('#update-now') || document.querySelector('#dev-reload-button') || document.querySelector('cr-button[aria-label*="Reload"]');
        if (btn) btn.click();
    }, extensionId);
    await extPage.waitForTimeout(2000);
    await extPage.close();
    logger.log('extension reloaded');

    const panelPage = await openExtensionPanel(context, extensionId, { logger });
    await waitForPanelReady(panelPage);
    await clearExtensionStorage(panelPage);

    const pingResponse = await sendRuntimeMessageWithRetry(panelPage, {
        type: 'ROUND_LIST',
        limit: 1
    }, { timeoutMs: 20000, intervalMs: 1000 });
    logger.log(`runtime-ping ${JSON.stringify(pingResponse)}`);

    const testAttachment = {
        name: 'test-image.png',
        mimeType: 'image/png',
        size: 68,
        base64: TEST_PNG_BASE64
    };

    const results = [];

    for (const model of requestedModels) {
        const safeName = sanitizeArtifactName(model);
        const modelArtifactDir = path.join(artifactDir, safeName);
        fs.mkdirSync(modelArtifactDir, { recursive: true });

// Create a minimal 1x1 red PNG as test attachment (valid image, tiny size)
const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
        attachPageDiagnostics(targetPage, { label: `target:${safeName}`, logger });

        // Also capture console from the target page for adapter logs
        const consoleEntries = [];
        targetPage.on('console', (msg) => {
            const text = msg.text();
            if (text.includes('[AIRoundTable|')) {
                consoleEntries.push({
                    ts: Date.now(),
                    type: msg.type(),
                    text
                });
            }
        });

        try {
            const targetUrl = getLiveTargetUrl(model);
            logger.log(`${safeName}:goto ${targetUrl}`);
            await targetPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await targetPage.waitForTimeout(4000);

            // Screenshot before broadcast
            await captureArtifact(targetPage, path.join(modelArtifactDir, '01-before-broadcast.png'));

            // Send broadcast with attachment
            logger.log(`${safeName}:broadcast-with-attachment`);
            const broadcastResponse = await sendRuntimeMessageWithRetry(panelPage, {
                type: 'BROADCAST',
                text: 'Describe this image in one sentence.',
                targets: [model],
                attachments: [testAttachment]
            }, { timeoutMs: 35000, intervalMs: 1000 });

            logger.log(`${safeName}:broadcast-response ${JSON.stringify(broadcastResponse)}`);

            // Wait a moment for page to react
            await targetPage.waitForTimeout(2000);

            // Screenshot after broadcast
            await captureArtifact(targetPage, path.join(modelArtifactDir, '02-after-broadcast.png'));
            await capturePageHtml(targetPage, path.join(modelArtifactDir, '03-page.html'));

            // Capture adapter diagnostic logs
            await targetPage.waitForTimeout(1000);
            const diagData = await readExtensionStorage(panelPage, 'rt_attachment_diag');
            const modelDiags = (diagData?.rt_attachment_diag || [])
                .filter((d) => d.model === model);
            fs.writeFileSync(
                path.join(modelArtifactDir, '04-diagnostics.json'),
                JSON.stringify(modelDiags, null, 2),
                'utf8'
            );

            // Capture console entries from adapter
            fs.writeFileSync(
                path.join(modelArtifactDir, '05-adapter-console.json'),
                JSON.stringify(consoleEntries, null, 2),
                'utf8'
            );

            // Evaluate page state for attachment-related DOM
            const domState = await targetPage.evaluate(() => {
                const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'))
                    .map((el) => ({
                        tag: el.tagName,
                        id: el.id || '',
                        className: el.className || '',
                        accept: el.getAttribute('accept') || '',
                        multiple: el.multiple,
                        visible: el.getClientRects().length > 0,
                        files: el.files?.length || 0
                    }));
                const attachmentPreviews = Array.from(document.querySelectorAll([
                    '[class*="file-preview"]',
                    '[class*="attachment"]',
                    '[class*="upload-file"]',
                    '[class*="file-item"]',
                    '[class*="file-tile"]',
                    'img[src^="blob:"]'
                ].join(', '))).map((el) => ({
                    tag: el.tagName,
                    className: String(el.className || '').slice(0, 120),
                    visible: el.getClientRects().length > 0,
                    text: String(el.innerText || '').slice(0, 200)
                }));
                const sendButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
                    .filter((el) => {
                        const label = (el.getAttribute('aria-label') || el.innerText || '').toLowerCase();
                        return /send|submit|发送|提交/.test(label);
                    })
                    .map((el) => ({
                        tag: el.tagName,
                        ariaLabel: el.getAttribute('aria-label') || '',
                        disabled: el.disabled,
                        ariaDisabled: el.getAttribute('aria-disabled') || '',
                        visible: el.getClientRects().length > 0,
                        className: String(el.className || '').slice(0, 120)
                    }));
                const uploadingIndicators = Array.from(document.querySelectorAll([
                    '[class*="uploading"]',
                    '[class*="progress"]',
                    '[aria-busy="true"]',
                    '[role="progressbar"]'
                ].join(', '))).map((el) => ({
                    tag: el.tagName,
                    className: String(el.className || '').slice(0, 120),
                    ariaBusy: el.getAttribute('aria-busy') || '',
                    role: el.getAttribute('role') || '',
                    visible: el.getClientRects().length > 0
                }));

                return { fileInputs, attachmentPreviews, sendButtons, uploadingIndicators };
            });
            fs.writeFileSync(
                path.join(modelArtifactDir, '06-dom-state.json'),
                JSON.stringify(domState, null, 2),
                'utf8'
            );

            const sentModels = broadcastResponse?.sentModels || [];
            const degraded = broadcastResponse?.degraded || [];
            const failed = broadcastResponse?.failed || [];

            if (sentModels.includes(model)) {
                logger.log(`${safeName}:PASS (sent successfully)`);
                results.push({ model, status: 'ok' });
            } else if (degraded.some((d) => d.model === model)) {
                const info = degraded.find((d) => d.model === model);
                logger.warn(`${safeName}:DEGRADED ${info?.code || ''} ${info?.reason || ''}`);
                results.push({ model, status: 'degraded', code: info?.code, reason: info?.reason });
            } else if (failed.some((f) => f.model === model)) {
                const info = failed.find((f) => f.model === model);
                logger.error(`${safeName}:FAILED ${info?.code || ''} ${info?.reason || ''}`);
                results.push({ model, status: 'failed', code: info?.code, reason: info?.reason });
            } else {
                logger.warn(`${safeName}:UNKNOWN (model not in any result category)`);
                results.push({ model, status: 'unknown', rawResponse: broadcastResponse });
            }
        } catch (error) {
            logger.error(`${safeName}:error ${error?.message || String(error)}`);
            await captureArtifact(targetPage, path.join(modelArtifactDir, 'error.png')).catch(() => {});
            await capturePageHtml(targetPage, path.join(modelArtifactDir, 'error.html')).catch(() => {});
            results.push({ model, status: 'error', reason: error?.message || String(error) });
        } finally {
            await targetPage.close().catch(() => {});
        }
    }

    // Summary
    console.log('\n=== ATTACHMENT TEST RESULTS ===');
    for (const r of results) {
        const icon = r.status === 'ok' ? '✓' : r.status === 'degraded' ? '⚠' : '✗';
        console.log(`${icon} ${r.model}: ${r.status}${r.reason ? ' — ' + r.reason : ''}`);
    }
    console.log(`\nArtifacts saved to: ${artifactDir}`);

    const failedCount = results.filter((r) => r.status !== 'ok').length;
    if (failedCount > 0) {
        process.exitCode = 1;
    }
} catch (error) {
    const message = String(error?.message || error || '').toLowerCase();
    if (message.includes('econnrefused') || message.includes('debugging endpoint')) {
        console.error(buildMissingCdpMessage(paths.cdpEndpoint));
    } else {
        console.error('Attachment test failed:', error);
    }
    process.exitCode = 1;
} finally {
    await closeBrowserQuietly(browser);
}

function getLiveTargetUrl(model) {
    switch (model) {
        case 'ChatGPT': return 'https://chatgpt.com/';
        case 'Grok': return 'https://grok.com/';
        case 'Gemini': return 'https://gemini.google.com/';
        case 'Doubao': return 'https://www.doubao.com/chat/';
        case 'DeepSeek': return 'https://chat.deepseek.com/';
        default: throw new Error(`Unsupported model: ${model}`);
    }
}
