
class AdapterBase {
    constructor(modelName) {
        this.modelName = modelName;
        this.observer = null;
        this.lastResponseLength = 0;
        this.isGenerating = false;
        this.currentRequestId = null;
        this.currentMode = 'normal';
        this._sendConfirmTimeoutMs = 3500;
        this._sendConfirmPollMs = 150;
        this._attachmentReadyTimeoutMs = 12000;
        this._responseWatchdogTimer = null;
        this._responseWatchdogIntervalMs = 600;
        this._responseWatchdogMaxMs = 120000;
        this._responseWatchdogStartedAt = 0;
        
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
                this.handlePrompt({
                    text: message.text,
                    attachments: message.attachments
                })
                    .then((result) => sendResponse(result || { status: 'input_simulated' }))
                    .catch(err => {
                        console.error('Input Error:', err);
                        const code = String(err?.code || '').trim();
                        if (code.startsWith('attachment_')) {
                            sendResponse({
                                status: 'skipped_unsupported_attachment',
                                code,
                                message: err?.message || 'Attachment upload is unsupported'
                            });
                            return;
                        }
                        sendResponse({
                            status: 'error',
                            code: code || 'input_failed',
                            message: err?.message || err?.toString?.() || 'Input failed'
                        });
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
        await this.delay(800);

        const sendBtn = this.findSendButton();
        let sent = false;
        if (sendBtn) {
            console.log('Clicking send button...');
            this.simulateClick(sendBtn);
            sent = true;
        } else {
            sent = this.sendByEnter(inputEl);
            if (sent) {
                console.warn('Send button unavailable, fallback to Enter once');
            }
        }

        if (!sent) {
            throw new Error('Failed to trigger send');
        }

        return {
            inputEl,
            text,
            sendButtonBefore: sendBtn
        };
    }

    async handlePrompt(payload = {}) {
        const text = String(payload?.text || '');
        const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];

        this._hasAttachments = attachments.length > 0;

        if (this._hasAttachments) {
            await this.attachFiles(attachments);
        }

        const dispatchState = await this.handleInput(text);
        if (!dispatchState?.skipConfirm) {
            await this.confirmSendTriggered(dispatchState || { inputEl: null, text });
            this.onSendPostProcessing();
            this.armResponseWatchdog();
        }
        return { status: 'input_simulated' };
    }

    async attachFiles(attachments) {
        const diag = { steps: [], fileCount: attachments.length, startTime: Date.now() };
        try {
            diag.steps.push('open_ui_start');
            await this.openAttachmentUIIfNeeded();
            diag.steps.push('open_ui_done');

            diag.steps.push('find_input_start');
            const inputEl = await this.findAttachmentInput();
            if (!inputEl) {
                this._logDiag('attachFiles', { ...diag, error: 'input_not_found' });
                throw this.createAttachmentError(
                    'attachment_input_not_found',
                    'File input was not found on this model page'
                );
            }
            diag.steps.push('find_input_done');
            diag.inputSelector = this.getAttachmentInputSelector();
            diag.inputVisible = this.isElementVisible(inputEl);

            const files = attachments.map((item) => this.decodeBase64ToFile(item));
            if (files.length === 0) {
                this._logDiag('attachFiles', { ...diag, error: 'no_valid_files' });
                throw this.createAttachmentError('attachment_upload_failed', 'No valid attachments to upload');
            }
            diag.fileNames = files.map((f) => f.name);

            diag.steps.push('set_files_start');
            await this.setInputFiles(inputEl, files);
            diag.steps.push('set_files_done');
            diag.filesAccepted = Number(inputEl?.files?.length || 0);

            diag.steps.push('wait_ready_start');
            await this.waitAttachmentReady(inputEl, files);
            diag.steps.push('wait_ready_done');
            diag.totalMs = Date.now() - diag.startTime;
            this._logDiag('attachFiles', diag);
        } catch (error) {
            diag.steps.push('error');
            diag.error = error?.message || String(error);
            diag.code = error?.code || 'unknown';
            diag.totalMs = Date.now() - diag.startTime;
            this._logDiag('attachFiles', diag);
            if (String(error?.code || '').startsWith('attachment_')) {
                throw error;
            }
            throw this.createAttachmentError(
                'attachment_upload_failed',
                error?.message || 'Attachment upload failed'
            );
        }
    }

    _logDiag(step, data = {}) {
        const entry = {
            ts: Date.now(),
            model: this.modelName,
            step,
            ...data
        };
        console.log(`[AIRoundTable|${this.modelName}|${step}]`, JSON.stringify(entry));
        try {
            chrome.storage.local.get('rt_attachment_diag', (result) => {
                const diags = result?.rt_attachment_diag || [];
                diags.push(entry);
                if (diags.length > 80) diags.splice(0, diags.length - 80);
                chrome.storage.local.set({ rt_attachment_diag: diags });
            });
        } catch (e) { /* storage unavailable */ }
    }

    createAttachmentError(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    decodeBase64ToFile(attachment) {
        const name = String(attachment?.name || 'attachment.bin');
        const mimeType = String(attachment?.mimeType || 'application/octet-stream');
        const base64 = String(attachment?.base64 || '').trim();

        if (!base64) {
            throw this.createAttachmentError('attachment_upload_failed', `Attachment payload is empty: ${name}`);
        }

        let binary;
        try {
            binary = atob(base64);
        } catch (error) {
            throw this.createAttachmentError('attachment_upload_failed', `Attachment payload decode failed: ${name}`);
        }

        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }

        return new File([bytes], name, { type: mimeType || 'application/octet-stream' });
    }

    async openAttachmentUIIfNeeded() {
        // Optional override in subclasses when a click is required before <input type="file"> appears.
    }

    getAttachmentInputSelector() {
        return 'input[type="file"]';
    }

    async findAttachmentInput() {
        const selector = this.getAttachmentInputSelector();
        if (!selector) return null;
        return this.waitForElement(selector, 4000);
    }

    async setInputFiles(inputEl, files) {
        if (!inputEl) {
            throw this.createAttachmentError('attachment_input_not_found', 'File input is missing');
        }

        if (!inputEl.multiple && files.length > 1) {
            throw this.createAttachmentError(
                'attachment_type_rejected',
                'Model input does not allow multiple files'
            );
        }

        const transfer = new DataTransfer();
        files.forEach((file) => transfer.items.add(file));
        inputEl.files = transfer.files;

        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async waitAttachmentReady(inputEl, files) {
        const expected = inputEl?.multiple ? files.length : Math.min(files.length, 1);
        const accepted = await this.waitForExpectedFiles(inputEl, expected, 3000);
        if (!accepted) {
            throw this.createAttachmentError(
                'attachment_upload_failed',
                `Attachment files not accepted by input (0/${expected})`
            );
        }

        const busySelectors = this.getAttachmentBusySelectors();
        const readySelectors = this.getAttachmentReadySelectors();

        if (busySelectors.length > 0 || readySelectors.length > 0) {
            return this._waitAttachmentBySelectors(inputEl, expected, busySelectors, readySelectors);
        }

        return this._waitAttachmentGeneric(inputEl, expected);
    }

    async _waitAttachmentBySelectors(inputEl, expected, busySelectors, readySelectors) {
        const deadline = Date.now() + this._attachmentReadyTimeoutMs;

        while (Date.now() < deadline) {
            const currentAccepted = Number(inputEl?.files?.length || 0);
            if (currentAccepted < expected) {
                throw this.createAttachmentError(
                    'attachment_upload_failed',
                    `Attachment files were rejected by model input (${currentAccepted}/${expected})`
                );
            }

            const busy = this.hasAnySelector(busySelectors);
            const ready = readySelectors.length === 0 ? true : this.hasAnySelector(readySelectors);

            if (!busy && ready) {
                const sendBtn = this.findSendButton();
                if (sendBtn && !this.isSendButtonAvailable(sendBtn)) {
                    continue;
                }
                return;
            }

            await this.delay(200);
        }

        throw this.createAttachmentError(
            'attachment_upload_failed',
            'Attachment upload did not become ready in time'
        );
    }

    async _waitAttachmentGeneric(inputEl, expected) {
        const deadline = Date.now() + this._attachmentReadyTimeoutMs;
        let sendBtnWasDisabled = false;
        let pollCount = 0;

        while (Date.now() < deadline) {
            pollCount += 1;
            const currentAccepted = Number(inputEl?.files?.length || 0);
            if (currentAccepted < expected) {
                throw this.createAttachmentError(
                    'attachment_upload_failed',
                    `Attachment files were rejected by model input (${currentAccepted}/${expected})`
                );
            }

            const sendBtn = this.findSendButton();

            if (sendBtn) {
                const available = this.isSendButtonAvailable(sendBtn);
                if (!available) {
                    sendBtnWasDisabled = true;
                } else if (sendBtnWasDisabled) {
                    await this.delay(300);
                    return;
                }
            }

            if (pollCount >= 3 && this._detectGenericFilePreview()) {
                if (!sendBtn || this.isSendButtonAvailable(sendBtn)) {
                    await this.delay(300);
                    return;
                }
            }

            await this.delay(300);
        }

        const finalSendBtn = this.findSendButton();
        if (finalSendBtn && this.isSendButtonAvailable(finalSendBtn)) {
            await this.delay(500);
            return;
        }

        throw this.createAttachmentError(
            'attachment_upload_failed',
            'Attachment upload did not become ready in time'
        );
    }

    _detectGenericFilePreview() {
        const candidates = document.querySelectorAll([
            '[class*="file-preview"]',
            '[class*="attachment-preview"]',
            '[class*="preview-thumb"]',
            '[class*="upload-file"]',
            '[class*="file-item"]',
            '[class*="file-tile"]',
            'img[src^="blob:"]',
            'img[src^="data:"]'
        ].join(', '));

        for (const el of candidates) {
            if (!this.isElementVisible(el)) continue;
            if (el.tagName === 'BUTTON' || el.closest('button')) continue;
            if (el.tagName === 'INPUT') continue;
            return true;
        }
        return false;
    }

    async waitForExpectedFiles(inputEl, expected, timeoutMs = 3000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const actual = Number(inputEl?.files?.length || 0);
            if (actual >= expected) return true;
            await this.delay(120);
        }
        return Number(inputEl?.files?.length || 0) >= expected;
    }

    hasAnySelector(selectors = []) {
        for (const selector of selectors) {
            try {
                const nodes = Array.from(document.querySelectorAll(selector));
                if (nodes.length === 0) continue;
                if (nodes.some((node) => this.isElementVisible(node))) {
                    return true;
                }
            } catch (error) {
                // Ignore invalid selectors from site drift and continue checking others.
            }
        }
        return false;
    }

    isElementVisible(node) {
        if (!node) return false;
        const rects = node.getClientRects?.() || [];
        if (rects.length > 0) return true;
        const style = window.getComputedStyle?.(node);
        if (!style) return false;
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    getAttachmentBusySelectors() {
        return [];
    }

    getAttachmentReadySelectors() {
        return [];
    }

    async confirmSendTriggered(state = {}) {
        const inputEl = state?.inputEl || null;
        const text = String(state?.text || '');
        const sendButtonBefore = state?.sendButtonBefore || null;
        const timeoutMs = this._hasAttachments ? Math.max(this._sendConfirmTimeoutMs, 8000) : this._sendConfirmTimeoutMs;
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            if (this.isGeneratingIndicatorActiveSafe()) {
                return true;
            }

            if (this.hasInputBeenSubmitted(inputEl, text)) {
                return true;
            }

            if (this.wasSendButtonLocked(sendButtonBefore)) {
                return true;
            }

            await this.delay(this._sendConfirmPollMs);
        }

        const err = new Error('Send was not confirmed within safe window');
        err.code = 'send_not_confirmed';
        throw err;
    }

    async waitForAvailableSendButton(timeoutMs = 3000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const btn = this.findSendButton();
            if (btn) return btn;
            await this.delay(120);
        }
        return this.findSendButton();
    }

