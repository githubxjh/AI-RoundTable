const MODEL_TAB_RULES = Object.freeze([
    ['ChatGPT', (url) => url.includes('chatgpt.com')],
    ['Grok', (url) => url.includes('x.com/i/grok') || url.includes('grok.com')],
    ['Gemini', (url) => url.includes('gemini.google.com') || url.includes('aistudio.google.com')],
    ['Doubao', (url) => url.includes('doubao.com/chat') || url.includes('flow-chat.gf.bytedance.net/chat')],
    ['DeepSeek', (url) => url.includes('chat.deepseek.com')]
]);

export function createEmptyModelTabs() {
    return {
        ChatGPT: null,
        Grok: null,
        Gemini: null,
        Doubao: null,
        DeepSeek: null
    };
}

export function getModelForTabUrl(url) {
    const value = String(url || '');
    if (!value) return '';
    const matched = MODEL_TAB_RULES.find(([, matches]) => matches(value));
    return matched?.[0] || '';
}

export function selectModelTabs(tabs = [], options = {}) {
    const selectedTabs = createEmptyModelTabs();
    const selectedRecords = createEmptyModelTabs();
    const lastFocusedWindowId = Number(options.lastFocusedWindowId || 0);

    for (const tab of Array.isArray(tabs) ? tabs : []) {
        const model = getModelForTabUrl(tab?.url);
        if (!model) continue;
        if (isPreferredModelTab(tab, selectedRecords[model], lastFocusedWindowId)) {
            selectedRecords[model] = tab;
            selectedTabs[model] = tab.id ?? null;
        }
    }

    return selectedTabs;
}

function isPreferredModelTab(candidate, current, lastFocusedWindowId) {
    if (!current) return true;
    const candidateRank = getTabRank(candidate, lastFocusedWindowId);
    const currentRank = getTabRank(current, lastFocusedWindowId);
    for (let index = 0; index < candidateRank.length; index += 1) {
        if (candidateRank[index] !== currentRank[index]) {
            return candidateRank[index] > currentRank[index];
        }
    }
    return false;
}

function getTabRank(tab, lastFocusedWindowId) {
    return [
        Number(tab?.windowId) === lastFocusedWindowId ? 1 : 0,
        tab?.active ? 1 : 0,
        tab?.highlighted ? 1 : 0,
        tab?.discarded ? 0 : 1,
        Number(tab?.lastAccessed || 0),
        Number(tab?.id || 0)
    ];
}
