class GrokAdapter extends AdapterBase {
    constructor() {
        super('Grok');
        this.lastPrompt = '';
        this.previousContent = '';
        this.stableText = '';
        this.stableTicks = 0;
        this.lastGeneratingSummary = '';
        this.lastBlockedReason = '';
        this.stopSeen = false;
        this.stopGoneSince = 0;
        this.responseWatchStartedAt = 0;
        this.lastStableTickAt = 0;
        this.stabilityPollMs = 500;
        this.requiredStableTicks = 3;
        this.stopStabilizeMs = 1500;
        this.minIdleChars = 80;
        this.reviewTagWaitMaxMs = 12000;
    }

    async handleInput(text) {
        this.lastPrompt = String(text || '');

        const inputSelector = this.getInputSelector();
        const inputEl = await this.waitForElement(inputSelector);
        if (!inputEl) throw new Error(`Input element not found: ${inputSelector}`);

        this.simulateUserInput(inputEl, text);
        await this.delay(700);

        const sendBtn = this.findSendButton();
        let sent = false;
        if (sendBtn) {
            this.simulateClick(sendBtn);
            sent = true;
        } else {
            sent = this.sendByEnter(inputEl);
            if (sent) {
                console.warn('GrokAdapter: send button unavailable, fallback to Enter once');
            }
        }

        if (!sent) {
            throw new Error('GrokAdapter: failed to trigger send');
        }

        this.onSendPostProcessing();
    }

    getInputSelector() {
        return [
            'div.ProseMirror[contenteditable="true"]',
            'div[contenteditable="true"].tiptap',
            'div[contenteditable="true"][data-testid="grokInput"]',
            'div[contenteditable="true"][aria-label*="Grok"]',
            'textarea[placeholder*="Grok"]'
        ].join(', ');
    }

    getSendBtnSelector() {
        return [
            'button[aria-label="Grok"]',
            'button[aria-label*="Send"]',
            'button[data-testid="grokInputSend"]',
            'button[data-testid="pill-button"]',
            'div[role="button"][aria-label="Grok"]',
            'div[role="button"][aria-label*="Send"]'
        ].join(', ');
    }

    getAssistantSelectors() {
        return [
            'div[id^="response-"].items-start .message-bubble',
            'div[id^="response-"].items-start [data-testid="message-bubble"]',
            'div[id^="response-"].items-start .response-content-markdown',
            'div[id^="response-"].items-start .markdown',
            'div[id^="response-"] [data-testid*="assistant"] .message-bubble',
            'div[id^="response-"] [data-testid*="assistant"] .markdown',
            'div[id^="response-"] .message-bubble',
            'div[id^="response-"] .markdown'
        ];
    }

    findSendButton() {
        const selector = this.getSendBtnSelector();
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
        if (node.matches('button, [role="button"]')) return node;
        return node.closest('button, [role="button"]');
    }

