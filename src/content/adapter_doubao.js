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

    init() {
        super.init();
        setTimeout(() => this.syncExistingResponse(), 0);
    }

    getInputSelector() {
        return [
            'textarea[data-testid="chat_input_input"]',
            'textarea[placeholder*="发消息"]',
            'textarea[placeholder*="输入"]',
            'textarea'
        ].join(', ');
    }

    getSendBtnSelector() {
        return [
            'button[data-testid="chat_input_send"]',
            '[data-testid="chat_input_send"] button',
            '[data-testid="chat_input"] button[aria-label*="发送"]',
            '[data-testid="chat_input"] button[aria-label*="Send"]',
            '[data-testid="chat_input"] button',
            'button[aria-label*="发送"]',
            'button[aria-label*="Send"]',
            'button[type="submit"]'
        ].join(', ');
    }

    getAttachmentInputSelector() {
        return [
            'input[data-testid="upload-file-input"][type="file"]',
            'input[type="file"][accept*=".pdf"]',
            'input[type="file"][accept*="image"]',
            'input[type="file"][accept*="pdf"]',
            'input[type="file"]'
        ].join(', ');
    }

    getAttachmentBusySelectors() {
        return [
            '[data-testid="chat_input"] [aria-busy="true"]',
            '[data-testid="chat_input"] [class*="uploading"]',
            '[data-testid="chat_input"] [class*="loading"]',
            '[data-testid="chat_input"] [role="progressbar"]'
        ];
    }

    getAttachmentReadySelectors() {
        return [
            '[data-testid="chat_input"] [class*="file"]',
            '[data-testid="chat_input"] [class*="attachment"]',
            '[data-testid="chat_input"] [data-testid*="file"]'
        ];
    }

    async handleInput(text) {
        const inputSelector = this.getInputSelector();
        const inputEl = await this.waitForElement(inputSelector);
        if (!inputEl) throw new Error(`Input element not found: ${inputSelector}`);

        this.simulateUserInput(inputEl, text);
        await this.delay(500);

        const sendBtn = await this.waitForAvailableSendButton(2500);
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

        return {
            inputEl,
            text,
            sendButtonBefore: sendBtn
        };
    }

    findSendButton() {
        const selector = this.getSendBtnSelector();
        let candidates = [];
        try {
            candidates = Array.from(document.querySelectorAll(selector));
        } catch (error) {
            console.warn('DoubaoAdapter: invalid send selector', error);
            return null;
        }
        for (const node of candidates) {
            const target = this.resolveClickableTarget(node);
            if (!target || !this.isSendButtonAvailable(target)) continue;
            if (this.isLikelySendButton(target)) {
                return target;
            }
        }
        return null;
    }

    isLikelySendButton(node) {
        if (!node) return false;
        const text = [
            String(node.getAttribute('aria-label') || ''),
            String(node.getAttribute('title') || ''),
            String(node.getAttribute('data-testid') || ''),
            String(node.className || ''),
            String(node.innerText || '')
        ].join(' ').toLowerCase();

        if (/upload|attach|file|paperclip|上传|附件|asr|voice|mic/.test(text)) {
            return false;
        }

        if (/send|发送|submit/.test(text)) return true;

        const parent = node.closest('[data-testid="chat_input"]');
        if (!parent) return false;
        const siblings = Array.from(parent.querySelectorAll('button, [role="button"]'))
            .filter((el) => this.isSendButtonAvailable(el));
        if (siblings.length === 0) return false;
        return siblings[siblings.length - 1] === node;
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
            '[data-testid="chat_input"] [class*="stop"]',
            '[data-testid*="stop"]'
        ].join(', ');
        const stopBtn = document.querySelector(stopSelector);
        if (!stopBtn) return false;
        if (stopBtn.disabled) return false;
        if (String(stopBtn.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
        return true;
    }

    getLastAssistantText() {
        const legacyText = this.getLastAssistantTextFromLegacyDom();
        if (legacyText) return legacyText;

        const modernText = this.getLastAssistantTextFromModernDom();
        if (modernText) return modernText;

        return '';
    }

    getLastAssistantTextFromLegacyDom() {
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

    getLastAssistantTextFromModernDom() {
        const messageNodes = Array.from(document.querySelectorAll('[data-message-id]'));
        for (let index = messageNodes.length - 1; index >= 0; index -= 1) {
            const text = this.extractModernAssistantMessageText(messageNodes[index]);
            if (text) return text;
        }
        return '';
    }

    extractModernAssistantMessageText(messageNode) {
        if (!messageNode || this.isModernUserMessageNode(messageNode)) return '';

        const selectors = [
            '.flow-markdown-body',
            '[class*="flow-markdown-body"]',
            '[data-plugin-identifier*="block_type:10000"] [class*="markdown"]',
            '[data-plugin-identifier*="block_type:10000"]'
        ];

        for (const selector of selectors) {
            const nodes = Array.from(messageNode.querySelectorAll(selector))
                .filter((node) => !this.isInsideThinkingBlock(node))
                .map((node) => this.normalizeExtractedText(node.innerText || node.textContent || ''))
                .filter(Boolean);
            if (nodes.length > 0) {
                return nodes.join('\n\n').trim();
            }
        }

        return '';
    }

    isModernUserMessageNode(messageNode) {
        const classText = [
            String(messageNode.getAttribute?.('class') || ''),
            String(messageNode.className || '')
        ].join(' ');
        if (/justify-end|send-msg-bubble/.test(classText)) return true;

        return Boolean(messageNode.querySelector?.('[class*="send-msg-bubble"]'));
    }

    isInsideThinkingBlock(node) {
        return Boolean(node?.closest?.([
            '[data-thinking-box]',
            '[data-plugin-identifier*="block_type:10040"]',
            '[class*="thinking"]'
        ].join(', ')));
    }

    normalizeExtractedText(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    syncExistingResponse() {
        const currentText = this.getLastAssistantText();
        if (!currentText || currentText === this.lastSentContent) return;
        this.isGenerating = false;
        this.expectingNewMessage = false;
        this.stableText = currentText;
        this.stableTicks = 2;
        this.lastSentContent = currentText;
        this.sendUpdate('idle', currentText);
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
