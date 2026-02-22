console.log('AI RoundTable Background Service Worker Loaded');

const MODEL_NAMES = ['ChatGPT', 'Claude', 'Grok', 'Gemini', 'Doubao'];
const TERMINAL_EVAL_STATUSES = new Set(['done', 'parse_failed', 'timeout']);

let activeTabs = {
    ChatGPT: null,
    Claude: null,
    Grok: null,
    Gemini: null,
    Doubao: null
};

const MODEL_URLS = {
    ChatGPT: 'chatgpt.com',
    Claude: 'claude.ai',
    Grok: 'grok.com',
    Gemini: 'gemini.google.com',
    Doubao: 'www.doubao.com/chat/'
};

const RT_KEYS = {
    schemaVersion: 'rt_schema_version',
    roundIndex: 'rt_round_index',
    rounds: 'rt_rounds',
    candidates: 'rt_candidates',
    evaluations: 'rt_evaluations',
    modelState: 'rt_model_state',
    settings: 'rt_settings'
};

const RT_SCHEMA_VERSION = 2;
const REVIEW_TIMEOUT_MS = 180000;

const DEFAULT_SETTINGS = {
    retentionDays: 30,
    selfReviewWeight: 0.2,
    nonSelfWeight: 1.0,
    weights: {
        accuracy: 0.4,
        completeness: 0.25,
        actionability: 0.2,
        clarity: 0.15
    },
    scoringScale: '1-10',
    blindReview: true,
    isolationMode: 'reuse_current_chat',
    reviewPromptTemplate: [
        '你是一名客观中立的评审员。',
        '问题：',
        '{{question}}',
        '',
        '请评估以下匿名答案：',
        '{{answers}}',
        '',
        '评分规则（每个维度 1-10 分）：accuracy（准确性）、completeness（完整性）、actionability（可执行性）、clarity（清晰度）。',
        'overall = accuracy*0.4 + completeness*0.25 + actionability*0.2 + clarity*0.15',
        '',
        '只输出一个 JSON 对象，并用以下标签包裹：',
        '<EVAL_JSON>{...}</EVAL_JSON>',
        '',
        'JSON 结构：',
        '{',
        '  "scores": [',
        '    {',
        '      "slot": "A",',
        '      "accuracy": 8,',
        '      "completeness": 7,',
        '      "actionability": 8,',
        '      "clarity": 9,',
        '      "overall": 8.0,',
        '      "reason": "short reason",',
        '      "evidence": ["point1", "point2"]',
        '    }',
        '  ]',
        '}',
        '不要输出 Markdown。不要在 <EVAL_JSON> 标签外输出任何额外文本。'
    ].join('\n')
};

const pendingReviewTasks = new Map();

chrome.runtime.onInstalled.addListener(async () => {
    await ensureRtState();
    console.log('AI RoundTable Extension Installed');
});

chrome.runtime.onStartup.addListener(async () => {
    await ensureRtState();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
        .then((response) => sendResponse(response))
        .catch((error) => {
            console.error('Background handleMessage error:', error);
            sendResponse({ status: 'error', message: error.message });
        });
    return true;
});

async function handleMessage(message, sender) {
    if (!message || !message.type) {
        return { status: 'error', message: 'Invalid message' };
    }

    switch (message.type) {
        case 'BROADCAST':
            await discoverTabs();
            return broadcastMessage(message.text, message.targets);
        case 'ROUTE':
            await discoverTabs();
            return routeMessage(message);
        case 'ACTIVATE_TAB':
            await discoverTabs();
            return activateTab(message.model);
        case 'STATUS_UPDATE':
            return handleStatusUpdate(message, sender);
        case 'ROUND_CREATE':
            return handleRoundCreate(message);
        case 'ROUND_ADD_CANDIDATE':
            return handleRoundAddCandidate(message);
        case 'ROUND_START_REVIEW':
            await discoverTabs();
            return handleRoundStartReview(message);
        case 'ROUND_GET':
            return handleRoundGet(message);
        case 'ROUND_LIST':
            return handleRoundList(message);
        case 'ROUND_DELETE':
            return handleRoundDelete(message);
        case 'ROUND_CLEAR_EXPIRED':
            return handleRoundClearExpired();
        default:
            return { status: 'unknown_type', type: message.type };
    }
}

async function handleStatusUpdate(message, sender) {
    await ensureRtState();
    await updateModelState(message, sender);

    chrome.runtime.sendMessage(message).catch(() => {});

    if (message.mode === 'review') {
        await handleReviewStatus(message);
    }

    return { status: 'status_forwarded' };
}

