
class GeminiAdapter extends AdapterBase {
    constructor() {
        super('Gemini');
    }

    async handleInput(text) {
        console.log("GeminiAdapter: handleInput called");
        
        // Use base input handling first to set text
        try {
            await super.handleInput(text);
        } catch (e) {
            console.error("GeminiAdapter: Base handleInput failed, trying fallback", e);
        }
        
        // Extra robustness: Trigger Enter key if button click didn't work (which is handled in super but maybe needs delay)
        // Or if send button is still present and active?
        // Let's just proactively hit Enter after a short delay as a backup
        
        setTimeout(() => {
            const inputSelector = this.getInputSelector();
            const inputEl = document.querySelector(inputSelector);
            if (inputEl) {
                console.log("GeminiAdapter: Dispatching Enter key...");
                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
                inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
                inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
            }
        }, 1200); // Wait for base click to happen first (base waits 800ms)
    }

    getInputSelector() {
        // Enhanced selectors for Gemini
        return 'div.ql-editor, div[contenteditable="true"][role="textbox"], div[aria-label="Enter a prompt here"], div[aria-label*="prompt"]';
    }

    getSendBtnSelector() {
        // Enhanced selectors for Send button
        return 'button[aria-label="Send message"], button[aria-label="Send"], button.send-button, mat-icon[data-mat-icon-name="send"]';
    }

    checkForNewResponse() {
        // Gemini response structure
        // Often in <model-response> or similar custom elements, or simple markdown divs
        // We look for the last response container.
        
        // This selector is a guess based on common Google web app patterns, needs verification
        const messageSelector = '.model-response-text, .response-container-content';
        const messages = document.querySelectorAll(messageSelector);
        
        // Fallback: Try finding by role="log" or similar if specific classes fail
        // But for now let's assume we might need to update this after user testing.
        
        if (messages.length === 0) return;
        
        const lastMessage = messages[messages.length - 1];
        const currentText = lastMessage.innerText;

        // Generating detection: Check for stop button or "Thinking..." indicator
        const stopBtn = document.querySelector('button[aria-label="Stop generating"]');
        const isGenerating = !!stopBtn;

        if (this.isGenerating !== isGenerating) {
            this.isGenerating = isGenerating;
            this.sendUpdate(isGenerating ? 'generating' : 'idle', currentText.substring(0, 150) + '...');
        }

        if (isGenerating && Math.abs(currentText.length - this.lastResponseLength) > 50) {
            this.lastResponseLength = currentText.length;
            this.sendUpdate('generating', currentText.substring(0, 150) + '...');
        }
    }
    
    onSendPostProcessing() {
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.sendUpdate('generating', 'Waiting for response...');
    }
}

new GeminiAdapter();
