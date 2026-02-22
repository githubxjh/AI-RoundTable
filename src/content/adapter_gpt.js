
class ChatGPTAdapter extends AdapterBase {
    constructor() {
        super('ChatGPT');
        this.previousContent = '';
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
        // Capture current state before it changes to detect "stale" vs "new"
        const messages = document.querySelectorAll('div[data-message-author-role="assistant"] .markdown');
        this.previousContent = messages.length > 0 ? messages[messages.length - 1].innerText : '';

        // Reset state
        this.lastResponseLength = 0;
        this.isGenerating = true; 
        this.expectingNewMessage = true; // Flag to ignore old messages
        this.sendUpdate('generating', 'Waiting for response...');
    }

    checkForNewResponse() {
        // 1. Check if generating (Stop button is the most reliable indicator)
        const stopBtn = document.querySelector('button[aria-label="Stop generating"]');
        const isGenerating = !!stopBtn;

        // 2. Get last message
        const messages = document.querySelectorAll('div[data-message-author-role="assistant"] .markdown');
        if (messages.length === 0) return;
        
        const lastMessage = messages[messages.length - 1];
        const currentText = lastMessage.innerText;

        // Smart Filtering:
        if (this.expectingNewMessage && !isGenerating) {
             // We are waiting for the new bubble.
             // If the text is exactly the same as before we sent, it's definitely stale.
             if (currentText === this.previousContent) {
                 return; 
             }
             // If it's different, it's likely the new message (even if "generating" isn't caught yet)
             // But valid new messages usually start empty or small. 
             // If it's SUDDENLY long and different, it might be a race condition, but we should accept it.
             this.expectingNewMessage = false; 
        }
        
        if (isGenerating) {
            this.expectingNewMessage = false; // Definitely found it
            
            if (this.isGenerating !== isGenerating) {
                 this.isGenerating = isGenerating;
            }
            
            // Only update if text changed
            if (currentText !== this.lastSentContent) {
                this.lastSentContent = currentText;
                this.sendUpdate('generating', currentText);
            }
        } else {
            // Not generating, but we have new text
            if (this.isGenerating || !this.expectingNewMessage) {
                this.isGenerating = false;
                // Only send final update if it's different/meaningful
                if (currentText !== this.lastSentContent) {
                    this.lastSentContent = currentText;
                    this.sendUpdate('idle', currentText); 
                }
            }
        }
    }
}

// Initialize
new ChatGPTAdapter();
