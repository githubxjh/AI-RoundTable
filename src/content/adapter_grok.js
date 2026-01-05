
class GrokAdapter extends AdapterBase {
    constructor() {
        super('Grok');
    }

    async handleInput(text) {
        console.log("GrokAdapter: handleInput called");
        try {
            await super.handleInput(text);
        } catch (e) {
            console.error("GrokAdapter: Base handleInput failed", e);
        }

        // Grok Enter key fallback
        setTimeout(() => {
            const inputSelector = this.getInputSelector();
            const inputEl = document.querySelector(inputSelector);
            if (inputEl) {
                console.log("GrokAdapter: Dispatching Enter key...");
                // TipTap/ProseMirror often handles Enter on keydown
                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
                inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
                inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
            }
        }, 1200);
    }

    getInputSelector() {
        // Updated selectors based on debug logs
        // The input is a .ProseMirror div
        return `
            div.ProseMirror[contenteditable="true"],
            div[contenteditable="true"].tiptap,
            div[contenteditable="true"][data-testid="grokInput"], 
            div[contenteditable="true"][aria-label="Grok something"]
        `.replace(/\s+/g, ' ').trim();
    }

    getSendBtnSelector() {
        // X.com send buttons
        // Try to find button with aria-label containing "Send" or SVG path
        return `
            button[aria-label="Grok"], 
            button[aria-label="Grok something"],
            button[aria-label="Send"],
            button[aria-label="Send message"],
            button[data-testid="grokInputSend"],
            button[data-testid="pill-button"],
            div[role="button"][aria-label="Grok"]
        `.replace(/\s+/g, ' ').trim();
    }

    checkForNewResponse() {
        // Grok responses on x.com
        // Need to identify the message bubbles.
        
        const messageSelector = 'div[data-testid="grokMessage"]'; // Hypothetical selector
        const messages = document.querySelectorAll(messageSelector);
        
        if (messages.length === 0) return;
        
        const lastMessage = messages[messages.length - 1];
        const currentText = lastMessage.innerText;

        // Check generation status
        // Grok usually streams. 
        // We can check if the text is growing or if there's a specific "Stop" button.
        const stopBtn = document.querySelector('button[aria-label="Stop"]');
        const isGenerating = !!stopBtn; // Or use text length change heuristic

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

new GrokAdapter();
