
class ChatGPTAdapter extends AdapterBase {
    constructor() {
        super('ChatGPT');
        this.previousContent = '';
    }

    getInputSelector() {
        return '#prompt-textarea';
    }

    getSendBtnSelector() {
        return 'button[data-testid="send-button"]';
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
