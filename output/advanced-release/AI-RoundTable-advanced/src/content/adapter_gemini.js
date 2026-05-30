class GeminiAdapter extends AdapterBase {
    constructor() {
        super('Gemini');
        this.previousContent = '';
        this._sentRequestAt = new Map();
        this._sendGuardWindowMs = 3000;
        this.stableText = '';
        this.stableTicks = 0;
        this.lastGeneratingSummary = '';
    }

    async handleInput(text) {
        const requestId = this.currentRequestId || null;
        if (!this.acquireSendLock(requestId)) {
            console.warn(`GeminiAdapter: duplicate send blocked for requestId=${requestId}`);
            return { skipConfirm: true };
        }

        const inputSelector = this.getInputSelector();
        const inputEl = await this.waitForElement(inputSelector);
        if (!inputEl) throw new Error(`Input element not found: ${inputSelector}`);

        this.simulateUserInput(inputEl, text);
        await this.delay(800);

        const sendBtn = await this.waitForAvailableSendButton(7000);
        let sent = false;
        if (sendBtn) {
            this.activateSendButton(sendBtn);
            sent = true;
        } else {
            sent = this.sendByEnter(inputEl);
            if (sent) {
                console.log('GeminiAdapter: fallback to Enter once (send button missing)');
            }
        }

        if (!sent) {
            throw new Error('GeminiAdapter: failed to trigger send');
        }

        return {
            inputEl,
            text,
            sendButtonBefore: sendBtn
        };
    }

    activateSendButton(sendBtn) {
        if (sendBtn && typeof sendBtn.click === 'function') {
            sendBtn.click();
            return;
        }
        this.simulateClick(sendBtn);
    }

    acquireSendLock(requestId) {
        if (!requestId) return true;
        const now = Date.now();
        for (const [id, ts] of this._sentRequestAt.entries()) {
            if (now - ts > this._sendGuardWindowMs * 2) {
                this._sentRequestAt.delete(id);
            }
        }
        const lastAt = this._sentRequestAt.get(requestId);
        if (typeof lastAt === 'number' && now - lastAt < this._sendGuardWindowMs) {
            return false;
        }
        this._sentRequestAt.set(requestId, now);
        return true;
    }

    getInputSelector() {
        return [
            'div.ql-editor',
            'div[contenteditable="true"][role="textbox"]',
            'div[aria-label="Enter a prompt here"]',
            'div[aria-label*="prompt"]'
        ].join(', ');
    }

    getSendBtnSelector() {
        return [
            'button[aria-label="Send message"]',
            'button[aria-label="Send"]',
            'button[aria-label="\u53d1\u9001"]',
            'button[aria-label="\u53d1\u9001\u6d88\u606f"]',
            'button[title="Send"]',
            'button[title="\u53d1\u9001"]',
            'button.send-button',
            'mat-icon[data-mat-icon-name="send"]',
            'mat-icon[data-mat-icon-name="arrow_upward"]'
        ].join(', ');
    }

    getAttachmentInputSelector() {
        return [
            'input[type="file"][accept*=".pdf"]',
            'input[type="file"][accept*="image"]',
            'input[type="file"][accept*="pdf"]',
            'input[type="file"]'
        ].join(', ');
    }

    async prepareAttachmentInput() {
        await this.openAttachmentUIIfNeeded();
        const inputEl = await this.findAttachmentInput();
        if (inputEl) {
            return {
                status: 'attachment_input_ready',
                inputMode: 'file_input',
                inputSelector: this.getAttachmentInputSelector(),
                inputVisible: this.isElementVisible(inputEl),
                multiple: Boolean(inputEl.multiple)
            };
        }
        return {
            status: 'attachment_input_ready',
            inputMode: 'file_chooser',
            triggerExpression: this.getCdpFileChooserTriggerExpression(),
            inputSelector: this.getAttachmentInputSelector(),
            inputVisible: false,
            multiple: false
        };
    }

    getCdpFileChooserTriggerExpression() {
        return `(() => new Promise(async (resolve, reject) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const visible = (node) => Boolean(node && node.getClientRects && node.getClientRects().length > 0);
            const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
            const labelFor = (node) => normalizeText([
                node?.getAttribute?.('aria-label'),
                node?.getAttribute?.('title'),
                node?.innerText,
                node?.textContent
            ].join(' '));
            const describeCandidate = (node) => {
                if (!node) return null;
                return {
                    tag: node.tagName || '',
                    role: node.getAttribute?.('role') || '',
                    ariaLabel: node.getAttribute?.('aria-label') || '',
                    className: String(node.className || '').slice(0, 120),
                    text: normalizeText(node.innerText || node.textContent).slice(0, 160),
                    visible: visible(node)
                };
            };
            const clickTarget = (node) => {
                if (!node) return false;
                const target = node.closest?.('button, [role="button"], [role="menuitem"], [xapfileselectortrigger], .mat-mdc-menu-item') || node;
                target.focus?.();
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((eventType) => {
                    const EventCtor = eventType.startsWith('pointer') && typeof PointerEvent === 'function'
                        ? PointerEvent
                        : MouseEvent;
                    target.dispatchEvent(new EventCtor(eventType, {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        pointerId: 1,
                        pointerType: 'mouse',
                        button: 0,
                        buttons: eventType.endsWith('down') ? 1 : 0
                    }));
                });
                if (typeof target.click === 'function') {
                    target.click();
                    return true;
                }
                target.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                }));
                return true;
            };
            const isLocalFileLabel = (label) => {
                if (/Drive|Google Drive|\u4e91\u7aef\u786c\u76d8/.test(label)) return false;
                return /Upload files?|Upload from computer|Local files?|\u4e0a\u4f20\u6587\u4ef6|\u672c\u5730\u6587\u4ef6|\u4ece\u8bbe\u5907\u4e0a\u4f20/i.test(label);
            };
            const collectLocalFileButtons = () => Array.from(document.querySelectorAll([
                'button[data-test-id="local-images-files-uploader-button"]',
                'button[aria-label*="上传文件"]',
                'button[aria-label*="Upload files"]',
                'button[aria-label*="Upload file"]',
                '[role="menuitem"]',
                '.mat-mdc-menu-item',
                '.hidden-local-file-image-selector-button',
                '[xapfileselectortrigger]'
            ].join(','))).map((node) => {
                const target = node.closest?.('button, [role="button"], [role="menuitem"], .mat-mdc-menu-item, [xapfileselectortrigger]') || node;
                const label = normalizeText([
                    labelFor(target),
                    labelFor(node)
                ].join(' '));
                const special = node.matches?.('.hidden-local-file-image-selector-button, [xapfileselectortrigger]')
                    || target.matches?.('.hidden-local-file-image-selector-button, [xapfileselectortrigger]');
                return { node, target, label, special, visible: visible(target), local: isLocalFileLabel(label) };
            });
            const visibleLocalFileButton = () => collectLocalFileButtons()
                .find((item) => item.visible && item.local)?.target || null;
            const hiddenLocalFileButton = () => collectLocalFileButtons()
                .find((item) => item.special)?.target || null;
            const findLocalFileButton = () => visibleLocalFileButton() || hiddenLocalFileButton();
            const uploadDiagnostics = () => collectLocalFileButtons()
                .slice(0, 12)
                .map((item) => ({
                    ...describeCandidate(item.target),
                    label: item.label.slice(0, 160),
                    special: Boolean(item.special),
                    local: Boolean(item.local)
                }));
            const isHistoryActionMenu = (target, node) => {
                const className = String(target?.className || '') + ' ' + String(node?.className || '');
                const label = normalizeText([
                    target?.getAttribute?.('aria-label'),
                    target?.getAttribute?.('title'),
                    node?.getAttribute?.('aria-label'),
                    node?.getAttribute?.('title')
                ].join(' '));
                const icon = String(node?.getAttribute?.('data-mat-icon-name') || target?.querySelector?.('mat-icon')?.getAttribute?.('data-mat-icon-name') || '');
                return icon === 'more_vert'
                    || /gem-conversation-actions-menu-button/.test(className)
                    || /\u66f4\u591a\u9009\u9879|more options/i.test(label);
            };
            const uploadMenuScore = (target, node) => {
                if (!visible(target) || isHistoryActionMenu(target, node)) return 0;
                const label = normalizeText([
                    target.getAttribute?.('aria-label'),
                    target.getAttribute?.('title'),
                    target.innerText,
                    target.textContent
                ].join(' '));
                const icon = String(node.getAttribute?.('data-mat-icon-name') || target.querySelector?.('mat-icon')?.getAttribute?.('data-mat-icon-name') || '');
                if (/\u4e0a\u4f20\u548c\u5de5\u5177|upload and tools|add files?|attach files?/i.test(label)) return 100;
                if (icon === 'plus' || icon === 'add' || icon === 'attach_file') return 90;
                if (/Upload|upload|Attach|\u4e0a\u4f20/.test(label)) return 70;
                return 0;
            };
            const findUploadMenuButton = () => Array.from(document.querySelectorAll('button, [role="button"], mat-icon'))
                .map((node) => {
                    const target = node.closest?.('button, [role="button"]') || node;
                    return { target, score: uploadMenuScore(target, node) };
                })
                .filter((item) => item.score > 0)
                .sort((a, b) => b.score - a.score)[0]?.target || null;

            let uploader = findLocalFileButton();
            if (!uploader) {
                const menuButton = findUploadMenuButton();
                clickTarget(menuButton);
                await sleep(500);
                uploader = findLocalFileButton();
            }
            if (!uploader) {
                reject(new Error('Gemini local file uploader button was not found; candidates=' + JSON.stringify(uploadDiagnostics())));
                return;
            }
            if (!clickTarget(uploader)) {
                reject(new Error('Gemini local file uploader button could not be clicked; target=' + JSON.stringify(describeCandidate(uploader))));
                return;
            }
            resolve({ clicked: true, target: describeCandidate(uploader), candidates: uploadDiagnostics() });
        }))()`;
    }

    async openAttachmentUIIfNeeded() {
        const selector = this.getAttachmentInputSelector();
        const existing = selector ? document.querySelector(selector) : null;
        if (existing) return;

        const candidates = Array.from(document.querySelectorAll([
            'button[aria-label*="Upload"]',
            'button[aria-label*="upload"]',
            'button[aria-label*="\u4e0a\u4f20"]',
            'button[aria-label*="\u9644\u4ef6"]',
            'button[aria-label*="Attach"]',
            '.upload-icon',
            '.uploader-button-container button',
            'button mat-icon[data-mat-icon-name="add"]',
            'button mat-icon[data-mat-icon-name="attach_file"]'
        ].join(', ')));

        for (const node of candidates) {
            const target = this.resolveClickableTarget(node);
            if (!this.isSendTargetAvailable(target)) continue;
            this.simulateClick(target);
            await this.delay(220);
            const fileInput = selector ? document.querySelector(selector) : null;
            if (fileInput) return;
        }
    }

    getAttachmentBusySelectors() {
        return [
            '.uploader-file-preview-container [role="progressbar"]',
            '.uploader-file-preview-container [aria-busy="true"]',
            '.uploader-file-preview-container .loading',
            '.attachment-preview-wrapper [aria-busy="true"]',
            '.attachment-preview-wrapper .loading'
        ];
    }

    getAttachmentReadySelectors() {
        return [
            '.attachment-preview-wrapper',
            '.uploader-file-preview-container .file-preview',
            '.uploader-file-preview-container [data-testid*="file"]',
            '.uploader-file-preview-container [class*="preview"]'
        ];
    }

    getMessageSelectors() {
        return [
            '[data-turn-role="model"] .model-response-text',
            '[data-turn-role="model"] .response-container-content',
            '[data-message-author-role="assistant"] .response-content',
            '[data-response-id] .response-content',
            '[data-response-id] .markdown',
            '.model-response-text',
            '.response-container-content',
            'message-content',
            '.response-content',
            '[data-message-author-role="assistant"]'
        ];
    }

    findSendButton() {
        const selector = this.getSendBtnSelector();
        let candidates = [];
        try {
            candidates = Array.from(document.querySelectorAll(selector));
        } catch (error) {
            console.warn('GeminiAdapter: invalid send selector', error);
            return null;
        }
        for (const node of candidates) {
            const target = this.resolveClickableTarget(node);
            if (target && this.isSendTargetAvailable(target) && this.isSendButtonCandidate(target)) {
                return target;
            }
        }
        return null;
    }

    isSendButtonCandidate(node) {
        if (!node) return false;
        const label = [
            String(node.getAttribute?.('aria-label') || ''),
            String(node.getAttribute?.('title') || ''),
            String(node.innerText || '')
        ].join(' ').replace(/\s+/g, ' ').trim();
        if (/^(send|send message|submit|\u53d1\u9001|\u53d1\u9001\u6d88\u606f|\u63d0\u4ea4)$/i.test(label)) {
            return true;
        }
        const iconName = String(node.querySelector?.('mat-icon')?.getAttribute?.('data-mat-icon-name') || '').trim();
        return iconName === 'send' || iconName === 'arrow_upward';
    }

    resolveClickableTarget(node) {
        if (!node) return null;
        if (node.matches('button, [role="button"]')) return node;
        return node.closest('button, [role="button"]');
    }

    isSendTargetAvailable(node) {
        if (!node) return false;
        if (node.disabled) return false;
        if (String(node.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
        if ((node.getClientRects() || []).length === 0) return false;
        return true;
    }

    sendByEnter(inputEl) {
        if (!inputEl) return false;
        inputEl.focus();
        const eventInit = {
            key: 'Enter',
            code: 'Enter',
            which: 13,
            keyCode: 13,
            bubbles: true,
            cancelable: true
        };
        inputEl.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        inputEl.dispatchEvent(new KeyboardEvent('keypress', eventInit));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', eventInit));
        return true;
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    isVisible(node) {
        if (!node) return false;
        return (node.getClientRects() || []).length > 0;
    }

    isInteractiveButton(node) {
        if (!node) return false;
        if (node.disabled) return false;
        if (String(node.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
        return this.isVisible(node);
    }

    isGeneratingIndicatorActive() {
        const stopSelectors = [
            'button[aria-label="Stop"]',
            'button[aria-label*="Stop generating"]',
            'button[aria-label*="Stop response"]',
            'button[aria-label*="stop generating"]',
            'button[aria-label*="stop response"]',
            'button[data-mat-icon-name="stop"]',
            'mat-icon[data-mat-icon-name="stop"]',
            '[data-testid*="stop"]'
        ].join(', ');
        const direct = document.querySelector(stopSelectors);
        if (direct) {
            const actionable = direct.matches('button, [role="button"]')
                ? direct
                : direct.closest('button, [role="button"]');
            if (this.isInteractiveButton(actionable || direct)) return true;
        }

        const busyResponseSelectors = [
            '.markdown-main-panel[aria-busy="true"]',
            '[data-turn-role="model"] [aria-busy="true"]',
            'message-content [aria-busy="true"]',
            '.response-container-content [aria-busy="true"]',
            '.model-response-text [aria-busy="true"]'
        ].join(', ');
        const busyResponse = Array.from(document.querySelectorAll(busyResponseSelectors))
            .some((node) => this.isVisible(node) && !this.isLikelyComposerNode(node));
        if (busyResponse) return true;

        const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
        return candidates.some((node) => {
            if (!this.isInteractiveButton(node)) return false;
            const label = [
                String(node.getAttribute('aria-label') || ''),
                String(node.getAttribute('title') || ''),
                String(node.innerText || '')
            ].join(' ');
            return this.isStopGenerationLabel(label);
        });
    }

    isStopGenerationLabel(value) {
        const label = String(value || '').replace(/\s+/g, ' ').trim();
        if (!label) return false;
        if (/^(stop|stopping|cancel)$/i.test(label)) return true;
        if (/\b(stop|cancel)\s+(generating|generation|response|responding|answer)\b/i.test(label)) return true;
        return /(\u505c\u6b62|\u4e2d\u6b62)(\u751f\u6210|\u56de\u590d|\u56de\u7b54|\u54cd\u5e94)/.test(label);
    }

    isLikelyComposerNode(node) {
        if (!node) return false;
        if (node.isContentEditable) return true;
        if (node.closest('.ql-editor')) return true;
        if (node.closest('[contenteditable="true"]')) return true;
        return false;
    }

    getLastAssistantText() {
        for (const selector of this.getMessageSelectors()) {
            const nodes = Array.from(document.querySelectorAll(selector));
            for (let i = nodes.length - 1; i >= 0; i -= 1) {
                const node = nodes[i];
                if (!node) continue;
                if (this.isLikelyComposerNode(node)) continue;
                const text = String(node.innerText || '').trim();
                if (!text) continue;
                return text;
            }
        }
        return '';
    }

    onSendPostProcessing() {
        this.previousContent = this.getLastAssistantText();
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.expectingNewMessage = true;
        this.stableText = '';
        this.stableTicks = 0;
        this.lastGeneratingSummary = '';
        this.sendUpdate('generating', 'Waiting for response...');
    }

    checkForNewResponse() {
        const currentText = this.getLastAssistantText();
        const isGenerating = this.isGeneratingIndicatorActive();

        if (isGenerating) {
            const summary = currentText || 'Generating...';
            this.expectingNewMessage = false;
            this.stableText = '';
            this.stableTicks = 0;
            if (!this.isGenerating || summary !== this.lastGeneratingSummary) {
                this.sendUpdate('generating', summary);
                this.lastGeneratingSummary = summary;
            }
            this.isGenerating = true;
            if (currentText) {
                this.lastSentContent = currentText;
            }
            return;
        }

        this.lastGeneratingSummary = '';
        if (!currentText.trim()) return;

        if (this.expectingNewMessage) {
            if (currentText === this.previousContent) return;
            this.expectingNewMessage = false;
        }

        if (currentText !== this.stableText) {
            this.stableText = currentText;
            this.stableTicks = 1;
            return;
        }

        this.stableTicks += 1;
        if (this.stableTicks < 2) return;
        if (currentText === this.lastSentContent && !this.isGenerating) return;

        this.isGenerating = false;
        this.lastSentContent = currentText;
        this.sendUpdate('idle', currentText);
    }
}

new GeminiAdapter();
