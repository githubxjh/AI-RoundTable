
class DoubaoAdapter extends AdapterBase {
    constructor() {
        super('Doubao');
        this.previousContent = '';
        this.lastSentContent = '';
        this.expectingNewMessage = false;
    }

    getInputSelector() {
        return 'textarea[data-testid="chat_input_input"], textarea[placeholder*="发消息"]';
    }

    getSendBtnSelector() {
        return 'button[data-testid="chat_input_send"], [data-testid="chat_input_send"] button, button[aria-label*="发送"], button[type="submit"]';
    }

    async handleInput(text) {
        const inputSelector = this.getInputSelector();
        const inputEl = await this.waitForElement(inputSelector);
        if (!inputEl) throw new Error(`Input element not found: ${inputSelector}`);

        this.simulateUserInput(inputEl, text);

        setTimeout(() => {
            const el = document.querySelector(inputSelector);
            if (el) {
                el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
                el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
                el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
            }
            this.onSendPostProcessing();
        }, 300);
    }

    onSendPostProcessing() {
        this.previousContent = this.getLastAssistantText();
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.expectingNewMessage = true;
        this.sendUpdate('generating', 'Waiting for response...');
    }

    getLastAssistantText() {
        const nodes = document.querySelectorAll('[data-testid="receive_message"] [data-testid="message_text_content"]');
        if (nodes.length === 0) return '';
        return (nodes[nodes.length - 1].innerText || '').trim();
    }

    checkForNewResponse() {
        const currentText = this.getLastAssistantText();
        if (!currentText) return;

        if (this.expectingNewMessage) {
            if (currentText === this.previousContent) return;

            this.expectingNewMessage = false;
            this.isGenerating = false;
            this.lastSentContent = currentText;
            this.sendUpdate('idle', currentText);
            return;
        }

        if (currentText !== this.lastSentContent) {
            this.lastSentContent = currentText;
            this.sendUpdate('idle', currentText);
        }
    }
}

new DoubaoAdapter();

