
// DOM Elements
let quotePreview;
let quoteSource;
let quoteText;
let routerDock;
let fullViewModal;
let fullViewTitle;
let routerInput;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize elements
    quotePreview = document.getElementById('quote-preview');
    quoteSource = document.getElementById('quote-source');
    quoteText = document.getElementById('quote-text');
    routerDock = document.getElementById('router-dock');
    fullViewModal = document.getElementById('full-view-modal');
    fullViewTitle = document.getElementById('full-view-title');
    routerInput = document.getElementById('router-input');

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

    // 3. Close Quote Button
    const closeQuoteBtn = document.querySelector('.close-quote');
    if (closeQuoteBtn) {
        closeQuoteBtn.addEventListener('click', clearQuote);
    }

    // 4. Close Full View Button
    const closeFullViewBtn = document.querySelector('#full-view-content button'); // The close button in modal header
    if (closeFullViewBtn) {
        closeFullViewBtn.addEventListener('click', closeFullView);
    }

    // 5. Dynamic Buttons (Quote, Expand, Reply) - using Event Delegation
    document.getElementById('monitor-stream').addEventListener('click', (e) => {
        const target = e.target;

        // Handle Quote Button
        if (target.classList.contains('btn-quote')) {
            const source = target.dataset.source;
            // For now, getting text from the card body relative to the button
            // In a real app, this data might come from a state object
            const cardBody = target.closest('.ai-card').querySelector('.card-body').innerText;
            // Or use the hardcoded text from the original HTML if provided in data-text
            const text = target.dataset.text || cardBody; 
            quoteContent(source, text);
        }

        // Handle Expand Button
        if (target.classList.contains('btn-expand')) {
            const model = target.dataset.model;
            openFullView(model);
        }

        // Handle Reply Question Button
        if (target.classList.contains('question-btn')) {
            const model = target.dataset.model;
            replyToQuestion(model);
        }
    });
});

// Logic Functions

function quoteContent(source, text) {
    quotePreview.style.display = 'block';
    quoteSource.innerText = source;
    quoteText.innerText = text;
    
    // Visual feedback
    routerDock.classList.add('router-active-border');
    
    // Focus input
    if (routerInput) routerInput.focus();
}

function clearQuote() {
    quotePreview.style.display = 'none';
    routerDock.classList.remove('router-active-border');
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
    
    // In real implementation, this will send a message to background
    setTimeout(() => {
        btn.innerText = originalText;
        btn.style.backgroundColor = '';
        
        // Mock sending message
        chrome.runtime.sendMessage({ 
            type: 'BROADCAST', 
            text: document.querySelector('.main-input').value,
            targets: targets 
        }, (response) => {
             console.log('Broadcast response:', response);
        });
        
        // alert('已将带有【角色设定】的指令广播给选中的 AI！');
    }, 500);
}

function simulateRoute() {
    if (quotePreview.style.display === 'none') {
        alert('请先在上方选择一个观点进行引用 (Click "Quote")');
        return;
    }
    
    // Mock routing
    chrome.runtime.sendMessage({ 
        type: 'ROUTE', 
        source: quoteSource.innerText,
        quote: quoteText.innerText,
        instruction: routerInput.value
    });

    alert('已将引用内容 + 你的指令 发送给目标 AI！');
    clearQuote();
    routerInput.value = '';
}

function openFullView(modelName) {
    fullViewTitle.innerText = `${modelName} - Full Session View`;
    fullViewModal.style.display = 'flex';
}

function closeFullView() {
    fullViewModal.style.display = 'none';
}

function replyToQuestion(modelName) {
    const reply = prompt(`回复 ${modelName} 的追问:`);
    if (reply) {
        // Mock reply
        chrome.runtime.sendMessage({ type: 'REPLY_QUESTION', model: modelName, text: reply });
        alert(`已单独发送给 ${modelName}: "${reply}"`);
    }
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
