
console.log("AI RoundTable Background Service Worker Loaded");

// Store active tab IDs
let activeTabs = {
    'ChatGPT': null,
    'Claude': null,
    'Grok': null,
    'Gemini': null,
    'Doubao': null
};

// Configuration for matching URLs
const MODEL_URLS = {
    'ChatGPT': 'chatgpt.com',
    'Claude': 'claude.ai',
    'Grok': 'grok.com', 
    'Gemini': 'gemini.google.com',
    'Doubao': 'www.doubao.com/chat/',
    'DeepSeek': 'chat.deepseek.com'
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
            return await broadcastMessage(message.text, message.targets);
        case 'ROUTE':
            return await routeMessage(message);
        case 'ACTIVATE_TAB':
            return await activateTab(message.model);
        case 'STATUS_UPDATE':
            // Forward to all parts of the extension (e.g., SidePanel)
            // Note: runtime.sendMessage sends to popup/options/sidepanel pages, not content scripts
            chrome.runtime.sendMessage(message).catch(() => {
                // Ignore error if no listeners (e.g. sidepanel closed)
            });
            return { status: 'status_forwarded' };
        default:
            return { status: 'unknown_type' };
    }
}

// Find tabs for each model
async function discoverTabs() {
    const tabs = await chrome.tabs.query({});
    
    // Reset
    activeTabs = { 'ChatGPT': null, 'Claude': null, 'Grok': null, 'Gemini': null, 'Doubao': null };

    tabs.forEach(tab => {
        if (!tab.url) return;
        
        if (tab.url.includes(MODEL_URLS['ChatGPT'])) activeTabs['ChatGPT'] = tab.id;
        else if (tab.url.includes(MODEL_URLS['Claude'])) activeTabs['Claude'] = tab.id;
        else if (tab.url.includes('x.com/i/grok') || tab.url.includes('grok.com')) activeTabs['Grok'] = tab.id;
        else if (tab.url.includes('gemini.google.com') || tab.url.includes('aistudio.google.com')) activeTabs['Gemini'] = tab.id;
        else if (tab.url.includes('doubao.com/chat') || tab.url.includes('flow-chat.gf.bytedance.net/chat')) activeTabs['Doubao'] = tab.id;
    });

    console.log("Discovered Tabs:", activeTabs);
}

// Send to all connected models
async function broadcastMessage(text, targets) {
    const promises = [];
    
    // Use targets if provided, otherwise send to all
    const targetModels = targets || Object.keys(activeTabs);

    for (const [model, tabId] of Object.entries(activeTabs)) {
        if (tabId && targetModels.includes(model)) {
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
${message.quote}

[指令 / Instruction]
${message.instruction}
    `.trim();

    // Use explicit targets from message if available
    const targetModels = message.targets || [];
    
    const promises = [];
    for (const [model, tabId] of Object.entries(activeTabs)) {
        // Send if:
        // 1. Tab exists
        // 2. Model is in the target list (OR if no targets specified, exclude source - fallback)
        const shouldSend = targetModels.length > 0 
            ? targetModels.includes(model)
            : model !== message.source;

        if (tabId && shouldSend) {
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

// Activate tab and window
async function activateTab(modelName) {
    // Refresh list first to be safe
    await discoverTabs();
    
    const tabId = activeTabs[modelName];
    
    if (!tabId) {
        // If tab not found, try to create one based on the model name
        const url = MODEL_URLS[modelName];
        if (url) {
            try {
                // Prepend https:// if missing
                const fullUrl = url.startsWith('http') ? url : `https://${url}`;
                const newTab = await chrome.tabs.create({ url: fullUrl });
                return { status: 'created', tabId: newTab.id };
            } catch (e) {
                console.warn(`Failed to create tab for ${modelName}:`, e);
                return { status: 'error', message: `Failed to create tab: ${e.message}` };
            }
        }
        return { status: 'error', message: `Model ${modelName} not found and no URL configured` };
    }

    try {
        // Activate Tab
        await chrome.tabs.update(tabId, { active: true });
        
        // Activate Window (if needed)
        const tab = await chrome.tabs.get(tabId);
        await chrome.windows.update(tab.windowId, { focused: true });
        
        return { status: 'activated' };
    } catch (e) {
        console.warn(`Failed to activate tab ${tabId}:`, e);
        return { error: e.message };
    }
}