    isGeneratingIndicatorActiveSafe() {
        try {
            return Boolean(this.isGeneratingIndicatorActive());
        } catch (error) {
            return false;
        }
    }

    hasInputBeenSubmitted(inputEl, expectedText) {
        if (!inputEl) return false;

        const expected = this.normalizeComparableText(expectedText);
        if (!expected) return false;

        const current = this.normalizeComparableText(this.readInputText(inputEl));
        if (!current) return true;
        if (current === expected) return false;
        if (current.length <= Math.max(4, Math.floor(expected.length * 0.35))) return true;
        if (!current.includes(expected) && !expected.includes(current)) return true;
        return false;
    }

    wasSendButtonLocked(sendButtonBefore) {
        if (!sendButtonBefore) return false;
        if (!this.isSendButtonAvailable(sendButtonBefore)) return true;
        const latest = this.findSendButton();
        if (!latest) return true;
        return false;
    }

    readInputText(inputEl) {
        if (!inputEl) return '';
        const isEditable = inputEl.contentEditable === 'true' || inputEl.getAttribute('contenteditable') === 'true';
        if (isEditable) {
            return String(inputEl.innerText || inputEl.textContent || '');
        }
        if (Object.prototype.hasOwnProperty.call(inputEl, 'value')) {
            return String(inputEl.value || '');
        }
        return String(inputEl.innerText || inputEl.textContent || '');
    }

