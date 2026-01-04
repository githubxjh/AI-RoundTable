
class AdapterBase {
    constructor(modelName) {
        this.modelName = modelName;
        this.observer = null;
        this.lastResponseLength = 0;
        this.isGenerating = false;
        
        this.init();
    }

    init() {
        console.log(`AI RoundTable: ${this.modelName} Adapter Initialized`);

        // Listen for messages from Background
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log(`[${this.modelName}] Received message:`, message);
            
            if (message.type === 'INPUT_PROMPT') {
                this.handleInput(message.text)
                    .then(() => sendResponse({ status: 'input_simulated' }))
                    .catch(err => {
                        console.error('Input Error:', err);
                        sendResponse({ status: 'error', message: err.toString() });
                    });
                return true; // async response
            }
        });

        // Start observing DOM for responses
        this.startObservation();
    }

    async handleInput(text) {
        const inputSelector = this.getInputSelector();
        console.log(`Waiting for input: ${inputSelector}`);
        
        const inputEl = await this.waitForElement(inputSelector);
        if (!inputEl) throw new Error(`Input element not found: ${inputSelector}`);

        console.log("Setting input value...");
        this.simulateUserInput(inputEl, text);
        
        // Wait a bit then click send
        setTimeout(async () => {
            const sendBtnSelector = this.getSendBtnSelector();
            const sendBtn = document.querySelector(sendBtnSelector);
            if (sendBtn) {
                console.log("Clicking send button...");
                sendBtn.click();
                this.onSendPostProcessing();
            } else {
                console.warn("Send button not found:", sendBtnSelector);
            }
        }, 800);
    }

    simulateUserInput(element, text) {
        // Focus first
        element.focus();

        if (element.contentEditable === 'true' || element.getAttribute('contenteditable') === 'true') {
            // Handle contenteditable (like Claude)
            element.innerHTML = ''; // Clear first
            element.textContent = text; // Or insert text node
            
            const inputEvent = new Event('input', { bubbles: true });
            element.dispatchEvent(inputEvent);
        } else {
            // React 16+ Input Value Setter Hack for Textarea
            // This bypasses the React wrapper to set the native value
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            nativeInputValueSetter.call(element, text);

            // Dispatch events that React listens to
            const inputEvent = new Event('input', { bubbles: true });
            element.dispatchEvent(inputEvent);
            
            const changeEvent = new Event('change', { bubbles: true });
            element.dispatchEvent(changeEvent);
        }
    }

    startObservation() {
        if (this.observer) this.observer.disconnect();

        this.observer = new MutationObserver((mutations) => {
            this.checkForNewResponse();
        });
        
        this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    checkForNewResponse() {
        // Abstract method - to be implemented by subclasses
        // Should detect if generating, extract text, and call this.sendUpdate()
    }

    sendUpdate(status, summary) {
        // Debounce or throttle could be added here
        chrome.runtime.sendMessage({
            type: 'STATUS_UPDATE',
            model: this.modelName,
            status: status, // 'idle' | 'generating'
            summary: summary
        }).catch(e => {}); // Ignore errors if popup is closed
    }

    // Methods to be overridden
    getInputSelector() { return 'textarea'; }
    getSendBtnSelector() { return 'button'; }
    onSendPostProcessing() {}
    
    waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(selector)) {
                return resolve(document.querySelector(selector));
            }

            const observer = new MutationObserver(mutations => {
                if (document.querySelector(selector)) {
                    observer.disconnect();
                    resolve(document.querySelector(selector));
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                // reject(new Error(`Timeout waiting for ${selector}`));
                // Don't reject, just return null to avoid crashing everything, let caller handle
                console.warn(`Timeout waiting for ${selector}`);
                resolve(null);
            }, timeout);
        });
    }
}

// Export for other scripts to extend
window.AdapterBase = AdapterBase;
