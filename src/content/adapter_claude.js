
class ClaudeAdapter extends AdapterBase {
    constructor() {
        super('Claude');
    }

    getInputSelector() {
        return 'div[contenteditable="true"].ProseMirror'; 
    }

    getSendBtnSelector() {
        return 'button[aria-label*="Send"], button[aria-label*="send"], div[contenteditable="true"] ~ div button';
    }

    onSendPostProcessing() {
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.sendUpdate('generating', 'Waiting for response...');
    }

    checkForNewResponse() {
        const messageSelector = '.font-claude-message, [data-test-id="chat-message-content"], div[data-is-streaming="true"]';
        const messages = document.querySelectorAll(messageSelector);
        
        if (messages.length === 0) return;
        
        const lastMessage = messages[messages.length - 1];
        
        // Clone and clean
        const clone = lastMessage.cloneNode(true);
        
        // 1. Standard "font-claude-thought" removal (already here)
        const standardThoughts = clone.querySelectorAll('.font-claude-thought, [data-test-id="thought-process"], .thinking-process, [aria-label="Thinking Process"]');
        standardThoughts.forEach(el => el.remove());

        // 2. NEW: Structure-based removal for unlabelled thoughts
        // Based on logs, the thought block is inside a flex container with a "button" toggle
        // Structure: <div class="... flex flex-col ..."><button class="group/row ...">...思考如何...</button>...</div>
        // It often contains text "思考如何" or English "Thinking" inside a button or span
        
        const potentialThoughts = clone.querySelectorAll('div > button.group\\/row');
        potentialThoughts.forEach(btn => {
            // Find the parent container of this button (which is the thought block wrapper)
            // The logs show the wrapper is the direct parent of the button
            const wrapper = btn.parentElement;
            if (wrapper && wrapper.tagName === 'DIV') {
                // Double check it's likely a thought block
                // Check if button text indicates thinking
                if (btn.innerText.includes('思考') || btn.innerText.includes('Thinking') || btn.innerText.includes('Thought')) {
                    wrapper.remove();
                } else {
                    // Even if text doesn't match, the structure (button group/row inside message) is highly specific to the thought toggle
                    // Let's remove it to be safe, as standard messages don't have this toggle button at the top
                    wrapper.remove();
                }
            }
        });

        let currentText = clone.innerText;

        // Force remove "Thinking Process" text block if it leaked through
        if (currentText.includes('Thinking Process:')) {
            const parts = currentText.split('Thinking Process:');
            // Keep the part AFTER the thinking process if possible, but it's hard to know where it ends.
            // Usually the thinking process is at the start. 
            // If we split, we might lose context. 
            // Better rely on DOM removal above.
        }

        // Generating detection logic...
        const lengthChanged = currentText.length > this.lastResponseLength;
        const stopBtn = document.querySelector('button[aria-label="Stop response"]');
        const isGenerating = !!stopBtn || lengthChanged;

        if (isGenerating) {
            this.lastResponseLength = currentText.length;
            this.isGenerating = true;
            this.sendUpdate('generating', currentText);
        } else {
             const sendBtn = document.querySelector(this.getSendBtnSelector());
             const isSendVisible = sendBtn && !sendBtn.disabled;
             
             if (this.isGenerating && isSendVisible) {
                 this.isGenerating = false;
                 this.sendUpdate('idle', currentText);
             } else if (this.isGenerating) {
                 this.sendUpdate('generating', currentText);
             }
        }
    }
}

new ClaudeAdapter();
