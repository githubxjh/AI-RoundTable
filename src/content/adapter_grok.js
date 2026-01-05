
class GrokAdapter extends AdapterBase {
    constructor() {
        super('Grok');
        this.lastPrompt = '';
        this.previousContent = '';
        this.debugMode = true; // Enable debug mode to inspect Grok DOM
    }

    async handleInput(text) {
        if (this.debugMode) console.log("GrokAdapter: handleInput called");
        this.lastPrompt = text; 

        try {
            await super.handleInput(text);
        } catch (e) {
            console.error("GrokAdapter: Base handleInput failed", e);
        }

        // Grok Enter key fallback
        setTimeout(() => {
            const inputSelector = this.getInputSelector();
            const inputEl = document.querySelector(inputSelector);
            if (inputEl) {
                if (this.debugMode) console.log("GrokAdapter: Dispatching Enter key...");
                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
                inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
                inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
            }
        }, 1200);
    }

    getInputSelector() {
        return `
            div.ProseMirror[contenteditable="true"],
            div[contenteditable="true"].tiptap,
            div[contenteditable="true"][data-testid="grokInput"], 
            div[contenteditable="true"][aria-label="Grok something"],
            textarea[placeholder*="Grok"]
        `.replace(/\s+/g, ' ').trim();
    }

    getSendBtnSelector() {
        return `
            button[aria-label="Grok"], 
            button[aria-label="Grok something"],
            button[aria-label="Send"],
            button[aria-label="Send message"],
            button[data-testid="grokInputSend"],
            button[data-testid="pill-button"],
            div[role="button"][aria-label="Grok"],
            button[data-testid="tweetButtonInline"],
            div[role="button"][aria-label="Send"]
        `.replace(/\s+/g, ' ').trim();
    }

    // New "Blind Search" to find ANY visible text at the bottom
    getBlindSearchLastText() {
        try {
            // Get all visible elements with significant text
            const allElements = document.querySelectorAll('div, p, span, article, section');
            const candidates = [];
            
            for (let i = allElements.length - 1; i >= 0; i--) {
                const el = allElements[i];
                // Optimization: Skip if no direct text content to avoid huge dumps
                if (!el.innerText || el.innerText.length < 5) continue;
                
                // Skip input elements
                if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') continue;

                // Blacklist technical stats and UI noise
                const text = el.innerText;
                if (text.includes("首分块时延") || 
                    text.includes("token 时延") || 
                    text.includes("Time to first token") ||
                    text.includes("Tokens per second") ||
                    text === "更多") {
                    continue;
                }

                // Get position
                const rect = el.getBoundingClientRect();
                if (rect.height === 0 || rect.width === 0) continue; // Invisible

                candidates.push({
                    el: el,
                    text: text,
                    bottom: rect.bottom,
                    depth: this.getDOMDepth(el)
                });
                
                // Limit candidates to avoid performance hit
                if (candidates.length > 50) break;
            }

            // Sort by vertical position (lower is better) and depth (deeper is usually more specific text)
            candidates.sort((a, b) => b.bottom - a.bottom);

            // Find the first one that is NOT our prompt
            for (const c of candidates) {
                const cleanText = c.text.trim();
                const cleanPrompt = this.lastPrompt.trim();
                
                // If it's the prompt, skip
                // 1. Exact or contains match (standard)
                if (cleanText === cleanPrompt || (cleanText.includes(cleanPrompt) && cleanText.length < cleanPrompt.length + 50)) {
                    continue;
                }
                
                // 2. NEW: "How can Grok help" placeholder filter
                // Grok sometimes has a visible placeholder that blind search picks up
                if (cleanText.includes('How can Grok help') || cleanText.includes('Grok 能帮上什么忙') || cleanText.includes('Grok helps you')) {
                     continue;
                }

                // 3. NEW: "Expert Mode" / "专家模式" UI text filter
                if (cleanText === 'Expert' || cleanText === '专家模式' || cleanText === 'Simple' || cleanText === '普通模式' || 
                    cleanText === '自动模式' || cleanText === '快速模式' || cleanText === 'Heavy 模式' || cleanText === 'SuperGrok' || 
                    cleanText === '自定义指令' || cleanText.includes('Grok 4.1 Thinking')) {
                     continue;
                }
                
                // Found a candidate
                if (this.debugMode) console.log("GrokDebug: Blind candidate found:", c.text.slice(0, 50));
                return c.text;
            }
        } catch (e) {
            console.error("GrokDebug: Blind search error", e);
        }
        return '';
    }

    getDOMDepth(element) {
        let depth = 0;
        while (element.parentElement) {
            depth++;
            element = element.parentElement;
        }
        return depth;
    }

    getLastMessageText() {
        // 1. Try Specific Selectors
        const specificSelectors = [
            'div[data-testid="message-bubble"]',
            '.message-content',
            '.message-text',
            'div[data-testid="tweetText"]', // X.com standard
            'article[data-testid="tweet"] div[lang]', // X.com standard
            'div[aria-label="Grok Response"]'
        ];

        for (const sel of specificSelectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
                const last = els[els.length - 1];
                if (this.debugMode) console.log(`GrokDebug: Found selector ${sel}:`, last.innerText.slice(0, 30));
                return last.innerText;
            }
        }

        // 2. Fallback to Blind Search
        if (this.debugMode) console.log("GrokDebug: No standard selectors match. Trying blind search...");
        return this.getBlindSearchLastText();
    }

    onSendPostProcessing() {
        this.previousContent = this.getLastMessageText();
        if (this.debugMode) console.log("GrokDebug: onSend - Previous Content:", this.previousContent.slice(0, 30));
        
        this.lastResponseLength = 0;
        this.isGenerating = true;
        this.expectingNewMessage = true;
        this.sendUpdate('generating', 'Waiting for response...');
    }

    checkForNewResponse() {
        const currentText = this.getLastMessageText();
        
        if (!currentText) {
             return;
        }

        // Check generation status
        const stopBtn = document.querySelector('button[aria-label="Stop"], button[aria-label="Stop generating"]');
        const isGenerating = !!stopBtn;

        if (this.expectingNewMessage && !isGenerating) {
            // Check if it's the same as before
            if (currentText === this.previousContent) return;

            // Check if it's our prompt
            if (currentText.trim().includes(this.lastPrompt.trim()) && currentText.length < this.lastPrompt.length + 50) {
                return;
            }

            this.expectingNewMessage = false;
        }

        if (isGenerating) {
            this.expectingNewMessage = false;
            if (this.isGenerating !== isGenerating) {
                this.isGenerating = isGenerating;
            }
            if (currentText !== this.lastSentContent) {
                this.lastSentContent = currentText;
                this.sendUpdate('generating', currentText);
            }
        } else {
             if (this.isGenerating || !this.expectingNewMessage) {
                 this.isGenerating = false;
                 if (currentText !== this.lastSentContent) {
                     this.lastSentContent = currentText;
                     this.sendUpdate('idle', currentText);
                 }
             }
        }
    }
}

new GrokAdapter();
