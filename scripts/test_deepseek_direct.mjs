// Direct Playwright test for DeepSeek attachment upload
// Tests which approach actually works: setInputFiles, upload-btn+filechooser, clipboard paste
import path from 'node:path';
import fs from 'node:fs';

import {
    attachContextDiagnostics,
    attachPageDiagnostics,
    captureArtifact,
    capturePageHtml,
    closeBrowserQuietly,
    connectToChromeOverCdp,
    createFileLogger,
    importPlaywright
} from './lib/playwright_runtime.mjs';
import { buildTestingPaths } from './lib/playwright_env.mjs';

const paths = buildTestingPaths();
const artifactDir = path.join(paths.artifactDir, 'deepseek-direct');
fs.mkdirSync(artifactDir, { recursive: true });
const logger = createFileLogger(path.join(artifactDir, 'direct.log'));

const TEST_PNG_BUFFER = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
);
const TEST_FILE = { name: 'test.png', mimeType: 'image/png', buffer: TEST_PNG_BUFFER };

let browser;

try {
    const playwright = await importPlaywright();
    const attached = await connectToChromeOverCdp({
        playwright, artifactDir, endpoint: paths.cdpEndpoint, timeoutMs: 15000
    });

    browser = attached.browser;
    const context = attached.context;
    attachContextDiagnostics(context, { logger });

    const page = await context.newPage();
    attachPageDiagnostics(page, { label: 'ds', logger });

    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    await captureArtifact(page, path.join(artifactDir, '01-initial.png'));

    // ── Method A: page.setInputFiles() directly on hidden input ──────────────
    console.log('\n── Method A: page.setInputFiles() on hidden input ──');
    try {
        await page.locator('input[type="file"]').setInputFiles(TEST_FILE, { timeout: 5000 });
        await page.waitForTimeout(2500);
        const previewA = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[class*="file"], [class*="attachment"], img[src^="blob:"]'))
                .filter(e => e.getClientRects().length > 0)
                .map(e => ({ tag: e.tagName, cls: String(e.className).slice(0, 80) }))
        );
        console.log('Method A preview elements:', previewA);
        await captureArtifact(page, path.join(artifactDir, '02-methodA.png'));
        fs.writeFileSync(path.join(artifactDir, '02-methodA.json'), JSON.stringify(previewA, null, 2));
        console.log(previewA.length > 0 ? '✓ Method A WORKED' : '✗ Method A: no preview appeared');
    } catch (e) {
        console.log('✗ Method A failed:', e.message);
    }

    // ── Method B: click upload button → intercept filechooser ───────────────
    console.log('\n── Method B: click upload button → filechooser ──');
    try {
        // Navigate to fresh page
        await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Find the upload icon button (not toggle, no text, has SVG)
        const uploadSelector = await page.evaluate(() => {
            const textarea = document.querySelector('textarea[name="search"]');
            if (!textarea) return null;
            let p = textarea.parentElement;
            for (let i = 0; i < 8 && p; i++) {
                const btns = Array.from(p.querySelectorAll('[role="button"]'))
                    .filter(b => b.getClientRects().length > 0 && !b.innerText?.trim());
                if (btns.length >= 2) {
                    const first = btns[0];
                    // Return a unique selector by index within its parent
                    return { found: true, cls: String(first.className).slice(0, 50) };
                }
                p = p.parentElement;
            }
            return null;
        });
        console.log('Upload button info:', uploadSelector);

        // Set up file chooser BEFORE clicking
        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 6000 }),
            page.evaluate(() => {
                const textarea = document.querySelector('textarea[name="search"]');
                if (!textarea) return;
                let p = textarea.parentElement;
                for (let i = 0; i < 8 && p; i++) {
                    const iconBtns = Array.from(p.querySelectorAll('[role="button"]'))
                        .filter(b => b.getClientRects().length > 0 && !b.innerText?.trim());
                    if (iconBtns.length >= 2) {
                        iconBtns[0].click();
                        return;
                    }
                    p = p.parentElement;
                }
            })
        ]);

        await fileChooser.setFiles(TEST_FILE);
        await page.waitForTimeout(3000);

        const previewB = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[class*="file"], [class*="attachment"], img[src^="blob:"]'))
                .filter(e => e.getClientRects().length > 0)
                .map(e => ({ tag: e.tagName, cls: String(e.className).slice(0, 80) }))
        );
        console.log('Method B preview elements:', previewB);
        await captureArtifact(page, path.join(artifactDir, '03-methodB.png'));
        fs.writeFileSync(path.join(artifactDir, '03-methodB.json'), JSON.stringify(previewB, null, 2));
        console.log(previewB.length > 0 ? '✓ Method B WORKED' : '✗ Method B: no preview appeared');

        // If it worked, also find the send button and capture its selector
        if (previewB.length > 0) {
            const sendBtnInfo = await page.evaluate(() => {
                const textarea = document.querySelector('textarea[name="search"]');
                if (!textarea) return null;
                let p = textarea.parentElement;
                for (let i = 0; i < 8 && p; i++) {
                    const iconBtns = Array.from(p.querySelectorAll('[role="button"]'))
                        .filter(b => b.getClientRects().length > 0 && !b.innerText?.trim());
                    if (iconBtns.length >= 2) {
                        const last = iconBtns[iconBtns.length - 1];
                        return { cls: String(last.className).slice(0, 150), disabled: last.getAttribute('aria-disabled') };
                    }
                    p = p.parentElement;
                }
                return null;
            });
            console.log('Send button:', sendBtnInfo);
            fs.writeFileSync(path.join(artifactDir, '03b-sendbtn.json'), JSON.stringify(sendBtnInfo, null, 2));
        }
    } catch (e) {
        console.log('✗ Method B failed:', e.message);
    }

    // ── Method C: clipboard paste ─────────────────────────────────────────────
    console.log('\n── Method C: clipboard paste ──');
    try {
        await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
        await page.evaluate(async () => {
            const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
                0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84,
                8, 215, 99, 248, 255, 255, 159, 161, 30, 0, 7, 130, 2, 127, 61, 200, 72, 239, 0, 0, 0, 0,
                73, 69, 78, 68, 174, 66, 96, 130]);
            const blob = new Blob([bytes], { type: 'image/png' });
            const textarea = document.querySelector('textarea[name="search"]');
            textarea?.focus();
            try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            } catch { /* ignore */ }
            const dt = new DataTransfer();
            dt.items.add(new File([bytes], 'paste.png', { type: 'image/png' }));
            textarea?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        });
        await page.waitForTimeout(3000);
        const previewC = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[class*="file"], [class*="attachment"], img[src^="blob:"]'))
                .filter(e => e.getClientRects().length > 0)
                .map(e => ({ tag: e.tagName, cls: String(e.className).slice(0, 80) }))
        );
        console.log('Method C preview elements:', previewC);
        await captureArtifact(page, path.join(artifactDir, '04-methodC.png'));
        console.log(previewC.length > 0 ? '✓ Method C WORKED' : '✗ Method C: no preview appeared');
    } catch (e) {
        console.log('✗ Method C failed:', e.message);
    }

    console.log('\nAll artifacts saved to:', artifactDir);
} catch (error) {
    logger.error(`Test failed: ${error?.message || error}`);
    console.error('Test failed:', error);
    process.exitCode = 1;
} finally {
    await closeBrowserQuietly(browser);
}