    isSendButtonAvailable(node) {
        if (!node) return false;
        if (node.disabled) return false;
        if (String(node.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
        if ((node.getClientRects() || []).length === 0) return false;
        return true;
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

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    isVisible(node) {
        if (!node) return false;
        return (node.getClientRects() || []).length > 0;
    }

    isInteractiveButton(node) {
        if (!node) return false;
        if (node.disabled) return false;
        if (String(node.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
        return this.isVisible(node);
    }

    isGeneratingIndicatorActive() {
        const directSelectors = [
            'button[aria-label="Stop"]',
            'button[aria-label="Stop generating"]',
            'button[aria-label*="Stop"]',
            'button[aria-label*="stop"]',
            'button[aria-label*="\u505c\u6b62"]',
            'button[aria-label*="\u4e2d\u6b62"]',
            'button[data-testid*="stop"]',
            '[role="button"][aria-label*="Stop"]',
            '[role="button"][aria-label*="\u505c\u6b62"]'
        ].join(', ');
        const direct = document.querySelector(directSelectors);
        if (this.isInteractiveButton(direct)) return true;

        const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
        return candidates.some((node) => {
            if (!this.isInteractiveButton(node)) return false;
            const label = [
                String(node.getAttribute('aria-label') || ''),
                String(node.getAttribute('title') || ''),
                String(node.innerText || '')
            ].join(' ').toLowerCase();
            return /(stop|stopping|\u505c\u6b62|\u4e2d\u6b62)/i.test(label);
        });
    }

    getBlindSearchLastText() {
        const allElements = document.querySelectorAll('div, p, span, article, section');
        const start = Math.max(0, allElements.length - 250);
        for (let i = allElements.length - 1; i >= start; i -= 1) {
            const node = allElements[i];
            if (!node || node.isContentEditable) continue;
            const text = String(node.innerText || '').trim();
            if (!text || text.length < 8) continue;
            if (text === this.lastPrompt.trim()) continue;
            if (text.includes('How can Grok help')) continue;
            if (this.isTemplateEchoText(text)) continue;
            return text;
        }
        return '';
    }

    isAssistantContainer(node) {
        if (!node) return false;

        const container = node.closest?.('div[id^="response-"]');
        if (container) {
            const className = String(container.className || '');
            if (className.includes('items-end')) return false;
            if (className.includes('items-start')) return true;

            const containerRole = String(container.getAttribute('data-role') || '').toLowerCase();
            if (containerRole.includes('assistant') || containerRole.includes('model')) return true;
        }

        const selfRole = String(node.getAttribute?.('data-message-author-role') || '').toLowerCase();
        if (selfRole === 'assistant') return true;

        const testId = String(node.getAttribute?.('data-testid') || '').toLowerCase();
        if (testId.includes('assistant') || testId.includes('model')) return true;

        return false;
    }

    isTemplateEchoText(text) {
        const normalized = String(text || '').trim().toLowerCase();
        if (!normalized) return false;
        if (normalized.includes('"reason": "short reason"') && normalized.includes('"evidence": ["point1", "point2"]')) {
            return true;
        }
        if (normalized.includes('json schema') && normalized.includes('<eval_json>{...}</eval_json>')) {
            return true;
        }
        if (
            normalized.includes('\u4f60\u662f\u4e00\u540d\u5ba2\u89c2\u4e2d\u7acb\u7684\u8bc4\u5ba1\u5458')
            && normalized.includes('\u8bf7\u8bc4\u4f30\u4ee5\u4e0b\u533f\u540d\u7b54\u6848')
        ) {
            return true;
        }
        return false;
    }

    acceptCandidateText(text, node = null) {
        const normalized = String(text || '').trim();
        if (!normalized) return false;
        if (this.looksLikePromptEcho(normalized)) return false;
        if (this.isTemplateEchoText(normalized)) return false;

        if (node) {
            const container = node.closest?.('div[id^="response-"]');
            if (container) {
                const className = String(container.className || '');
                if (className.includes('items-end')) return false;
            }
        }

        return true;
    }

    getLastMessageText() {
        for (const selector of this.getAssistantSelectors()) {
            const nodes = Array.from(document.querySelectorAll(selector));
            for (let i = nodes.length - 1; i >= 0; i -= 1) {
                const node = nodes[i];
                if (!this.isAssistantContainer(node)) continue;
                const text = String(node.innerText || '').trim();
                if (!this.acceptCandidateText(text, node)) continue;
                return text;
            }
        }

        const responseContainers = Array.from(document.querySelectorAll('div[id^="response-"]'));
        for (let i = responseContainers.length - 1; i >= 0; i -= 1) {
            const container = responseContainers[i];
            if (!this.isAssistantContainer(container)) continue;
            const text = String(container.innerText || '').trim();
            if (!this.acceptCandidateText(text, container)) continue;
            return text;
        }

        return this.getBlindSearchLastText();
    }

    looksLikePromptEcho(text) {
        const prompt = this.lastPrompt.trim();
        if (!prompt) return false;
        const normalized = String(text || '').trim();
        if (!normalized) return false;
        if (normalized === prompt) return true;
        if (normalized.startsWith(prompt) && normalized.length <= prompt.length + 80) return true;
        return false;
    }

    onSendPostProcessing() {
        this.previousContent = this.getLastMessageText();
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.expectingNewMessage = true;
        this.stableText = '';
        this.stableTicks = 0;
        this.lastGeneratingSummary = '';
        this.lastBlockedReason = '';
        this.stopSeen = false;
        this.stopGoneSince = 0;
        this.responseWatchStartedAt = Date.now();
        this.lastStableTickAt = Date.now();
        this.sendUpdate('generating', 'Waiting for response...');
    }

    emitGeneratingBlock(summary, reason, extra = {}) {
        const nextSummary = summary || 'Generating...';
        if (!this.isGenerating || nextSummary !== this.lastGeneratingSummary || reason !== this.lastBlockedReason) {
            this.sendUpdate('generating', nextSummary);
            this.lastGeneratingSummary = nextSummary;
            this.lastBlockedReason = reason;
            console.log('GrokAdapter idle blocked', {
                model: this.modelName,
                requestId: this.currentRequestId || null,
                reason,
                summaryChars: nextSummary.length,
                stableTicks: this.stableTicks,
                stopSeen: this.stopSeen,
                ...extra
            });
        }
        this.isGenerating = true;
    }

    containsEvalClosingTag(text) {
        return /<\/EVAL_JSON>/i.test(String(text || ''));
    }

    checkForNewResponse() {
        const now = Date.now();
        const currentText = this.getLastMessageText();
        const isGenerating = this.isGeneratingIndicatorActive();

        if (isGenerating) {
            const summary = currentText || 'Generating...';
            this.expectingNewMessage = false;
            this.stableText = '';
            this.stableTicks = 0;
            this.lastStableTickAt = now;
            this.stopSeen = true;
            this.stopGoneSince = 0;
            this.lastBlockedReason = '';
            if (!this.isGenerating || summary !== this.lastGeneratingSummary) {
                this.sendUpdate('generating', summary);
                this.lastGeneratingSummary = summary;
            }
            this.isGenerating = true;
            if (currentText) {
                this.lastSentContent = currentText;
            }
            return;
        }

        if (this.stopSeen && !this.stopGoneSince) {
            this.stopGoneSince = now;
        }

        this.lastGeneratingSummary = '';
        if (!currentText.trim()) return;
        if (!this.acceptCandidateText(currentText)) return;

        if (this.expectingNewMessage) {
            if (currentText === this.previousContent) return;
            this.expectingNewMessage = false;
        }

        if (currentText !== this.stableText) {
            this.stableText = currentText;
            this.stableTicks = 1;
            this.lastStableTickAt = now;
            this.emitGeneratingBlock(currentText, 'not_stable');
            return;
        }

        if (now - this.lastStableTickAt < this.stabilityPollMs) return;
        this.lastStableTickAt = now;

        this.stableTicks += 1;
        if (this.stableTicks < this.requiredStableTicks) {
            this.emitGeneratingBlock(currentText, 'not_stable');
            return;
        }

        const isReviewMode = this.currentMode === 'review';
        const elapsedSinceWatchStart = now - this.responseWatchStartedAt;
        if (isReviewMode && !this.stopSeen && elapsedSinceWatchStart < this.reviewTagWaitMaxMs) {
            this.emitGeneratingBlock(currentText, 'stop_not_seen', { elapsedSinceWatchStart });
            return;
        }

        if (this.stopSeen) {
            const stopGoneMs = now - this.stopGoneSince;
            if (stopGoneMs < this.stopStabilizeMs) {
                this.emitGeneratingBlock(currentText, 'stop_not_stable', { stopGoneMs });
                return;
            }
        }

        if (isReviewMode && currentText.length < this.minIdleChars && elapsedSinceWatchStart < this.reviewTagWaitMaxMs) {
            this.emitGeneratingBlock(currentText, 'short_text', { elapsedSinceWatchStart });
            return;
        }

        const hasClosingTag = this.containsEvalClosingTag(currentText);
        if (isReviewMode && !hasClosingTag && elapsedSinceWatchStart < this.reviewTagWaitMaxMs) {
            this.emitGeneratingBlock(currentText, 'no_closing_tag', { elapsedSinceWatchStart });
            return;
        }

        if (currentText === this.lastSentContent && !this.isGenerating) return;

        this.isGenerating = false;
        this.lastBlockedReason = '';
        this.lastSentContent = currentText;
        console.log('GrokAdapter finalize idle', {
            model: this.modelName,
            requestId: this.currentRequestId || null,
            summaryChars: currentText.length,
            stableTicks: this.stableTicks,
            stopSeen: this.stopSeen,
            mode: this.currentMode || 'normal'
        });
        this.sendUpdate('idle', currentText);
    }
}

new GrokAdapter();
