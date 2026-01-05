
class ClaudeAdapter extends AdapterBase {
    constructor() {
        super('Claude');
    }

    getInputSelector() {
        // Updated selector for Claude
        // Try to match the contenteditable div in the main input area
        return 'div[contenteditable="true"].ProseMirror'; 
    }

    getSendBtnSelector() {
        // Updated selector for Claude
        // Look for button that contains "Send" or SVG icon
        // Often it has a specific aria-label
        // Also try to find the button near the input
        return 'button[aria-label*="Send"], button[aria-label*="send"], div[contenteditable="true"] ~ div button';
    }

    checkForNewResponse() {
        // Claude's DOM is complex and changes.
        // We look for the last message bubble.
        
        // Try multiple selectors for robustness
        const messageSelector = '.font-claude-message, [data-test-id="chat-message-content"]';
        const messages = document.querySelectorAll(messageSelector);
        
        if (messages.length === 0) return;
        
        const lastMessage = messages[messages.length - 1];
        const currentText = lastMessage.innerText;

        // Detect if "Stop" button is present to determine if generating
        // This is a heuristic: If there is a button that looks like a stop button
        // (Often has a square icon or specific class)
        // For now, we use a text length heuristic if we can't find the button.
        
        const isGenerating = currentText.length > this.lastResponseLength;

        if (isGenerating) {
            this.lastResponseLength = currentText.length;
            this.isGenerating = true;
            this.sendUpdate('generating', currentText.substring(0, 150) + '...');
        } else {
            // If it was generating and now stopped (and length > 0)
            if (this.isGenerating) {
                 // Maybe finished?
                 // Let's assume if it hasn't changed for a few ticks it's done, 
                 // but for now we just report the text.
                 this.sendUpdate('idle', currentText.substring(0, 150) + '...');
            }
            this.isGenerating = false;
        }
    }
    
    onSendPostProcessing() {
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.sendUpdate('generating', 'Waiting for response...');
    }
}

new ClaudeAdapter();