    normalizeComparableText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    armResponseWatchdog() {
        this.disarmResponseWatchdog();
        this._responseWatchdogStartedAt = Date.now();

        const tick = () => {
            this._responseWatchdogTimer = null;

            if (!this.shouldKeepResponseWatchdogRunning()) {
                this.disarmResponseWatchdog();
                return;
            }

            if (Date.now() - this._responseWatchdogStartedAt > this._responseWatchdogMaxMs) {
                console.warn(`[${this.modelName}] response watchdog timed out after ${this._responseWatchdogMaxMs}ms`);
                this.disarmResponseWatchdog();
                return;
            }

            try {
                this.checkForNewResponse();
            } catch (error) {
                console.warn(`[${this.modelName}] response watchdog check failed`, error);
            }

            if (!this.shouldKeepResponseWatchdogRunning()) {
                this.disarmResponseWatchdog();
                return;
            }

            this._responseWatchdogTimer = setTimeout(tick, this._responseWatchdogIntervalMs);
        };

        this._responseWatchdogTimer = setTimeout(tick, this._responseWatchdogIntervalMs);
    }

    disarmResponseWatchdog() {
        clearTimeout(this._responseWatchdogTimer);
        this._responseWatchdogTimer = null;
        this._responseWatchdogStartedAt = 0;
    }