async function discoverTabs() {
    const tabs = await chrome.tabs.query({});

    activeTabs = {
        ChatGPT: null,
        Claude: null,
        Grok: null,
        Gemini: null,
        Doubao: null
    };

    tabs.forEach((tab) => {
        if (!tab.url) return;

        if (tab.url.includes(MODEL_URLS.ChatGPT)) activeTabs.ChatGPT = tab.id;
        else if (tab.url.includes(MODEL_URLS.Claude)) activeTabs.Claude = tab.id;
        else if (tab.url.includes('x.com/i/grok') || tab.url.includes('grok.com')) activeTabs.Grok = tab.id;
        else if (tab.url.includes('gemini.google.com') || tab.url.includes('aistudio.google.com')) activeTabs.Gemini = tab.id;
        else if (tab.url.includes('doubao.com/chat') || tab.url.includes('flow-chat.gf.bytedance.net/chat')) activeTabs.Doubao = tab.id;
    });
}

async function broadcastMessage(text, targets) {
    const targetModels = Array.isArray(targets) && targets.length > 0 ? targets : MODEL_NAMES;
    const promises = [];

    for (const [model, tabId] of Object.entries(activeTabs)) {
        if (tabId && targetModels.includes(model)) {
            promises.push(sendMessageToTab(tabId, { type: 'INPUT_PROMPT', text, model, mode: 'normal' }));
        }
    }

    const results = await Promise.allSettled(promises);
    return { status: 'broadcast_done', results };
}

async function routeMessage(message) {
    const promptParts = [];
    if (message.instruction && String(message.instruction).trim()) {
        promptParts.push(`[Instruction]\n${message.instruction}`.trim());
    }
    if (message.quote && String(message.quote).trim()) {
        promptParts.push(`[Reference]\n${message.quote}`.trim());
    }
    const prompt = promptParts.join('\n\n').trim();
    const targetModels = Array.isArray(message.targets) ? message.targets : [];

    const promises = [];
    for (const [model, tabId] of Object.entries(activeTabs)) {
        const shouldSend = targetModels.length > 0 ? targetModels.includes(model) : model !== message.source;
        if (tabId && shouldSend) {
            promises.push(sendMessageToTab(tabId, { type: 'INPUT_PROMPT', text: prompt, model, mode: 'normal' }));
        }
    }

    await Promise.allSettled(promises);
    return { status: 'route_done', sent_to: promises.length };
}

async function activateTab(modelName) {
    const tabId = activeTabs[modelName];
    if (!tabId) {
        const url = MODEL_URLS[modelName];
        if (!url) {
            return { status: 'error', message: `Model ${modelName} not found and no URL configured` };
        }
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
        const newTab = await chrome.tabs.create({ url: fullUrl });
        return { status: 'created', tabId: newTab.id };
    }

    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    return { status: 'activated' };
}

async function sendMessageToTab(tabId, payload) {
    try {
        return await chrome.tabs.sendMessage(tabId, payload);
    } catch (error) {
        console.warn(`Failed to send to tab ${tabId}:`, error);
        return { error: error.message };
    }
}

async function ensureRtState() {
    const current = await chrome.storage.local.get(Object.values(RT_KEYS));
    const patch = {};

    if (current[RT_KEYS.schemaVersion] !== RT_SCHEMA_VERSION) {
        patch[RT_KEYS.schemaVersion] = RT_SCHEMA_VERSION;
    }
    if (!Array.isArray(current[RT_KEYS.roundIndex])) {
        patch[RT_KEYS.roundIndex] = [];
    }
    if (!current[RT_KEYS.rounds] || typeof current[RT_KEYS.rounds] !== 'object') {
        patch[RT_KEYS.rounds] = {};
    }
    if (!current[RT_KEYS.candidates] || typeof current[RT_KEYS.candidates] !== 'object') {
        patch[RT_KEYS.candidates] = {};
    }
    if (!current[RT_KEYS.evaluations] || typeof current[RT_KEYS.evaluations] !== 'object') {
        patch[RT_KEYS.evaluations] = {};
    }
    if (!current[RT_KEYS.modelState] || typeof current[RT_KEYS.modelState] !== 'object') {
        patch[RT_KEYS.modelState] = {};
    }
    patch[RT_KEYS.settings] = mergeSettings(current[RT_KEYS.settings] || {});

    if (Object.keys(patch).length > 0) {
        await chrome.storage.local.set(patch);
    }

    return {
        [RT_KEYS.schemaVersion]: patch[RT_KEYS.schemaVersion] ?? current[RT_KEYS.schemaVersion],
        [RT_KEYS.roundIndex]: patch[RT_KEYS.roundIndex] ?? current[RT_KEYS.roundIndex],
        [RT_KEYS.rounds]: patch[RT_KEYS.rounds] ?? current[RT_KEYS.rounds],
        [RT_KEYS.candidates]: patch[RT_KEYS.candidates] ?? current[RT_KEYS.candidates],
        [RT_KEYS.evaluations]: patch[RT_KEYS.evaluations] ?? current[RT_KEYS.evaluations],
        [RT_KEYS.modelState]: patch[RT_KEYS.modelState] ?? current[RT_KEYS.modelState],
        [RT_KEYS.settings]: patch[RT_KEYS.settings]
    };
}

