
class GrokAdapter extends AdapterBase {
    constructor() {
        super('Grok');
        this.lastPrompt = '';
        this.previousContent = '';
    }

    async handleInput(text) {
        console.log("GrokAdapter: handleInput called");
        this.lastPrompt = text; // Save for filtering

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
                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
                inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
                inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
            }
        }, 1200);
    }

    getInputSelector() {
        return `
            div.ProseMirror[contenteditable="true"],
            div[contenteditable="true"].tiptap,
            div[contenteditable="true"][data-testid="grokInput"], 
            div[contenteditable="true"][aria-label="Grok something"]
        `.replace(/\s+/g, ' ').trim();
    }

    getSendBtnSelector() {
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

    getLastMessageText() {
        // Helper to get the very last message text in the stream (User or AI)
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        if (articles.length > 0) {
            const lastArticle = articles[articles.length - 1];
            const textEl = lastArticle.querySelector('div[data-testid="tweetText"]');
            if (textEl) return textEl.innerText;
        }
        
        // Fallback
        const messages = document.querySelectorAll('div[data-testid="tweetText"], .grok-message-content');
        if (messages.length > 0) {
            return messages[messages.length - 1].innerText;
        }
        return '';
    }

    onSendPostProcessing() {
        // Capture the state of the stream *before* (or right as) we send
        this.previousContent = this.getLastMessageText();
        
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.expectingNewMessage = true;
        this.sendUpdate('generating', 'Waiting for response...');
    }

    checkForNewResponse() {
        const currentText = this.getLastMessageText();
        
        if (!currentText) return;

        // Check generation status
        const stopBtn = document.querySelector('button[aria-label="Stop"], button[aria-label="Stop generating"]');
        const isGenerating = !!stopBtn;

        if (this.expectingNewMessage && !isGenerating) {
            // 1. Check if it's the same as before we started
            if (currentText === this.previousContent) return;

            // 2. Check if it's just our own prompt (Optimistic UI or echoing)
            // Use loose matching to handle whitespace/markdown differences
            if (currentText.trim().includes(this.lastPrompt.trim()) && currentText.length < this.lastPrompt.length + 50) {
                // Likely just the user prompt
                return;
            }

            // It's different from previous, and not our prompt. Must be the new answer!
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

new GrokAdapter();
