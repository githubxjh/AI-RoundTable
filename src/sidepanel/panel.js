
// DOM Elements
let quoteListEl;
let routerDock;
let fullViewModal;
let fullViewTitle;
let routerInput;
let clearQuotesBtn;

// State
let quoteList = []; // Array of { source, text }

// Presets Configuration
const PRESETS = {
    'red-teaming': "请作为严厉的批评者，找出上述方案中最大的逻辑漏洞、风险点和过于乐观的假设。",
    'fact-check': "请核实上述内容中的数据引用和事实前提。是否存在过时信息或误导性描述？",
    'devils-advocate': "如果上述观点完全错误，反面情况会是什么？请给出完全相反的推演逻辑。",
    'execution': "不要讲大道理。基于上述思路，请给出具体的、可执行的 Step-by-Step 落地计划（包含时间节点）。",
    'trade-off': "上述方案的收益很明确，但代价是什么？请分析其机会成本和潜在的副作用。"
};

document.addEventListener('DOMContentLoaded', () => {
    // Initialize elements
    quoteListEl = document.getElementById('quote-list');
    routerDock = document.getElementById('router-dock');
    fullViewModal = document.getElementById('full-view-modal');
    fullViewTitle = document.getElementById('full-view-title');
    routerInput = document.getElementById('router-input');
    clearQuotesBtn = document.getElementById('clear-quotes');

    // Attach Event Listeners
    
    // 1. Broadcast Button
    const broadcastBtn = document.querySelector('#top-deck .btn');
    if (broadcastBtn) {
        broadcastBtn.addEventListener('click', simulateBroadcast);
    }

    // 2. Route Button
    const routeBtn = document.querySelector('.btn-route');
    if (routeBtn) {
        routeBtn.addEventListener('click', simulateRoute);
    }

    // 3. Clear Quotes Button
    if (clearQuotesBtn) {
        clearQuotesBtn.addEventListener('click', clearAllQuotes);
    }

    // 4. Close Full View Button
    const closeFullViewBtn = document.querySelector('#full-view-content button'); // The close button in modal header
    if (closeFullViewBtn) {
        closeFullViewBtn.addEventListener('click', closeFullView);
    }

    // 5. Dynamic Buttons (Quote, Expand, Remove Quote, Presets) - using Event Delegation
    document.addEventListener('click', (e) => {
        const target = e.target;

        // Handle Quote Button
        if (target.classList.contains('btn-quote')) {
            const source = target.dataset.source;
            const cardBody = target.closest('.ai-card').querySelector('.card-body').innerText;
            const text = target.dataset.text || cardBody; 
            addQuote(source, text);
        }

        // Handle Expand Button
        if (target.classList.contains('btn-expand')) {
            const model = target.dataset.model;
            openFullView(model);
        }

        // Handle Card Header Click (Jump to Tab)
        const header = target.closest('.card-header');
        if (header) {
            const card = header.closest('.ai-card');
            let model = null;
            if (card.id === 'card-gpt') model = 'ChatGPT';
            else if (card.id === 'card-claude') model = 'Claude';
            else if (card.id === 'card-grok') model = 'Grok';
            else if (card.id === 'card-gemini') model = 'Gemini';
            
            if (model) {
                 chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', model: model });
            }
        }

        // Handle Remove Quote Item
        if (target.classList.contains('close-btn') && target.closest('.quote-item')) {
            const index = target.closest('.quote-item').dataset.index;
            removeQuote(parseInt(index));
        }

        // Handle Preset Chips
        if (target.classList.contains('chip')) {
            const presetKey = target.dataset.preset;
            const presetText = PRESETS[presetKey];
            if (presetText) {
                routerInput.value = presetText;
                routerInput.focus();
            }
        }
    });
});

// Logic Functions

function addQuote(source, text) {
    quoteList.push({ source, text });
    renderQuoteList();
    updateTargetExclusions();
    
    // Visual feedback
    routerDock.classList.add('router-active-border');
    if (routerInput) routerInput.focus();
}

function removeQuote(index) {
    quoteList.splice(index, 1);
    renderQuoteList();
    updateTargetExclusions();
    
    if (quoteList.length === 0) {
        routerDock.classList.remove('router-active-border');
    }
}

function clearAllQuotes() {
    quoteList = [];
    renderQuoteList();
    updateTargetExclusions();
    routerDock.classList.remove('router-active-border');
}

function renderQuoteList() {
    if (quoteList.length === 0) {
        quoteListEl.innerHTML = `<div class="empty-state" style="text-align:center; color:#d1d5db; padding:10px; font-size:11px;">点击上方卡片的 "引用" 按钮添加观点</div>`;
        return;
    }

    quoteListEl.innerHTML = '';
    quoteList.forEach((quote, index) => {
        const div = document.createElement('div');
        div.className = 'quote-item';
        div.dataset.index = index;
        div.innerHTML = `
            <span class="close-btn">×</span>
            <strong>From: ${quote.source}</strong><br>
            ${quote.text.substring(0, 100)}${quote.text.length > 100 ? '...' : ''}
        `;
        quoteListEl.appendChild(div);
    });
    
    // Auto scroll to bottom
    quoteListEl.scrollTop = quoteListEl.scrollHeight;
}