async function updateModelState(message, sender) {
    const current = await chrome.storage.local.get(RT_KEYS.modelState);
    const modelState = current[RT_KEYS.modelState] || {};
    const previous = modelState[message.model] || {};

    modelState[message.model] = {
        ...previous,
        status: message.status,
        lastSummary: message.summary || previous.lastSummary || '',
        updatedAt: Date.now(),
        tabId: sender?.tab?.id ?? previous.tabId ?? null,
        sourceUrl: sender?.tab?.url ?? previous.sourceUrl ?? null,
        requestId: message.requestId || null,
        mode: message.mode || 'normal'
    };

    await chrome.storage.local.set({ [RT_KEYS.modelState]: modelState });
}

async function handleRoundCreate(message) {
    const state = await ensureRtState();
    const settings = state[RT_KEYS.settings];
    await cleanupExpiredRounds(settings.retentionDays);

    const fresh = await ensureRtState();
    const now = Date.now();
    const roundId = createId('round');

    const round = {
        roundId,
        question: String(message.question || '').trim(),
        status: 'collecting',
        targetModels: Array.isArray(message.targetModels) ? [...new Set(message.targetModels)] : [],
        candidateIds: [],
        evaluationIds: [],
        ranking: [],
        config: {
            retentionDays: settings.retentionDays,
            selfReviewWeight: settings.selfReviewWeight,
            nonSelfWeight: settings.nonSelfWeight,
            weights: { ...settings.weights },
            scoringScale: settings.scoringScale,
            blindReview: settings.blindReview,
            isolationMode: settings.isolationMode
        },
        createdAt: now,
        updatedAt: now
    };

    const rounds = { ...(fresh[RT_KEYS.rounds] || {}) };
    const roundIndex = Array.isArray(fresh[RT_KEYS.roundIndex]) ? [...fresh[RT_KEYS.roundIndex]] : [];
    rounds[roundId] = round;

    await chrome.storage.local.set({
        [RT_KEYS.rounds]: rounds,
        [RT_KEYS.roundIndex]: [roundId, ...roundIndex.filter((id) => id !== roundId)]
    });

    return { status: 'round_created', roundId, round };
}

async function handleRoundAddCandidate(message) {
    const roundId = message.roundId;
    const model = message.model;
    if (!roundId || !model) {
        return { status: 'error', message: 'roundId and model are required' };
    }

    const state = await ensureRtState();
    const round = (state[RT_KEYS.rounds] || {})[roundId];
    if (!round) {
        return { status: 'error', message: `Round not found: ${roundId}` };
    }

    const modelState = (state[RT_KEYS.modelState] || {})[model];
    if (!modelState || !String(modelState.lastSummary || '').trim()) {
        return { status: 'error', message: `No captured answer for model ${model}` };
    }

    const candidateId = createId('candidate');
    const candidate = {
        candidateId,
        roundId,
        model,
        sourceTabId: modelState.tabId ?? null,
        sourceUrl: modelState.sourceUrl ?? null,
        answerText: String(modelState.lastSummary || ''),
        capturedAt: Date.now()
    };

    const rounds = { ...(state[RT_KEYS.rounds] || {}) };
    const candidates = { ...(state[RT_KEYS.candidates] || {}) };
    const nextRound = {
        ...round,
        candidateIds: [...new Set([...(round.candidateIds || []), candidateId])],
        updatedAt: Date.now()
    };

    candidates[candidateId] = candidate;
    rounds[roundId] = nextRound;

    await chrome.storage.local.set({
        [RT_KEYS.rounds]: rounds,
        [RT_KEYS.candidates]: candidates
    });

    emitRoundEvent(roundId, 'candidate_added', { candidate, candidateCount: nextRound.candidateIds.length });
    return { status: 'candidate_added', roundId, candidateId, candidate };
}

