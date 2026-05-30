import path from 'node:path';
import fs from 'node:fs';

import {
    DEFAULT_LIVE_CORE_MODELS,
    normalizeLiveModels
} from './lib/live_workflow.mjs';
import {
    attachContextDiagnostics,
    attachPageDiagnostics,
    assertAttachedChromeTarget,
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
    DEFAULT_ADVANCED_CDP_PORT,
    buildTestingPaths
} from './lib/playwright_env.mjs';
import {
    buildMissingCdpMessage
} from './lib/chrome_attach.mjs';

// Create a minimal 1x1 red PNG as test attachment (valid image, tiny size).
const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const ATTACHMENT_MIME_BY_EXT = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
    ['.gif', 'image/gif'],
    ['.pdf', 'application/pdf'],
    ['.txt', 'text/plain'],
    ['.md', 'text/markdown'],
    ['.csv', 'text/csv']
]);

function parseAttachmentTestArgs(argv = []) {
    const modelArgs = [];
    let attachmentPath = '';

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--file' || arg === '--attachment') {
            attachmentPath = argv[index + 1] || '';
            index += 1;
            continue;
        }
        if (arg.startsWith('--file=')) {
            attachmentPath = arg.slice('--file='.length);
            continue;
        }
        if (arg.startsWith('--attachment=')) {
            attachmentPath = arg.slice('--attachment='.length);
            continue;
        }
        modelArgs.push(arg);
    }

    return {
        requestedModels: normalizeLiveModels(modelArgs, DEFAULT_LIVE_CORE_MODELS),
        attachmentPath
    };
}

