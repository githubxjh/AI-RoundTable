
class GeminiAdapter extends AdapterBase {
    constructor() {
        super('Gemini');
        this.previousContent = '';
        this._sentRequestAt = new Map();
        this._sendGuardWindowMs = 3000;
    }

    async handleInput(text) {
        console.log("GeminiAdapter: handleInput called");

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
            console.log("GeminiAdapter: Clicking send button...");
            this.simulateClick(sendBtn);
            sent = true;
        } else {
            sent = this.sendByEnter(inputEl);
            if (sent) {
                console.log("GeminiAdapter: Fallback to Enter once (send button missing)");
            }
        }

        if (!sent) {
            throw new Error("GeminiAdapter: failed to trigger send");
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

    getInputSelector() {
        return 'div.ql-editor, div[contenteditable="true"][role="textbox"], div[aria-label="Enter a prompt here"], div[aria-label*="prompt"]';
    }

    getSendBtnSelector() {
        return 'button[aria-label="Send message"], button[aria-label="Send"], button.send-button, mat-icon[data-mat-icon-name="send"]';
    }

    onSendPostProcessing() {
        // Capture previous content
        const messageSelector = '.model-response-text, .response-container-content, message-content';
        const messages = document.querySelectorAll(messageSelector);
        this.previousContent = messages.length > 0 ? messages[messages.length - 1].innerText : '';

        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.expectingNewMessage = true;
        this.sendUpdate('generating', 'Waiting for response...');
    }

    checkForNewResponse() {
        const messageSelector = '.model-response-text, .response-container-content, message-content';
        const messages = document.querySelectorAll(messageSelector);
        
        if (messages.length === 0) return;
        
        const lastMessage = messages[messages.length - 1];
        const currentText = lastMessage.innerText;

        // Generating detection
        const stopBtn = document.querySelector('button[aria-label*="Stop"]');
        const isGenerating = !!stopBtn;

        // Stale check
        if (this.expectingNewMessage && !isGenerating) {
             // If content matches previous, it's stale.
             if (currentText === this.previousContent) return; 
             
             // Content changed! It's new.
             this.expectingNewMessage = false;
        }

        if (isGenerating) {
            this.expectingNewMessage = false;
            if (this.isGenerating !== isGenerating) {
                this.isGenerating = isGenerating;
            }
            if (currentText !== this.lastSentContent) {
                this.lastSentContent = currentText;
                this.sendUpdate('generating', currentText);
            }
        } else {
             if (this.isGenerating || !this.expectingNewMessage) {
                this.isGenerating = false;
                if (currentText !== this.lastSentContent) {
                    this.lastSentContent = currentText;
                    this.sendUpdate('idle', currentText);
                }
            }
        }
    }
}

new GeminiAdapter();