async function handleRoundStartReview(message) {
    const state = await ensureRtState();
    const rounds = { ...(state[RT_KEYS.rounds] || {}) };
    const candidates = { ...(state[RT_KEYS.candidates] || {}) };
    const evaluations = { ...(state[RT_KEYS.evaluations] || {}) };
    const settings = state[RT_KEYS.settings];

    const round = rounds[message.roundId];
    if (!round) {
        return { status: 'error', message: `Round not found: ${message.roundId}` };
    }

    const candidateList = (round.candidateIds || [])
        .map((id) => candidates[id])
        .filter(Boolean);

    if (candidateList.length < 2) {
        return { status: 'error', message: 'At least 2 candidates are required' };
    }

    const judgeModels = [...new Set(Array.isArray(message.judgeModels) ? message.judgeModels : [])]
        .filter((model) => MODEL_NAMES.includes(model));
    if (judgeModels.length === 0) {
        return { status: 'error', message: 'At least 1 judge model is required' };
    }

    for (const evaluationId of round.evaluationIds || []) {
        delete evaluations[evaluationId];
        cleanupPendingTaskByEvaluationId(evaluationId);
    }

    const weights = sanitizeWeights(message.weights || settings.weights);
    const selfReviewWeight = isFiniteNumber(message.selfReviewWeight) ? Number(message.selfReviewWeight) : settings.selfReviewWeight;
    const promptTemplate = String(message.promptTemplate || settings.reviewPromptTemplate || DEFAULT_SETTINGS.reviewPromptTemplate);

    const nextRound = {
        ...round,
        status: 'reviewing',
        evaluationIds: [],
        ranking: [],
        updatedAt: Date.now(),
        config: {
            ...round.config,
            retentionDays: settings.retentionDays,
            selfReviewWeight,
            nonSelfWeight: settings.nonSelfWeight,
            weights,
            scoringScale: settings.scoringScale,
            blindReview: true,
            isolationMode: 'reuse_current_chat'
        }
    };

    const dispatchQueue = [];
    for (const judgeModel of judgeModels) {
        const shuffledCandidates = fisherYatesShuffle(candidateList.map((c) => c.candidateId));
        const slots = buildSlots(shuffledCandidates.length);
        const blindMap = {};
        const answerLines = [];

        slots.forEach((slot, idx) => {
            const candidateId = shuffledCandidates[idx];
            blindMap[slot] = candidateId;
            const candidate = candidates[candidateId];
            answerLines.push(`[Answer ${slot}]`);
            answerLines.push(candidate?.answerText || '');
            answerLines.push('');
        });

        const answersBlock = answerLines.join('\n').trim();
        const promptText = renderPrompt(promptTemplate, {
            question: nextRound.question || '',
            answers: answersBlock
        });

        const evaluationId = createId('evaluation');
        const requestId = createId('request');
        const evaluation = {
            evaluationId,
            roundId: nextRound.roundId,
            judgeModel,
            promptText,
            blindMap,
            rawResponse: '',
            parsedScores: [],
            status: 'pending',
            createdAt: Date.now(),
            completedAt: null
        };

        evaluations[evaluationId] = evaluation;
        nextRound.evaluationIds.push(evaluationId);
        dispatchQueue.push({ evaluationId, requestId, judgeModel, promptText });
    }

    rounds[nextRound.roundId] = nextRound;
    await chrome.storage.local.set({
        [RT_KEYS.rounds]: rounds,
        [RT_KEYS.evaluations]: evaluations
    });

    emitRoundEvent(nextRound.roundId, 'review_started', {
        totalJudges: dispatchQueue.length,
        candidateCount: candidateList.length
    });

    let started = 0;
    let skipped = 0;

    for (const task of dispatchQueue) {
        const tabId = activeTabs[task.judgeModel];
        if (!tabId) {
            skipped += 1;
            await markEvaluationFailure(task.evaluationId, 'timeout', 'Judge tab unavailable');
            continue;
        }

        const response = await sendMessageToTab(tabId, {
            type: 'INPUT_PROMPT',
            text: task.promptText,
            model: task.judgeModel,
            requestId: task.requestId,
            mode: 'review'
        });

        if (response && response.error) {
            skipped += 1;
            await markEvaluationFailure(task.evaluationId, 'timeout', `Send failed: ${response.error}`);
            continue;
        }

        started += 1;
        registerPendingReviewTask({
            requestId: task.requestId,
            evaluationId: task.evaluationId,
            roundId: nextRound.roundId,
            judgeModel: task.judgeModel,
            repaired: false
        });
    }

    await recomputeRoundRanking(nextRound.roundId);
    return { status: 'review_started', roundId: nextRound.roundId, started, skipped };
}

async function handleRoundGet(message) {
    const state = await ensureRtState();
    const round = (state[RT_KEYS.rounds] || {})[message.roundId];
    if (!round) {
        return { status: 'error', message: `Round not found: ${message.roundId}` };
    }
    return {
        status: 'ok',
        round: hydrateRound(round, state)
    };
}

async function handleRoundList(message) {
    const state = await ensureRtState();
    const rounds = state[RT_KEYS.rounds] || {};
    const roundIndex = Array.isArray(state[RT_KEYS.roundIndex]) ? state[RT_KEYS.roundIndex] : [];
    const limit = Number(message.limit) > 0 ? Number(message.limit) : 20;
    const statusFilter = message.status;

    const list = [];
    for (const roundId of roundIndex) {
        const round = rounds[roundId];
        if (!round) continue;
        if (statusFilter && round.status !== statusFilter) continue;

        list.push({
            roundId: round.roundId,
            question: round.question,
            status: round.status,
            candidateCount: (round.candidateIds || []).length,
            evaluationCount: (round.evaluationIds || []).length,
            updatedAt: round.updatedAt,
            createdAt: round.createdAt
        });

        if (list.length >= limit) break;
    }

    return { status: 'ok', rounds: list };
}

