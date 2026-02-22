class GrokAdapter extends AdapterBase {
    constructor() {
        super('Grok');
        this.lastPrompt = '';
        this.previousContent = '';
        this.stableText = '';
        this.stableTicks = 0;
        this.lastGeneratingSummary = '';
    }

    async handleInput(text) {
        this.lastPrompt = String(text || '');

        const inputSelector = this.getInputSelector();
        const inputEl = await this.waitForElement(inputSelector);
        if (!inputEl) throw new Error(`Input element not found: ${inputSelector}`);

        this.simulateUserInput(inputEl, text);
        await this.delay(700);

        const sendBtn = this.findSendButton();
        let sent = false;
        if (sendBtn) {
            this.simulateClick(sendBtn);
            sent = true;
        } else {
            sent = this.sendByEnter(inputEl);
            if (sent) {
                console.warn('GrokAdapter: send button unavailable, fallback to Enter once');
            }
        }

        if (!sent) {
            throw new Error('GrokAdapter: failed to trigger send');
        }

        this.onSendPostProcessing();
    }

    getInputSelector() {
        return [
            'div.ProseMirror[contenteditable="true"]',
            'div[contenteditable="true"].tiptap',
            'div[contenteditable="true"][data-testid="grokInput"]',
            'div[contenteditable="true"][aria-label*="Grok"]',
            'textarea[placeholder*="Grok"]'
        ].join(', ');
    }

    getSendBtnSelector() {
        return [
            'button[aria-label="Grok"]',
            'button[aria-label*="Send"]',
            'button[data-testid="grokInputSend"]',
            'button[data-testid="pill-button"]',
            'div[role="button"][aria-label="Grok"]',
            'div[role="button"][aria-label*="Send"]'
        ].join(', ');
    }

    getAssistantSelectors() {
        return [
            'div[id^="response-"] .message-bubble',
            'div[id^="response-"] [data-testid="message-bubble"]',
            'div[id^="response-"] [data-testid*="assistant"]',
            'div[id^="response-"] .markdown',
            '[data-testid*="assistant"] .message-bubble',
            '[data-testid*="assistant"] .markdown',
            '.message-bubble'
        ];
    }

    findSendButton() {
        const selector = this.getSendBtnSelector();
        const candidates = Array.from(document.querySelectorAll(selector));
        for (const node of candidates) {
            const target = this.resolveClickableTarget(node);
            if (target && this.isSendButtonAvailable(target)) {
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

    isSendButtonAvailable(node) {
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

    isGeneratingIndicatorActive() {
        const stopSelectors = [
            'button[aria-label="Stop"]',
            'button[aria-label="Stop generating"]',
            'button[aria-label="停止"]',
            'button[aria-label="停止生成"]',
            'button[data-testid*="stop"]'
        ].join(', ');
        const button = document.querySelector(stopSelectors);
        if (!button) return false;
        if (button.disabled) return false;
        if (String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
        return true;
    }

    getBlindSearchLastText() {
        const allElements = document.querySelectorAll('div, p, span, article, section');
        const start = Math.max(0, allElements.length - 250);
        for (let i = allElements.length - 1; i >= start; i -= 1) {
            const node = allElements[i];
            if (!node || node.isContentEditable) continue;
            const text = String(node.innerText || '').trim();
            if (!text || text.length < 8) continue;
            if (text === this.lastPrompt.trim()) continue;
            if (text.includes('How can Grok help')) continue;
            return text;
        }
        return '';
    }

    getLastMessageText() {
        for (const selector of this.getAssistantSelectors()) {
            const nodes = Array.from(document.querySelectorAll(selector))
                .map((node) => String(node.innerText || '').trim())
                .filter(Boolean);
            if (nodes.length > 0) {
                return nodes[nodes.length - 1];
            }
        }

        const responseContainers = document.querySelectorAll('div[id^="response-"]');
        if (responseContainers.length > 0) {
            const text = String(responseContainers[responseContainers.length - 1].innerText || '').trim();
            if (text) return text;
        }

        return this.getBlindSearchLastText();
    }

    looksLikePromptEcho(text) {
        const prompt = this.lastPrompt.trim();
        if (!prompt) return false;
        const normalized = String(text || '').trim();
        if (!normalized) return false;
        if (normalized === prompt) return true;
        if (normalized.startsWith(prompt) && normalized.length <= prompt.length + 80) return true;
        return false;
    }

    onSendPostProcessing() {
        this.previousContent = this.getLastMessageText();
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.expectingNewMessage = true;
        this.stableText = '';
        this.stableTicks = 0;
        this.lastGeneratingSummary = '';
        this.sendUpdate('generating', 'Waiting for response...');
    }

    checkForNewResponse() {
        const currentText = this.getLastMessageText();
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
        if (this.looksLikePromptEcho(currentText)) return;

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

new GrokAdapter();
