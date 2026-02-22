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
            return;
        }

        const inputSelector = this.getInputSelector();
        const inputEl = await this.waitForElement(inputSelector);
        if (!inputEl) throw new Error(`Input element not found: ${inputSelector}`);

        this.simulateUserInput(inputEl, text);
        await this.delay(800);

        const sendBtn = this.findSendButton();
        let sent = false;
        if (sendBtn) {
            this.simulateClick(sendBtn);
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

        this.onSendPostProcessing();
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
            'button[aria-label*="\u53d1\u9001"]',
            'button.send-button',
            'mat-icon[data-mat-icon-name="send"]'
        ].join(', ');
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
        const candidates = Array.from(document.querySelectorAll(selector));
        for (const node of candidates) {
            const target = this.resolveClickableTarget(node);
            if (target && this.isSendTargetAvailable(target)) {
                return target;
            }
        }
        return null;
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
            'button[aria-label*="Stop"]',
            'button[aria-label*="stop"]',
            'button[aria-label*="\u505c\u6b62"]',
            'button[aria-label*="\u4e2d\u6b62"]',
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

        const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
        return candidates.some((node) => {
            if (!this.isInteractiveButton(node)) return false;
            const label = [
                String(node.getAttribute('aria-label') || ''),
                String(node.getAttribute('title') || ''),
                String(node.innerText || '')
            ].join(' ').toLowerCase();
            return /(stop|stopping|\u505c\u6b62|\u4e2d\u6b62)/i.test(label);
        });
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