async function handleRoundDelete(message) {
    const roundId = message.roundId;
    if (!roundId) {
        return { status: 'error', message: 'roundId is required' };
    }

    const state = await ensureRtState();
    const rounds = { ...(state[RT_KEYS.rounds] || {}) };
    const candidates = { ...(state[RT_KEYS.candidates] || {}) };
    const evaluations = { ...(state[RT_KEYS.evaluations] || {}) };
    const roundIndex = Array.isArray(state[RT_KEYS.roundIndex]) ? [...state[RT_KEYS.roundIndex]] : [];
    const round = rounds[roundId];

    if (!round) {
        return { status: 'error', message: `Round not found: ${roundId}` };
    }

    for (const candidateId of round.candidateIds || []) {
        delete candidates[candidateId];
    }
    for (const evaluationId of round.evaluationIds || []) {
        delete evaluations[evaluationId];
        cleanupPendingTaskByEvaluationId(evaluationId);
    }
    delete rounds[roundId];

    await chrome.storage.local.set({
        [RT_KEYS.rounds]: rounds,
        [RT_KEYS.candidates]: candidates,
        [RT_KEYS.evaluations]: evaluations,
        [RT_KEYS.roundIndex]: roundIndex.filter((id) => id !== roundId)
    });

    return { status: 'round_deleted', roundId };
}

async function handleRoundClearExpired() {
    const state = await ensureRtState();
    const settings = state[RT_KEYS.settings];
    const removedRoundIds = await cleanupExpiredRounds(settings.retentionDays);
    return { status: 'expired_cleared', removedRoundIds };
}

async function cleanupExpiredRounds(retentionDays) {
    const state = await ensureRtState();
    const rounds = { ...(state[RT_KEYS.rounds] || {}) };
    const candidates = { ...(state[RT_KEYS.candidates] || {}) };
    const evaluations = { ...(state[RT_KEYS.evaluations] || {}) };
    const roundIndex = Array.isArray(state[RT_KEYS.roundIndex]) ? [...state[RT_KEYS.roundIndex]] : [];

    const now = Date.now();
    const ttlMs = (Number(retentionDays) || DEFAULT_SETTINGS.retentionDays) * 24 * 60 * 60 * 1000;
    const removedRoundIds = [];

    for (const [roundId, round] of Object.entries(rounds)) {
        if (!round || typeof round.createdAt !== 'number') continue;
        if (now - round.createdAt <= ttlMs) continue;

        removedRoundIds.push(roundId);
        for (const candidateId of round.candidateIds || []) {
            delete candidates[candidateId];
        }
        for (const evaluationId of round.evaluationIds || []) {
            delete evaluations[evaluationId];
            cleanupPendingTaskByEvaluationId(evaluationId);
        }
        delete rounds[roundId];
    }

    if (removedRoundIds.length > 0) {
        const removedSet = new Set(removedRoundIds);
        await chrome.storage.local.set({
            [RT_KEYS.rounds]: rounds,
            [RT_KEYS.candidates]: candidates,
            [RT_KEYS.evaluations]: evaluations,
            [RT_KEYS.roundIndex]: roundIndex.filter((id) => !removedSet.has(id))
        });
    }

    return removedRoundIds;
}

function registerPendingReviewTask(task) {
    const timeoutId = setTimeout(() => {
        handleReviewTimeout(task.requestId).catch((error) => {
            console.error('Review timeout handling error:', error);
        });
    }, REVIEW_TIMEOUT_MS);

    pendingReviewTasks.set(task.requestId, { ...task, timeoutId });
}