    shouldKeepResponseWatchdogRunning() {
        return Boolean(this.isGenerating || this.expectingNewMessage);
    }

    findSendButton() {
        const selector = this.getSendBtnSelector();
        if (!selector) return null;
        const candidates = Array.from(document.querySelectorAll(selector));
        for (const node of candidates) {
            const target = this.resolveClickableTarget(node);
            if (target && this.isSendButtonAvailable(target)) {
                return target;
            }
        }
        return null;
    }

    resolveClickableTarget(node) {
        if (!node) return null;
        if (node.matches?.('button, [role="button"]')) return node;
        return node.closest?.('button, [role="button"]') || null;
    }

    isSendButtonAvailable(node) {
        if (!node) return false;
        if (node.disabled) return false;
        if (String(node.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
        return (node.getClientRects?.() || []).length > 0;
    }

    sendByEnter(inputEl) {
        if (!inputEl) return false;
        inputEl.focus();
        const eventInit = {
            key: 'Enter',
            code: 'Enter',
            which: 13,
            keyCode: 13,
            bubbles: true,
            cancelable: true
        };
        inputEl.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        inputEl.dispatchEvent(new KeyboardEvent('keypress', eventInit));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', eventInit));
        return true;
    }

    isGeneratingIndicatorActive() {
        return false;
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
        
        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: [
                'aria-busy',
                'aria-disabled',
                'aria-hidden',
                'aria-label',
                'class',
                'data-testid',
                'disabled',
                'hidden',
                'style',
                'title'
            ]
        });
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

        if (status === 'generating' && !this._responseWatchdogTimer) {
            this.armResponseWatchdog();
        }

        // Guarantee final state delivery immediately
        if (status === 'idle') {
            this.disarmResponseWatchdog();
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
