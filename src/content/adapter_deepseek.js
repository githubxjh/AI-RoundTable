class DeepSeekAdapter extends AdapterBase {
    constructor() {
        super('DeepSeek');
        this.previousContent = '';
        this.lastSentContent = '';
        this.expectingNewMessage = false;
        this.stableText = '';
        this.stableTicks = 0;
        this.lastGeneratingSummary = '';
    }

    getInputSelector() {
        return [
            'textarea[name="search"]',
            '.ds-textarea textarea',
            '.ds-scroll-area.ds-textarea textarea',
            'textarea[placeholder*="DeepSeek"]',
            'textarea'
        ].join(', ');
    }

    async handleInput(text) {
        const inputSelector = this.getInputSelector();
        const inputEl = await this.waitForElement(inputSelector);
        if (!inputEl) throw new Error(`Input element not found: ${inputSelector}`);

        this.simulateUserInput(inputEl, text);
        await this.delay(600);

        const sendBtn = await this.waitForAvailableSendButton(2500);
        let sent = false;
        if (sendBtn) {
            this.simulateClick(sendBtn);
            sent = true;
        } else {
            sent = this.sendByEnter(inputEl);
            if (sent) {
                console.warn('DeepSeekAdapter: send button unavailable, fallback to Enter once');
            }
        }

        if (!sent) {
            throw new Error('DeepSeekAdapter: failed to trigger send');
        }

        return {
            inputEl,
            text,
            sendButtonBefore: sendBtn
        };
    }

    findSendButton() {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const node of candidates) {
            const target = this.resolveClickableTarget(node);
            if (!target || !this.isSendButtonAvailable(target)) continue;
            if (this.isLikelySendButton(target)) {
                return target;
            }
        }

        return this.findComposerFallbackButton();
    }

    findComposerFallbackButton() {
        const inputEl = document.querySelector(this.getInputSelector());
        if (!inputEl) return null;

        const roots = [];
        let current = inputEl.closest?.('form') || inputEl.parentElement;
        for (let i = 0; current && i < 5; i += 1) {
            roots.push(current);
            current = current.parentElement;
        }

        for (const root of roots) {
            const buttons = Array.from(root.querySelectorAll?.('button, [role="button"]') || [])
                .map((node) => this.resolveClickableTarget(node))
                .filter((node) => node && this.isSendButtonAvailable(node) && !this.isToolButton(node));
            if (buttons.length > 0) {
                return buttons[buttons.length - 1];
            }
        }

        return null;
    }

    isLikelySendButton(node) {
        if (!node || this.isToolButton(node)) return false;
        const text = this.getButtonFingerprint(node);
        return /(send|submit|arrow-up|\u53d1\u9001|\u63d0\u4ea4|\u9359\u6226)/i.test(text);
    }

    isToolButton(node) {
        const text = this.getButtonFingerprint(node);
        return /(upload|attach|attachment|file|paperclip|search|deep.?think|reason|voice|mic|\u4e0a\u4f20|\u9644\u4ef6|\u8054\u7f51|\u641c\u7d22|\u6df1\u5ea6\u601d\u8003|\u8bed\u97f3|\u9ea6\u514b\u98ce)/i.test(text);
    }

    getButtonFingerprint(node) {
        return [
            String(node.getAttribute?.('aria-label') || ''),
            String(node.getAttribute?.('title') || ''),
            String(node.getAttribute?.('data-testid') || ''),
            String(node.getAttribute?.('class') || node.className || ''),
            String(node.innerText || node.textContent || '')
        ].join(' ').toLowerCase();
    }

    isGeneratingIndicatorActive() {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
        return candidates.some((node) => {
            const target = this.resolveClickableTarget(node);
            if (!target || !this.isSendButtonAvailable(target)) return false;
            return /(stop|cancel|\u505c\u6b62|\u4e2d\u6b62)/i.test(this.getButtonFingerprint(target));
        });
    }

    getLastAssistantText() {
        const nodes = Array.from(document.querySelectorAll('.ds-markdown'));
        for (let i = nodes.length - 1; i >= 0; i -= 1) {
            const node = nodes[i];
            if (node.closest?.('.ds-think-content')) continue;
            if (this.isInsideComposer(node)) continue;

            const text = String(node.innerText || node.textContent || '').trim();
            if (text) return text;
        }

        return '';
    }

    isInsideComposer(node) {
        if (!node) return false;
        if (node.closest?.('textarea')) return true;
        if (node.closest?.('[contenteditable="true"]')) return true;
        return false;
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

new DeepSeekAdapter();