async function handleReviewStatus(message) {
    const task = findPendingReviewTask(message);
    if (!task) return;

    if (message.status === 'generating') {
        emitRoundEvent(task.roundId, 'review_progress', {
            evaluationId: task.evaluationId,
            judgeModel: task.judgeModel,
            status: 'generating'
        });
        return;
    }

    if (message.status !== 'idle') return;

    const parseResult = parseEvaluationResponse(message.summary || '');
    if (parseResult.ok) {
        clearPendingReviewTask(task.requestId);
        await completeEvaluation(task.evaluationId, {
            status: 'done',
            rawResponse: message.summary || '',
            parsedScores: parseResult.scores,
            completedAt: Date.now()
        });
        return;
    }

    if (!task.repaired) {
        const state = await ensureRtState();
        const evaluation = (state[RT_KEYS.evaluations] || {})[task.evaluationId];
        if (!evaluation) {
            clearPendingReviewTask(task.requestId);
            return;
        }

        const repairPrompt = buildRepairPrompt(message.summary || '');
        const newRequestId = createId('repair');
        const tabId = activeTabs[task.judgeModel];
        if (!tabId) {
            clearPendingReviewTask(task.requestId);
            await markEvaluationFailure(task.evaluationId, 'parse_failed', message.summary || '');
            return;
        }

        const response = await sendMessageToTab(tabId, {
            type: 'INPUT_PROMPT',
            text: repairPrompt,
            model: task.judgeModel,
            requestId: newRequestId,
            mode: 'review'
        });

        if (response && response.error) {
            clearPendingReviewTask(task.requestId);
            await markEvaluationFailure(task.evaluationId, 'parse_failed', `Repair send failed: ${response.error}`);
            return;
        }

        clearPendingReviewTask(task.requestId, true);
        registerPendingReviewTask({
            requestId: newRequestId,
            evaluationId: task.evaluationId,
            roundId: task.roundId,
            judgeModel: task.judgeModel,
            repaired: true
        });
        emitRoundEvent(task.roundId, 'review_progress', {
            evaluationId: task.evaluationId,
            judgeModel: task.judgeModel,
            status: 'repair_sent'
        });
        return;
    }

    clearPendingReviewTask(task.requestId);
    await markEvaluationFailure(task.evaluationId, 'parse_failed', message.summary || '');
}

async function handleReviewTimeout(requestId) {
    const task = pendingReviewTasks.get(requestId);
    if (!task) return;
    clearPendingReviewTask(requestId);
    await markEvaluationFailure(task.evaluationId, 'timeout', 'Evaluation timed out');
}

async function completeEvaluation(evaluationId, patch) {
    const state = await ensureRtState();
    const evaluations = { ...(state[RT_KEYS.evaluations] || {}) };
    const evaluation = evaluations[evaluationId];
    if (!evaluation) return;

    evaluations[evaluationId] = {
        ...evaluation,
        ...patch
    };

    await chrome.storage.local.set({ [RT_KEYS.evaluations]: evaluations });
    await recomputeRoundRanking(evaluation.roundId);
}

async function markEvaluationFailure(evaluationId, status, rawResponse) {
    await completeEvaluation(evaluationId, {
        status,
        rawResponse: rawResponse || '',
        parsedScores: [],
        completedAt: Date.now()
    });
}

async function recomputeRoundRanking(roundId) {
    const state = await ensureRtState();
    const rounds = { ...(state[RT_KEYS.rounds] || {}) };
    const round = rounds[roundId];
    if (!round) return;

    const candidates = state[RT_KEYS.candidates] || {};
    const evaluations = state[RT_KEYS.evaluations] || {};

    const candidateList = (round.candidateIds || [])
        .map((candidateId) => candidates[candidateId])
        .filter(Boolean);

    const evaluationList = (round.evaluationIds || [])
        .map((evaluationId) => evaluations[evaluationId])
        .filter(Boolean);

    const doneEvaluations = evaluationList.filter((evaluation) => evaluation.status === 'done');
    const ranking = computeRanking(round, candidateList, doneEvaluations);

    const terminalCount = evaluationList.filter((evaluation) => TERMINAL_EVAL_STATUSES.has(evaluation.status)).length;
    const allDone = evaluationList.length > 0 && terminalCount === evaluationList.length;

    const nextRound = {
        ...round,
        ranking,
        updatedAt: Date.now()
    };

    if (allDone) {
        nextRound.status = doneEvaluations.length > 0 ? 'completed' : 'failed';
    } else if (evaluationList.length > 0) {
        nextRound.status = 'reviewing';
    }

    rounds[roundId] = nextRound;
    await chrome.storage.local.set({ [RT_KEYS.rounds]: rounds });

    emitRoundEvent(roundId, 'ranking_updated', {
        ranking: nextRound.ranking,
        progress: buildReviewProgress(evaluationList)
    });

    if (allDone) {
        emitRoundEvent(roundId, doneEvaluations.length > 0 ? 'review_done' : 'review_failed', {
            ranking: nextRound.ranking,
            progress: buildReviewProgress(evaluationList)
        });
    } else {
        emitRoundEvent(roundId, 'review_progress', {
            progress: buildReviewProgress(evaluationList)
        });
    }
}

