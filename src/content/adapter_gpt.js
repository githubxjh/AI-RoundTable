
class ChatGPTAdapter extends AdapterBase {
    constructor() {
        super('ChatGPT');
    }

    getInputSelector() {
        return '#prompt-textarea';
    }

    getSendBtnSelector() {
        return 'button[data-testid="send-button"]';
    }

    checkForNewResponse() {
        // 1. Check if generating
        const stopBtn = document.querySelector('button[aria-label="Stop generating"]');
        const isGenerating = !!stopBtn;

        // 2. Get last message
        const messages = document.querySelectorAll('div[data-message-author-role="assistant"]');
        const lastMessage = messages[messages.length - 1];
        
        if (!lastMessage) return;

        const currentText = lastMessage.innerText;

        // 3. Status Change Detection
        if (this.isGenerating !== isGenerating) {
            this.isGenerating = isGenerating;
            this.sendUpdate(isGenerating ? 'generating' : 'idle', currentText.substring(0, 150) + '...');
        }

        // 4. Content Update Detection (Throttle this in real world)
        // Only send if length changed significantly or finished
        if (isGenerating && Math.abs(currentText.length - this.lastResponseLength) > 50) {
            this.lastResponseLength = currentText.length;
            this.sendUpdate('generating', currentText.substring(0, 150) + '...');
        }
        
        // Final update when done
        if (!isGenerating && this.lastResponseLength > 0) {
            // Reset for next turn
            // this.lastResponseLength = 0; 
            // Don't reset immediately, or we lose the summary. 
            // Reset logic should be on new input.
        }
    }
    
    onSendPostProcessing() {
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.sendUpdate('generating', 'Waiting for response...');
    }
}

// Initialize
new ChatGPTAdapter();
