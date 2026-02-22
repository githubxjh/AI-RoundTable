class DoubaoAdapter extends AdapterBase {
    constructor() {
        super('Doubao');
        this.previousContent = '';
        this.lastSentContent = '';
        this.expectingNewMessage = false;
        this.stableText = '';
        this.stableTicks = 0;
        this.lastGeneratingSummary = '';
    }

    getInputSelector() {
        return [
            'textarea[data-testid="chat_input_input"]',
            'textarea[placeholder*="发送"]',
            'textarea[placeholder*="输入"]'
        ].join(', ');
    }

    getSendBtnSelector() {
        return [
            'button[data-testid="chat_input_send"]',
            '[data-testid="chat_input_send"] button',
            'button[aria-label*="发送"]',
            'button[aria-label*="Send"]',
            'button[type="submit"]'
        ].join(', ');
    }

    async handleInput(text) {
        const inputSelector = this.getInputSelector();
        const inputEl = await this.waitForElement(inputSelector);
        if (!inputEl) throw new Error(`Input element not found: ${inputSelector}`);

        this.simulateUserInput(inputEl, text);
        await this.delay(500);

        const sendBtn = this.findSendButton();
        let sent = false;
        if (sendBtn) {
            this.simulateClick(sendBtn);
            sent = true;
        } else {
            sent = this.sendByEnter(inputEl);
            if (sent) {
                console.warn('DoubaoAdapter: send button unavailable, fallback to Enter once');
            }
        }

        if (!sent) {
            throw new Error('DoubaoAdapter: failed to trigger send');
        }

        this.onSendPostProcessing();
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

    isGeneratingIndicatorActive() {
        const stopSelector = [
            'button[data-testid="chat_input_stop"]',
            'button[aria-label*="停止"]',
            'button[aria-label*="Stop"]',
            '[data-testid*="stop"]'
        ].join(', ');
        const stopBtn = document.querySelector(stopSelector);
        if (!stopBtn) return false;
        if (stopBtn.disabled) return false;
        if (String(stopBtn.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
        return true;
    }

    getLastAssistantText() {
        const selectors = [
            '[data-testid="receive_message"] [data-testid="message_text_content"]',
            '[data-testid="receive_message"] [data-testid="message-content"]',
            '[data-testid="receive_message"] .markdown-body',
            '[data-testid="receive_message"] .message-text',
            '[data-testid*="receive"] [data-testid*="message_text"]',
            '[data-testid*="receive"] [class*="message"]'
        ];

        for (const selector of selectors) {
            const nodes = Array.from(document.querySelectorAll(selector))
                .map((node) => String(node.innerText || '').trim())
                .filter(Boolean);
            if (nodes.length > 0) {
                return nodes[nodes.length - 1];
            }
        }

        const containers = document.querySelectorAll('[data-testid="receive_message"]');
        if (containers.length > 0) {
            const text = String(containers[containers.length - 1].innerText || '').trim();
            if (text) return text;
        }

        return '';
    }

    checkForNewResponse() {
        const currentText = this.getLastAssistantText();
        const isGenerating = this.isGeneratingIndicatorActive();

        if (isGenerating) {
            const summary = currentText || 'Generating...';
            this.expectingNewMessage = false;
            this.stableTicks = 0;
            this.stableText = '';

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

        if (!currentText) return;
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

        if (this.lastSentContent === currentText && !this.isGenerating) return;

        this.isGenerating = false;
        this.lastSentContent = currentText;
        this.sendUpdate('idle', currentText);
    }
}

new DoubaoAdapter();
