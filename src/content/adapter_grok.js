
class GrokAdapter extends AdapterBase {
    constructor() {
        super('Grok');
        this.lastPrompt = '';
        this.previousContent = '';
        this.debugMode = true; // Enable debug mode for verification
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
            textarea[placeholder*="Grok"],
            textarea[aria-label="向 Grok 提任何问题"]
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
            // Note: Querying ALL elements can be slow. 
            // Optimizing: Target text-containing elements specifically
            const allElements = document.querySelectorAll('div, p, span, article, section');
            const candidates = [];
            
            // Iterate BACKWARDS from the end of the document
            // The response is usually at the bottom
            // Limit to checking the last 200 elements to improve performance and relevance
            const limit = 200; 
            const start = Math.max(0, allElements.length - limit);
            
            for (let i = allElements.length - 1; i >= start; i--) {
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
                // Use a tighter threshold for short prompts to avoid false positives on short answers
                // But for "contains", we need to be careful.
                const isShortPrompt = cleanPrompt.length < 10;
                
                if (cleanText === cleanPrompt) {
                    continue;
                }
                
                // If text contains prompt, it might be the user's bubble OR the AI quoting the user.
                // If it's the user's bubble, the length should be close to the prompt length.
                if (cleanText.includes(cleanPrompt)) {
                     // If the text is barely longer than the prompt (e.g. just prompt + metadata), it's likely the user bubble
                     if (cleanText.length < cleanPrompt.length + 50) {
                         continue;
                     }
                     // If the text is MUCH longer, it might be the AI quoting the prompt + answering.
                     // In blind search, we usually find the smallest container. 
                     // If we found a huge container containing the prompt, it might be a wrapper.
                     // But we want the *response* text.
                     
                     // Experimental: If we found a block containing the prompt, try to strip the prompt out?
                     // Or just skip it and hope we find a cleaner block (the answer itself) later/deeper.
                     // Let's skip it for now, assuming the answer exists as a separate sibling or child without the prompt.
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
        // 1. Precise Selector based on ID (New Grok 2025 Layout)
        // IDs are like "response-58d00482-..."
        const responseContainers = document.querySelectorAll('div[id^="response-"]');
        if (responseContainers.length > 0) {
            const lastContainer = responseContainers[responseContainers.length - 1];
            
            // Try to find the specific bubble content to avoid metadata
            const bubble = lastContainer.querySelector('.message-bubble');
            if (bubble) {
                // Remove "Thinking" or "Search Analysis" if they are separate blocks inside the bubble
                // (Assuming they might be distiguishable, but for now innerText is safer than nothing)
                if (this.debugMode) console.log("GrokDebug: Found response container + bubble:", bubble.innerText.slice(0, 30));
                return bubble.innerText;
            }
            
            if (this.debugMode) console.log("GrokDebug: Found response container but no bubble:", lastContainer.innerText.slice(0, 30));
            return lastContainer.innerText;
        }

        // 2. Try Specific Selectors (Legacy or fallback)
        const specificSelectors = [
            'div.message-bubble', // General bubble class
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
                // Ensure it's not the user's prompt (simple heuristic: check if it has 'items-end' parent or similar if possible)
                // For now, relying on the fact that responses usually come last.
                if (this.debugMode) console.log(`GrokDebug: Found selector ${sel}:`, last.innerText.slice(0, 30));
                return last.innerText;
            }
        }

        // 3. Fallback to Blind Search
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
