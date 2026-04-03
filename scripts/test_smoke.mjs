import assert from 'node:assert/strict';
import path from 'node:path';

import { buildPanelSmokeState } from './lib/extension_smoke_state.mjs';
import {
    buildTestingPaths,
    resetDir
} from './lib/playwright_env.mjs';
import {
    assertNoKnownGarbledFragments,
    attachContextDiagnostics,
    captureArtifact,
    capturePageHtml,
    closeContextQuietly,
    createFileLogger,
    importPlaywright,
    launchExtensionContext,
    openExtensionPanel,
    parseHeadlessFlag,
    seedExtensionStorage,
    waitForPanelReady
} from './lib/playwright_runtime.mjs';

const headless = parseHeadlessFlag(process.argv.slice(2), false);
const paths = buildTestingPaths();
const smokeRunId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const smokeArtifactDir = path.join(paths.artifactDir, 'smoke');
const smokeUserDataDir = path.join(paths.smokeUserDataDir, smokeRunId);

resetDir(smokeArtifactDir);
resetDir(smokeUserDataDir);

const logger = createFileLogger(path.join(smokeArtifactDir, 'smoke.log'));

let context;
let panelPage;

try {
    logger.log(`smoke:start headless=${String(headless)} runId=${smokeRunId}`);

    logger.log('smoke:import-playwright');
    const playwright = await importPlaywright();

    logger.log('smoke:launch-context');
    const launched = await launchExtensionContext({
        playwright,
        extensionPath: paths.extensionPath,
        browserChannel: paths.automationBrowserChannel,
        chromeExecutable: paths.chromeExecutable,
        userDataDir: smokeUserDataDir,
        artifactDir: smokeArtifactDir,
        headless
    });

    context = launched.context;
    attachContextDiagnostics(context, { logger });
    logger.log(`smoke:extension-id ${launched.extensionId}`);

    logger.log('smoke:open-panel');
    panelPage = await openExtensionPanel(context, launched.extensionId, { logger });

    logger.log('smoke:wait-panel-ready-initial');
    await waitForPanelReady(panelPage);

    logger.log('smoke:seed-storage');
    await seedExtensionStorage(panelPage, buildPanelSmokeState());

    logger.log('smoke:reload-panel');
    await panelPage.reload({ waitUntil: 'domcontentloaded' });

    logger.log('smoke:wait-panel-ready-after-reload');
    await waitForPanelReady(panelPage);

    logger.log('smoke:assert-shell-ui');
    await panelPage.waitForSelector('text=全局提问', { timeout: 20000 });

    const bodyText = await panelPage.locator('body').innerText();
    logger.log(`smoke:body-length ${bodyText.length}`);
    assertNoKnownGarbledFragments(bodyText);

    [
        '全局提问',
        '轮次',
        '路由器',
        '评审',
        '清空引用',
        '开始路由',
        '恢复模板'
    ].forEach((text) => {
        assert.equal(bodyText.includes(text), true, `Missing UI text: ${text}`);
    });

    logger.log('smoke:assert-round-state');
    await expectTextContains(panelPage, '#broadcast-btn', '群发');
    await expectTextContains(panelPage, '#clear-quotes', '清空引用');
    await expectTextContains(panelPage, '#route-btn', '开始路由');
    await expectTextContains(panelPage, '#start-review-btn', '开始评分评审');
    await expectTextContains(panelPage, '#round-question', '如何把 AI RoundTable 打造成更高效的多模型协作插件？');
    await expectTextContains(panelPage, '#result-board', '最终分');

    logger.log('smoke:quote-and-router');
    await panelPage.locator('#card-gpt .btn-quote').click();
    await panelPage.locator('.chip', { hasText: '找漏洞' }).click();
    await panelPage.locator('.chip', { hasText: '补盲区' }).click();
    await panelPage.locator('.chip', { hasText: '要落地' }).click();

    const dialogMessage = await clickAndAcceptDialog(
        panelPage,
        panelPage.locator('.chip', { hasText: '提问题' })
    );
    assert.equal(dialogMessage.includes('修饰器最多只能选择 2 个'), true);

    const previewText = await panelPage.locator('#router-preview').innerText();
    assert.equal(previewText.includes('最严格的审查者视角'), true);
    assert.equal(previewText.includes('盲区'), true);
    assert.equal(previewText.includes('可执行方案'), true);

    logger.log('smoke:fill-router-supplement');
    await panelPage.fill('#router-input', '请优先输出可执行步骤。');
    assert.equal(
        await panelPage.locator('#router-input').inputValue(),
        '请优先输出可执行步骤。'
    );

    logger.log('smoke:toggle-review-mode');
    await panelPage.selectOption('#review-mode', 'discussion');
    await expectTextContains(panelPage, '#start-review-btn', '开始讨论评审');
    await expectInputValueContains(panelPage, '#review-template', '你将作为圆桌审议成员参与讨论。');

    await panelPage.selectOption('#review-mode', 'scoring');
    await expectTextContains(panelPage, '#start-review-btn', '开始评分评审');
    await expectTextContains(panelPage, '#result-board', '理由：');
    await expectTextContains(panelPage, '#result-board', '证据：');

    logger.log('smoke:capture-success-artifacts');
    await captureArtifact(panelPage, path.join(smokeArtifactDir, 'panel-smoke.png'));
    await capturePageHtml(panelPage, path.join(smokeArtifactDir, 'panel-smoke.html'));

    logger.log('smoke:success');
    console.log('Smoke test completed successfully.');
} catch (error) {
    logger.error(`smoke:failure ${error?.stack || error?.message || String(error)}`);
    console.error('Smoke test failed.');
    console.error(error);

    if (panelPage) {
        await captureArtifact(panelPage, path.join(smokeArtifactDir, 'panel-smoke-failure.png')).catch(() => {});
        await capturePageHtml(panelPage, path.join(smokeArtifactDir, 'panel-smoke-failure.html')).catch(() => {});
    }

    process.exitCode = 1;
} finally {
    logger.log('smoke:close-context');
    await closeContextQuietly(context);
}

async function expectTextContains(page, selector, expectedText) {
    await page.waitForFunction(({ currentSelector, currentExpectedText }) => {
        const element = document.querySelector(currentSelector);
        if (!element) return false;
        const text = element.textContent || element.innerText || '';
        return text.includes(currentExpectedText);
    }, { currentSelector: selector, currentExpectedText: expectedText }, { timeout: 10000 });

    const actual = await page.locator(selector).innerText();
    assert.equal(actual.includes(expectedText), true, `Expected ${selector} to include: ${expectedText}`);
}

async function clickAndAcceptDialog(page, locator) {
    const dialogMessagePromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Timed out waiting for dialog.'));
        }, 10000);

        page.once('dialog', async (dialog) => {
            try {
                clearTimeout(timeoutId);
                const message = dialog.message();
                await dialog.accept();
                resolve(message);
            } catch (error) {
                reject(error);
            }
        });
    });

    await locator.click();
    return dialogMessagePromise;
}

async function expectInputValueContains(page, selector, expectedText) {
    await page.waitForFunction(({ currentSelector, currentExpectedText }) => {
        const element = document.querySelector(currentSelector);
        return element instanceof HTMLInputElement
            || element instanceof HTMLTextAreaElement
            ? element.value.includes(currentExpectedText)
            : false;
    }, { currentSelector: selector, currentExpectedText: expectedText }, { timeout: 10000 });

    const actual = await page.locator(selector).inputValue();
    assert.equal(actual.includes(expectedText), true, `Expected ${selector} value to include: ${expectedText}`);
}