function computeRanking(round, candidates, evaluations) {
    const weights = sanitizeWeights(round.config?.weights || DEFAULT_SETTINGS.weights);
    const selfReviewWeight = Number(round.config?.selfReviewWeight ?? DEFAULT_SETTINGS.selfReviewWeight);
    const nonSelfWeight = Number(round.config?.nonSelfWeight ?? DEFAULT_SETTINGS.nonSelfWeight);

    const recordsByCandidateId = {};
    candidates.forEach((candidate) => {
        recordsByCandidateId[candidate.candidateId] = [];
    });

    for (const evaluation of evaluations) {
        const scoreRows = Array.isArray(evaluation.parsedScores) ? evaluation.parsedScores : [];
        const rawRows = [];

        for (const row of scoreRows) {
            const slot = normalizeSlot(row.slot);
            const candidateId = (evaluation.blindMap || {})[slot];
            if (!candidateId || !recordsByCandidateId[candidateId]) {
                continue;
            }

            const accuracy = clamp(Number(row.accuracy), 1, 10);
            const completeness = clamp(Number(row.completeness), 1, 10);
            const actionability = clamp(Number(row.actionability), 1, 10);
            const clarity = clamp(Number(row.clarity), 1, 10);
            const overall = isFiniteNumber(row.overall) ? clamp(Number(row.overall), 1, 10) : null;

            const raw = (
                accuracy * weights.accuracy +
                completeness * weights.completeness +
                actionability * weights.actionability +
                clarity * weights.clarity
            );

            rawRows.push({
                candidateId,
                judgeModel: evaluation.judgeModel,
                raw,
                accuracy,
                completeness,
                actionability,
                clarity,
                overall,
                reason: String(row.reason || ''),
                evidence: Array.isArray(row.evidence) ? row.evidence.map((x) => String(x)) : []
            });
        }

        const rawValues = rawRows.map((item) => item.raw);
        const mu = mean(rawValues);
        const sigma = std(rawValues);

        rawRows.forEach((item) => {
            const normalized = sigma < 0.5 ? item.raw : clamp(5 + 1.5 * ((item.raw - mu) / sigma), 1, 10);
            const candidate = candidates.find((c) => c.candidateId === item.candidateId);
            const isSelf = candidate ? candidate.model === item.judgeModel : false;
            const weight = isSelf ? selfReviewWeight : nonSelfWeight;

            recordsByCandidateId[item.candidateId].push({
                ...item,
                normalized,
                weight,
                isSelf
            });
        });
    }

    const ranked = candidates.map((candidate) => {
        const rows = recordsByCandidateId[candidate.candidateId] || [];

        const weightedNumerator = rows.reduce((sum, row) => sum + row.normalized * row.weight, 0);
        const weightedDenominator = rows.reduce((sum, row) => sum + row.weight, 0);
        const finalScore = weightedDenominator > 0 ? weightedNumerator / weightedDenominator : 0;

        const rawMean = mean(rows.map((row) => row.raw));
        const normalizedMean = mean(rows.map((row) => row.normalized));
        const nonSelfRows = rows.filter((row) => !row.isSelf);
        const nonSelfMean = mean(nonSelfRows.map((row) => row.normalized));
        const variance = varianceOf(rows.map((row) => row.normalized));
        const accuracyMean = mean(rows.map((row) => row.accuracy));

        return {
            candidateId: candidate.candidateId,
            finalScore: roundTo(finalScore, 4),
            rawMean: roundTo(rawMean, 4),
            normalizedMean: roundTo(normalizedMean, 4),
            nonSelfMean: roundTo(nonSelfMean, 4),
            variance: roundTo(variance, 4),
            _accuracyMean: accuracyMean,
            _capturedAt: candidate.capturedAt
        };
    });

    ranked.sort((a, b) => {
        if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
        if (b.nonSelfMean !== a.nonSelfMean) return b.nonSelfMean - a.nonSelfMean;
        if (b._accuracyMean !== a._accuracyMean) return b._accuracyMean - a._accuracyMean;
        if (a.variance !== b.variance) return a.variance - b.variance;
        return (a._capturedAt || 0) - (b._capturedAt || 0);
    });

    return ranked.map((item) => ({
        candidateId: item.candidateId,
        finalScore: item.finalScore,
        rawMean: item.rawMean,
        normalizedMean: item.normalizedMean,
        nonSelfMean: item.nonSelfMean,
        variance: item.variance
    }));
}

function parseEvaluationResponse(text) {
    if (!text || typeof text !== 'string') {
        return { ok: false, error: 'Empty response' };
    }

    let jsonText = null;
    const tagMatch = text.match(/<EVAL_JSON>([\s\S]*?)<\/EVAL_JSON>/i);
    if (tagMatch && tagMatch[1]) {
        jsonText = tagMatch[1].trim();
    } else {
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            jsonText = text.slice(firstBrace, lastBrace + 1).trim();
        }
    }

    if (!jsonText) {
        return { ok: false, error: 'Missing JSON payload' };
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (error) {
        return { ok: false, error: `JSON parse error: ${error.message}` };
    }

    const rows = Array.isArray(parsed?.scores) ? parsed.scores : null;
    if (!rows) {
        return { ok: false, error: 'scores[] not found' };
    }

    const normalizedRows = rows
        .map((row) => {
            const slot = normalizeSlot(row.slot);
            if (!slot) return null;

            return {
                slot,
                accuracy: clamp(Number(row.accuracy), 1, 10),
                completeness: clamp(Number(row.completeness), 1, 10),
                actionability: clamp(Number(row.actionability), 1, 10),
                clarity: clamp(Number(row.clarity), 1, 10),
                overall: isFiniteNumber(row.overall) ? clamp(Number(row.overall), 1, 10) : null,
                reason: String(row.reason || ''),
                evidence: Array.isArray(row.evidence) ? row.evidence.slice(0, 3).map((x) => String(x)) : []
            };
        })
        .filter(Boolean);

    if (normalizedRows.length === 0) {
        return { ok: false, error: 'No valid score rows' };
    }

    return { ok: true, scores: normalizedRows };
}

