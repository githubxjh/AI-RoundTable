
console.log("AI RoundTable Background Service Worker Loaded");

// Store active tab IDs
let activeTabs = {
    'ChatGPT': null,
    'Claude': null,
    'Grok': null,
    'Gemini': null
};

// Configuration for matching URLs
const MODEL_URLS = {
    'ChatGPT': 'chatgpt.com',
    'Claude': 'claude.ai',
    'Grok': 'x.com/i/grok', // Assuming Grok URL
    'Gemini': 'gemini.google.com'
};

chrome.runtime.onInstalled.addListener(() => {
    console.log("AI RoundTable Extension Installed");
});

// Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received message:", message);

    handleMessage(message)
        .then(response => sendResponse(response))
        .catch(error => sendResponse({ status: 'error', message: error.message }));
    
    return true; // Keep channel open for async response
});

async function handleMessage(message) {
    // refresh tab list before processing
    await discoverTabs();

    switch (message.type) {
        case 'BROADCAST':
            return await broadcastMessage(message.text);
        case 'ROUTE':
            return await routeMessage(message);
        case 'REPLY_QUESTION':
            return await sendToModel(message.model, message.text);
        default:
            return { status: 'unknown_type' };
    }
}

// Find tabs for each model
async function discoverTabs() {
    const tabs = await chrome.tabs.query({});
    
    // Reset
    activeTabs = { 'ChatGPT': null, 'Claude': null, 'Grok': null, 'Gemini': null };

    tabs.forEach(tab => {
        if (!tab.url) return;
        
        if (tab.url.includes(MODEL_URLS['ChatGPT'])) activeTabs['ChatGPT'] = tab.id;
        else if (tab.url.includes(MODEL_URLS['Claude'])) activeTabs['Claude'] = tab.id;
        else if (tab.url.includes(MODEL_URLS['Grok'])) activeTabs['Grok'] = tab.id;
        else if (tab.url.includes(MODEL_URLS['Gemini'])) activeTabs['Gemini'] = tab.id;
    });

    console.log("Discovered Tabs:", activeTabs);
}

// Send to all connected models
async function broadcastMessage(text) {
    const promises = [];
    
    for (const [model, tabId] of Object.entries(activeTabs)) {
        if (tabId) {
            promises.push(sendMessageToTab(tabId, { type: 'INPUT_PROMPT', text: text, model: model }));
        }
    }

    const results = await Promise.allSettled(promises);
    return { status: 'broadcast_done', results };
}

// Send to specific targets (routing)
async function routeMessage(message) {
    // Logic: Combine quote + instruction
    const prompt = `
[引用观点 / Reference]
Source: ${message.source}
Content: "${message.quote}"

[指令 / Instruction]
${message.instruction}
    `.trim();

    // In the future, 'message' could contain specific targets. 
    // For now, let's assume we want to send to Claude as per the demo default, 
    // or we can parse targets from the message if the UI sent them.
    // The current UI mock sends generic 'ROUTE', but we can assume it means "send to others".
    // For this implementation, I'll send to ALL OTHER models except the source.
    
    const promises = [];
    for (const [model, tabId] of Object.entries(activeTabs)) {
        if (tabId && model !== message.source) {
             promises.push(sendMessageToTab(tabId, { type: 'INPUT_PROMPT', text: prompt, model: model }));
        }
    }
    
    return { status: 'route_done', sent_to: promises.length };
}

// Send to single model
async function sendToModel(modelName, text) {
    const tabId = activeTabs[modelName];
    if (!tabId) return { status: 'error', message: `Model ${modelName} not found` };

    return await sendMessageToTab(tabId, { type: 'INPUT_PROMPT', text: text, model: modelName });
}

// Helper wrapper
async function sendMessageToTab(tabId, payload) {
    try {
        return await chrome.tabs.sendMessage(tabId, payload);
    } catch (e) {
        console.warn(`Failed to send to tab ${tabId}:`, e);
        return { error: e.message };
    }
}