function readAttachmentFromFile(filePath) {
    const resolvedPath = path.resolve(filePath);
    const buffer = fs.readFileSync(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    return {
        name: path.basename(resolvedPath),
        mimeType: ATTACHMENT_MIME_BY_EXT.get(ext) || 'application/octet-stream',
        size: buffer.length,
        base64: buffer.toString('base64'),
        sourcePath: resolvedPath
    };
}

function buildDefaultAttachment() {
    return {
        name: 'test-image.png',
        mimeType: 'image/png',
        size: 68,
        base64: TEST_PNG_BASE64
    };
}

function buildAttachmentPrompt(attachment) {
    if (String(attachment?.mimeType || '').startsWith('image/')) {
        return 'Describe the attached image in one sentence.';
    }
    return 'Summarize the attached file in one sentence.';
}

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

const { requestedModels, attachmentPath } = parseAttachmentTestArgs(process.argv.slice(2));
const paths = buildTestingPaths({ defaultCdpPort: DEFAULT_ADVANCED_CDP_PORT });
const artifactDir = path.join(paths.artifactDir, 'attachment-test');
const logger = createFileLogger(path.join(artifactDir, 'attachment.log'));

fs.mkdirSync(artifactDir, { recursive: true });

let browser;

try {
    const missing = assertChromePaths(paths);
    if (missing.length > 0) {
        throw new Error(missing.join('\n'));
    }
    const expectedProfileRoot = paths.advancedAutomationUserDataDir;
    assertProfileReady(expectedProfileRoot);

    logger.log(`test:attachment:start models=${requestedModels.join(',')} cdp=${paths.cdpEndpoint}`);
    if (attachmentPath) {
        logger.log(`test:attachment:file ${path.resolve(attachmentPath)}`);
    }

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
    await assertAttachedChromeTarget(context, {
        expectedUserDataDir: expectedProfileRoot,
        expectedCdpPort: paths.cdpPort,
        logger
    });

    const extensionId = await resolveAttachedExtensionId({
        context,
        repoRoot: path.join(paths.repoRoot, 'output', 'advanced-release', 'AI-RoundTable-advanced'),
        profileName: `${paths.automationProfileName} @ ${expectedProfileRoot}`,
        preferencesPath: paths.advancedAutomationPreferencesPath,
        securePreferencesPath: paths.advancedAutomationSecurePreferencesPath
    });
    logger.log(`extension-id ${extensionId}`);

    const panelPage = await openExtensionPanel(context, extensionId, { logger });
    await waitForPanelReady(panelPage);
    await clearExtensionStorage(panelPage);

    const pingResponse = await sendRuntimeMessageWithRetry(panelPage, {
        type: 'ROUND_LIST',
        limit: 1
    }, { timeoutMs: 20000, intervalMs: 1000 });
    logger.log(`runtime-ping ${JSON.stringify(pingResponse)}`);

    const testAttachment = attachmentPath
        ? readAttachmentFromFile(attachmentPath)
        : buildDefaultAttachment();
    const testPrompt = buildAttachmentPrompt(testAttachment);

    const capabilityResponse = await sendRuntimeMessageWithRetry(panelPage, {
        type: 'ATTACHMENT_CAPABILITIES',
        targets: requestedModels,
        attachments: [testAttachment],
        attachmentMode: 'advanced'
    }, { timeoutMs: 20000, intervalMs: 1000 });
    logger.log(`attachment-capabilities ${JSON.stringify(capabilityResponse)}`);
    assertExpectedRuntimeCapabilities(capabilityResponse);

    const results = [];

    for (const model of requestedModels) {
        const safeName = sanitizeArtifactName(model);
        const modelArtifactDir = path.join(artifactDir, safeName);
        fs.mkdirSync(modelArtifactDir, { recursive: true });

        const targetPage = await context.newPage();
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
                text: testPrompt,
                targets: [model],
                attachments: [testAttachment],
                attachmentMode: 'advanced'
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
            const attachmentRecord = (broadcastResponse?.attachmentResults || [])
                .find((item) => item?.model === model);
            const attachmentOk = attachmentRecord?.attachmentStatus === 'supported'
                && attachmentRecord?.method === 'cdp_advanced'
                && attachmentRecord?.code === 'attachment_cdp_uploaded';

            if (sentModels.includes(model) && attachmentOk) {
                logger.log(`${safeName}:PASS (attachment uploaded through Advanced CDP)`);
                results.push({ model, status: 'ok', attachment: attachmentRecord });
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

function assertExpectedRuntimeCapabilities(response) {
    if (response?.status !== 'ok') {
        throw new Error(`Attachment capability probe failed: ${JSON.stringify(response)}`);
    }
    const gemini = response.capabilities?.Gemini;
    const doubao = response.capabilities?.Doubao;
    const deepseek = response.capabilities?.DeepSeek;
    const unprovenCdpModels = ['ChatGPT', 'Grok'];

    if (gemini && (
        gemini.status !== 'supported'
        || gemini.method !== 'cdp_advanced'
        || gemini.code !== 'attachment_cdp_available'
    )) {
        throw new Error(
            'Attached extension runtime does not advertise Gemini as the first Advanced CDP attachment path. '
            + 'Run `cmd /c npm.cmd run release:advanced`, restart the 9333 Advanced Chrome session, then retry.'
        );
    }

    for (const model of unprovenCdpModels) {
        const capability = response.capabilities?.[model];
        if (capability && (capability.status !== 'manual_required' || capability.method !== 'manual')) {
            throw new Error(
                `Attached extension runtime still advertises ${model} Advanced CDP attachments, but the path is not proven. `
                + 'Run `cmd /c npm.cmd run release:advanced`, restart the 9333 Advanced Chrome session, then retry.'
            );
        }
    }
    if (doubao && (doubao.status !== 'manual_required' || doubao.method !== 'manual')) {
        throw new Error(
            'Attached extension runtime still advertises Doubao automated attachments. '
            + 'Run `cmd /c npm.cmd run release:advanced`, restart the 9333 Advanced Chrome session, then retry.'
        );
    }
    if (deepseek && (deepseek.status !== 'manual_required' || deepseek.method !== 'manual')) {
        throw new Error(
            'Attached extension runtime still advertises DeepSeek Advanced CDP attachments. '
            + 'Run `cmd /c npm.cmd run release:advanced`, restart the 9333 Advanced Chrome session, then retry.'
        );
    }
}

function getLiveTargetUrl(model) {
    switch (model) {
        case 'ChatGPT': return 'https://chatgpt.com/';
        case 'Grok': return 'https://grok.com/';
        case 'Gemini': return 'https://gemini.google.com/app';
        case 'Doubao': return 'https://www.doubao.com/chat/';
        case 'DeepSeek': return 'https://chat.deepseek.com/';
        default: throw new Error(`Unsupported model: ${model}`);
    }
}
