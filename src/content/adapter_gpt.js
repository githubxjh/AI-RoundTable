class ChatGPTAdapter extends AdapterBase {
    constructor() {
        super('ChatGPT');
        this.previousContent = '';
        this.stableText = '';
        this.stableTicks = 0;
        this.lastGeneratingSummary = '';
    }

    async handleInput(text) {
        const inputSelector = this.getInputSelector();
        const inputEl = await this.waitForElement(inputSelector);
        if (!inputEl) throw new Error(`Input element not found: ${inputSelector}`);

        this.simulateUserInput(inputEl, text);
        await this.delay(600);

        const sendBtn = this.findSendButton();
        let sent = false;
        if (sendBtn) {
            this.simulateClick(sendBtn);
            sent = true;
        } else {
            sent = this.sendByEnter(inputEl);
            if (sent) {
                console.warn('ChatGPTAdapter: send button unavailable, fallback to Enter once');
            }
        }

        if (!sent) {
            throw new Error('ChatGPTAdapter: failed to trigger send');
        }

        this.onSendPostProcessing();
    }

    getInputSelector() {
        return '#prompt-textarea';
    }

    getSendBtnSelector() {
        return [
            'button[data-testid="send-button"]',
            'button[data-testid="fruitjuice-send-button"]',
            'button[aria-label="Send prompt"]',
            'button[aria-label="Send message"]',
            'button[aria-label*="Send"]'
        ].join(', ');
    }

    getAssistantMessageSelectors() {
        return [
            'div[data-message-author-role="assistant"] .markdown',
            'div[data-message-author-role="assistant"] [data-message-text]',
            'article[data-testid*="assistant"] .markdown',
            '[data-testid*="assistant-turn"] .markdown',
            'div[data-message-author-role="assistant"]'
        ];
    }

    findSendButton() {
        const selector = this.getSendBtnSelector();
        const candidates = Array.from(document.querySelectorAll(selector));
        for (const node of candidates) {
            if (this.isSendButtonAvailable(node)) {
                return node;
            }
        }
        return null;
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
            'button[aria-label="Stop generating"]',
            'button[aria-label="Stop"]',
            'button[aria-label="停止生成"]',
            'button[aria-label="停止"]',
            'button[data-testid*="stop"]'
        ].join(', ');
        const button = document.querySelector(stopSelectors);
        if (!button) return false;
        if (button.disabled) return false;
        if (String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
        return true;
    }

    getLastAssistantText() {
        for (const selector of this.getAssistantMessageSelectors()) {
            const nodes = Array.from(document.querySelectorAll(selector))
                .map((node) => String(node.innerText || '').trim())
                .filter(Boolean);
            if (nodes.length > 0) {
                return nodes[nodes.length - 1];
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

new ChatGPTAdapter();
