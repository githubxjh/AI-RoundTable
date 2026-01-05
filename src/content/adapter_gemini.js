
class GeminiAdapter extends AdapterBase {
    constructor() {
        super('Gemini');
        this.previousContent = '';
    }

    async handleInput(text) {
        console.log("GeminiAdapter: handleInput called");
        
        try {
            await super.handleInput(text);
        } catch (e) {
            console.error("GeminiAdapter: Base handleInput failed, trying fallback", e);
        }
        
        // Fallback Enter key
        setTimeout(() => {
            const inputSelector = this.getInputSelector();
            const inputEl = document.querySelector(inputSelector);
            if (inputEl) {
                console.log("GeminiAdapter: Dispatching Enter key...");
                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
                inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
                inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
            }
        }, 1200); 
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
