
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

    onSendPostProcessing() {
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.sendUpdate('generating', 'Waiting for response...');
    }

    checkForNewResponse() {
        // Claude's DOM is complex and changes.
        // We look for the last message bubble.
        
        // Try multiple selectors for robustness
        const messageSelector = '.font-claude-message, [data-test-id="chat-message-content"], div[data-is-streaming="true"]';
        const messages = document.querySelectorAll(messageSelector);
        
        if (messages.length === 0) return;
        
        const lastMessage = messages[messages.length - 1];
        
        // Extract text but exclude thought process
        let currentText = "";
        
        // Clone the node to manipulate it without affecting the DOM
        const clone = lastMessage.cloneNode(true);
        
        // Remove thought blocks if any (usually .font-claude-thought or similar)
        // Adjust selector based on inspection
        const thoughts = clone.querySelectorAll('.font-claude-thought, [data-test-id="thought-process"]');
        thoughts.forEach(el => el.remove());
        
        currentText = clone.innerText;

        // Refined generating detection
        // 1. Length changed?
        const lengthChanged = currentText.length > this.lastResponseLength;
        
        // 2. Stop button visible? (Heuristic)
        // Claude usually puts stop button in the input area
        const stopBtn = document.querySelector('button[aria-label="Stop response"]');
        
        // 3. Or just trust our own state if length is growing
        const isGenerating = !!stopBtn || lengthChanged;

        if (isGenerating) {
            this.lastResponseLength = currentText.length;
            this.isGenerating = true;
            this.sendUpdate('generating', currentText);
        } else {
             // If length hasn't changed
             // Check if the "Send" button is visible/enabled?
             // If Send button is visible, we are likely done.
             const sendBtn = document.querySelector(this.getSendBtnSelector());
             const isSendVisible = sendBtn && !sendBtn.disabled;
             
             if (this.isGenerating && isSendVisible) {
                 this.isGenerating = false;
                 this.sendUpdate('idle', currentText);
             } else if (this.isGenerating) {
                 // Still generating but no new text this tick?
                 // Just update status
                 this.sendUpdate('generating', currentText);
             }
        }
    }
}

new ClaudeAdapter();
