
class AdapterBase {
    constructor(modelName) {
        this.modelName = modelName;
        this.observer = null;
        this.lastResponseLength = 0;
        this.isGenerating = false;
        this.currentRequestId = null;
        this.currentMode = 'normal';
        
        // Rate limiting state
        this._rate = { mode: 'throttle', interval: 300, leading: true, trailing: true };
        this._lastSentAt = 0;
        this._lastPayload = null;
        this._pendingPayload = null;
        this._sendTimer = null;

        this.init();
    }

    init() {
        console.log(`AI RoundTable: ${this.modelName} Adapter Initialized`);

        // Listen for messages from Background
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log(`[${this.modelName}] Received message:`, message);
            
            if (message.type === 'INPUT_PROMPT') {
                this.currentRequestId = message.requestId || null;
                this.currentMode = message.mode || 'normal';
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
                this.simulateClick(sendBtn);
                this.onSendPostProcessing();
            } else {
                console.warn("Send button not found:", sendBtnSelector);
                // Fallback: If send button is missing but we entered text, maybe try pressing Enter?
                // This is risky if Enter makes new line, but for chat apps it usually sends.
                // Let's rely on subclasses to implement specific Enter key logic if needed (like Gemini/Grok already do)
            }
        }, 800);
    }

    simulateClick(element) {
        const events = ['mousedown', 'mouseup', 'click'];
        events.forEach(eventType => {
            const event = new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window
            });
            element.dispatchEvent(event);
        });
    }

    simulateUserInput(element, text) {
        // Focus first
        element.focus();

        if (element.contentEditable === 'true' || element.getAttribute('contenteditable') === 'true') {
            // Handle contenteditable (like Claude, Gemini, Grok)
            // Ensure focus
            element.focus();
            
            // Clear existing content safely
            element.innerHTML = '';
            
            // Dispatch input event for clearing
            element.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Insert text using execCommand - this is crucial for Gemini/Angular/Draft.js
            // Try/Catch for execCommand as it might throw in some contexts
            let execCommandSuccess = false;
            try {
                if (document.queryCommandSupported('insertText')) {
                    // execCommand requires the element to be focused and the selection to be inside it
                    const selection = window.getSelection();
                    const range = document.createRange();
                    
                    if (element.childNodes.length > 0) {
                        range.selectNodeContents(element);
                    } else {
                        // Empty element, just set cursor inside
                        range.setStart(element, 0);
                        range.setEnd(element, 0);
                    }
                    
                    range.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    
                    execCommandSuccess = document.execCommand('insertText', false, text);
                    console.log(`[AdapterBase] execCommand('insertText') success: ${execCommandSuccess}`);
                }
            } catch (e) {
                console.warn("[AdapterBase] execCommand failed:", e);
            }
            
            if (!execCommandSuccess) {
                // Fallback 1: TextContent + Events (standard fallback)
                console.log("[AdapterBase] Using Fallback 1: innerText");
                element.innerText = text;
                
                // Fallback 2: For really stubborn editors (like Tiptap/ProseMirror sometimes), 
                // we might need to manually create a text node and insert it.
                if (element.innerText !== text) {
                     console.log("[AdapterBase] Using Fallback 2: TextNode injection");
                     element.appendChild(document.createTextNode(text));
                }
            }
            
            // Dispatch standard events
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('compositionend', { bubbles: true }));
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

    /**
     * Configure rate limiting options for sendUpdate
     * @param {Object} options
     * @param {'throttle'|'debounce'|'none'} [options.mode='throttle']
     * @param {number} [options.interval=300] - Interval in ms
     * @param {boolean} [options.leading=true] - Send on leading edge (throttle only)
     * @param {boolean} [options.trailing=true] - Send on trailing edge
     */
    configureUpdateRate(options = {}) {
        this._rate = { ...this._rate, ...options };
    }

    sendUpdate(status, summary, extra = {}) {
        const requestId = Object.prototype.hasOwnProperty.call(extra, 'requestId')
            ? extra.requestId
            : this.currentRequestId;
        const mode = Object.prototype.hasOwnProperty.call(extra, 'mode')
            ? extra.mode
            : this.currentMode;

        const payload = {
            type: 'STATUS_UPDATE',
            model: this.modelName,
            status: status, // 'idle' | 'generating'
            summary: summary,
            requestId: requestId || undefined,
            mode: mode || 'normal'
        };

        // Guarantee final state delivery immediately
        if (status === 'idle') {
            this._actuallySend(payload);
            this._clearRateTimer();
            return;
        }

        // Lightweight deduplication
        if (this._isSamePayload(this._lastPayload, payload)) {
            // Even if same, we schedule it for trailing to ensure the timestamp/keep-alive 
            // is handled if needed, or just to debounce high frequency same-updates.
            this._scheduleTrailing(payload);
            return;
        }

        if (this._rate.mode === 'none') {
            this._actuallySend(payload);
            return;
        }

        const now = Date.now();
        const elapsed = now - this._lastSentAt;
        const wait = Math.max(this._rate.interval - elapsed, 0);

        if (this._rate.mode === 'debounce') {
            this._pendingPayload = payload;
            clearTimeout(this._sendTimer);
            this._sendTimer = setTimeout(() => this._flushPending(), this._rate.interval);
            return;
        }

        // throttle (leading + trailing)
        if (elapsed >= this._rate.interval) {
            if (this._rate.leading) {
                this._actuallySend(payload);
            } else {
                this._scheduleTrailing(payload, wait);
            }
        } else {
            this._scheduleTrailing(payload, wait);
        }
    }

    _isSamePayload(a, b) {
        if (!a || !b) return false;
        return a.status === b.status && 
               a.summary === b.summary && 
               a.mode === b.mode && 
               a.requestId === b.requestId && 
               a.model === b.model;
    }

    _scheduleTrailing(payload, wait = this._rate.interval) {
        this._pendingPayload = payload;
        if (!this._sendTimer && this._rate.trailing) {
            this._sendTimer = setTimeout(() => this._flushPending(), wait);
        }
    }

    _flushPending() {
        if (this._pendingPayload) {
            // Deduplication check at flush time: 
            // if what we are about to send is exactly what we last sent, drop it.
            if (this._isSamePayload(this._pendingPayload, this._lastPayload)) {
                this._pendingPayload = null;
            } else {
                this._actuallySend(this._pendingPayload);
                this._pendingPayload = null;
            }
        }
        this._clearRateTimer();
    }

    _clearRateTimer() {
        clearTimeout(this._sendTimer);
        this._sendTimer = null;
    }

    _actuallySend(payload) {
        this._lastSentAt = Date.now();
        this._lastPayload = payload;
        chrome.runtime.sendMessage(payload).catch(e => {});
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