function renderPrompt(template, vars) {
    return String(template || '')
        .replaceAll('{{question}}', vars.question || '')
        .replaceAll('{{answers}}', vars.answers || '');
}

function buildRepairPrompt(previousResponse) {
    const safe = String(previousResponse || '').slice(0, 12000);
    return [
        'Reformat your previous answer into valid JSON only.',
        'Do not evaluate again. Preserve your original judgment.',
        'Return exactly one payload wrapped with <EVAL_JSON>...</EVAL_JSON>.',
        '',
        'Required JSON shape:',
        '{"scores":[{"slot":"A","accuracy":1,"completeness":1,"actionability":1,"clarity":1,"overall":1,"reason":"...","evidence":["..."]}]}',
        '',
        'Previous response:',
        safe
    ].join('\n');
}

function hydrateRound(round, state) {
    const candidates = state[RT_KEYS.candidates] || {};
    const evaluations = state[RT_KEYS.evaluations] || {};
    return {
        ...round,
        candidates: (round.candidateIds || []).map((id) => candidates[id]).filter(Boolean),
        evaluations: (round.evaluationIds || []).map((id) => evaluations[id]).filter(Boolean)
    };
}

function emitRoundEvent(roundId, event, data) {
    chrome.runtime.sendMessage({
        type: 'ROUND_EVENT',
        roundId,
        event,
        data
    }).catch(() => {});
}

function findPendingReviewTask(message) {
    if (message.requestId && pendingReviewTasks.has(message.requestId)) {
        return pendingReviewTasks.get(message.requestId);
    }
    if (!message.model) return null;
    for (const task of pendingReviewTasks.values()) {
        if (task.judgeModel === message.model) return task;
    }
    return null;
}

function clearPendingReviewTask(requestId, keepTimer = false) {
    const task = pendingReviewTasks.get(requestId);
    if (!task) return;
    if (!keepTimer && task.timeoutId) {
        clearTimeout(task.timeoutId);
    }
    pendingReviewTasks.delete(requestId);
}

function cleanupPendingTaskByEvaluationId(evaluationId) {
    for (const [requestId, task] of pendingReviewTasks.entries()) {
        if (task.evaluationId === evaluationId) {
            clearPendingReviewTask(requestId);
        }
    }
}

function buildReviewProgress(evaluations) {
    const total = evaluations.length;
    const done = evaluations.filter((e) => e.status === 'done').length;
    const failed = evaluations.filter((e) => e.status === 'parse_failed' || e.status === 'timeout').length;
    const pending = total - done - failed;
    return { total, done, failed, pending };
}

function mergeSettings(partial) {
    return {
        ...DEFAULT_SETTINGS,
        ...(partial || {}),
        weights: {
            ...DEFAULT_SETTINGS.weights,
            ...((partial && partial.weights) || {})
        }
    };
}

function sanitizeWeights(weights) {
    const merged = {
        ...DEFAULT_SETTINGS.weights,
        ...(weights || {})
    };
    return {
        accuracy: Number(merged.accuracy),
        completeness: Number(merged.completeness),
        actionability: Number(merged.actionability),
        clarity: Number(merged.clarity)
    };
}

function createId(prefix) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function buildSlots(count) {
    const slots = [];
    for (let i = 0; i < count; i += 1) {
        if (i < 26) slots.push(String.fromCharCode(65 + i));
        else slots.push(`A${i - 25}`);
    }
    return slots;
}

function fisherYatesShuffle(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function normalizeSlot(slot) {
    if (!slot) return '';
    return String(slot).trim().toUpperCase();
}

function clamp(value, min, max) {
    if (!isFiniteNumber(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function mean(values) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

function varianceOf(values) {
    if (!Array.isArray(values) || values.length < 2) return 0;
    const mu = mean(values);
    const squared = values.map((value) => (value - mu) ** 2);
    return mean(squared);
}

function std(values) {
    return Math.sqrt(varianceOf(values));
}

function roundTo(value, digits) {
    const base = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * base) / base;
}

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}