function updateTargetExclusions() {
    // Get all sources currently quoted
    const sources = new Set(quoteList.map(q => q.source));
    
    // Update checkboxes
    const checkboxes = document.querySelectorAll('.router-targets input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (sources.has(cb.value)) {
            cb.disabled = true;
            cb.checked = false;
            cb.parentElement.style.opacity = '0.5';
            cb.parentElement.title = "不能让 AI 评判自己的观点";
        } else {
            cb.disabled = false;
            cb.parentElement.style.opacity = '1';
            cb.parentElement.title = "";
        }
    });
}

function simulateBroadcast() {
    const btn = document.querySelector('#top-deck .btn');
    const originalText = btn.innerText;
    
    // 1. Get checked targets
    const targets = [];
    document.querySelectorAll('.target-selector input[type="checkbox"]').forEach(checkbox => {
        if (checkbox.checked) {
            const labelText = checkbox.parentElement.innerText.trim();
            // Exact match since we simplified the labels
            if (labelText === 'ChatGPT') targets.push('ChatGPT');
            else if (labelText === 'Claude') targets.push('Claude');
            else if (labelText === 'Grok') targets.push('Grok');
            else if (labelText === 'Gemini') targets.push('Gemini');
        }
    });

    if (targets.length === 0) {
        alert('请至少选择一个 AI 模型！');
        return;
    }

    btn.innerText = 'Sending...';
    btn.style.backgroundColor = '#6b7280';
    
    setTimeout(() => {
        btn.innerText = originalText;
        btn.style.backgroundColor = '';
        
        chrome.runtime.sendMessage({ 
            type: 'BROADCAST', 
            text: document.querySelector('.main-input').value,
            targets: targets 
        });
    }, 500);
}

function simulateRoute() {
    if (quoteList.length === 0) {
        alert('请先在上方选择至少一个观点进行引用 (Click "Quote")');
        return;
    }
    
    // 1. Collect Targets
    const targets = [];
    document.querySelectorAll('.router-targets input[type="checkbox"]').forEach(cb => {
        if (cb.checked) {
            targets.push(cb.value);
        }
    });

    if (targets.length === 0) {
        alert('请选择至少一个目标模型 (Send to)');
        return;
    }

    // 2. Assemble Prompt
    let combinedQuoteText = "";
    quoteList.forEach((q, i) => {
        combinedQuoteText += `[Reference ${i+1} / Source: ${q.source}]\n${q.text}\n\n`;
    });

    // 3. Send Message
    chrome.runtime.sendMessage({ 
        type: 'ROUTE', 
        source: 'Multiple', // Backend handles this generically now
        quote: combinedQuoteText,
        instruction: routerInput.value,
        targets: targets // Explicit targets!
    });

    alert(`已将 ${quoteList.length} 条引用内容 + 指令 发送给: ${targets.join(', ')}`);
    
    // Optional: Clear after send? Let's keep it for now in case user wants to send to others.
    // clearAllQuotes(); 
    // routerInput.value = '';
}

function openFullView(modelName) {
    fullViewTitle.innerText = `${modelName} - Full Session View`;
    fullViewModal.style.display = 'flex';
}

function closeFullView() {
    fullViewModal.style.display = 'none';
}

// Listen for status updates from Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'STATUS_UPDATE') {
        updateCard(message.model, message.status, message.summary);
    }
});

const MODEL_CARD_MAP = {
    'ChatGPT': 'card-gpt',
    'Claude': 'card-claude',
    'Grok': 'card-grok',
    'Gemini': 'card-gemini'
};

function updateCard(model, status, summary) {
    const cardId = MODEL_CARD_MAP[model] || `card-${model.toLowerCase()}`;
    const card = document.getElementById(cardId);
    if (!card) return;

    // Update Status Dot
    const dot = card.querySelector('.status-dot');
    if (dot) {
        dot.className = 'status-dot'; // reset
        if (status === 'generating') dot.classList.add('thinking');
        else if (status === 'idle') dot.classList.add('active');
    }

    // Update Summary Body
    const body = card.querySelector('.card-body');
    if (body && summary) {
        body.innerText = summary;
    }
    
    // Update Quote Data
    const quoteBtn = card.querySelector('.btn-quote');
    if (quoteBtn && summary) {
        quoteBtn.dataset.text = summary;
        // Also enable the button if it was disabled (like Gemini's)
        quoteBtn.disabled = false;
        quoteBtn.innerText = '引用此观点';
    }
}
