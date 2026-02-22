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
            'div[data-message-author-role="assistant"] [data-testid*="message"]',
            'article[data-testid*="conversation-turn"] [data-message-author-role="assistant"] .markdown',
            'article[data-testid*="assistant"] .markdown',
            '[data-testid*="assistant-turn"] .markdown',
            '[data-testid*="conversation-turn-assistant"] .markdown',
            'main [data-message-author-role="assistant"] .whitespace-pre-wrap',
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
            'button[aria-label="Stop generating"]',
            'button[aria-label="Stop"]',
            'button[aria-label*="Stop"]',
            'button[aria-label*="stop"]',
            'button[aria-label*="\u505c\u6b62"]',
            'button[aria-label*="\u4e2d\u6b62"]',
            'button[data-testid*="stop"]',
            '[role="button"][aria-label*="Stop"]',
            '[role="button"][aria-label*="\u505c\u6b62"]'
        ].join(', ');
        const direct = document.querySelector(stopSelectors);
        if (this.isInteractiveButton(direct)) return true;

        const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
        return candidates.some((node) => {
            if (!this.isInteractiveButton(node)) return false;
            const label = [
                String(node.getAttribute('aria-label') || ''),
                String(node.getAttribute('title') || ''),
                String(node.innerText || '')
            ].join(' ').toLowerCase();
            return /(stop generating|stop|\u505c\u6b62\u751f\u6210|\u505c\u6b62|\u4e2d\u6b62)/i.test(label);
        });
    }

    isLikelyComposerNode(node) {
        if (!node) return false;
        if (node.isContentEditable) return true;
        if (node.closest('#prompt-textarea')) return true;
        if (node.closest('[contenteditable="true"]')) return true;
        return false;
    }

    getLastAssistantText() {
        for (const selector of this.getAssistantMessageSelectors()) {
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

new ChatGPTAdapter();
