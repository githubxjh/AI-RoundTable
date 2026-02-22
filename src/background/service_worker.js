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
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const DEEPSEEK_API_KEY = 'sk-f2c70e9702cd4036b679f0626d46b5be';
const DEEPSEEK_TIMEOUT_MS = 25000;
const IDLE_STABILIZE_MS = 1500;
const IDLE_MIN_CHARS = 80;
const IDLE_MAX_WAIT_MS = 12000;

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
        'You are a neutral and rigorous evaluator.',
        'Question:',
        '{{question}}',
        '',
        'Evaluate the following anonymized answers:',
        '{{answers}}',
        '',
        'Scoring dimensions (1-10 each): accuracy, completeness, actionability, clarity.',
        'overall = accuracy*0.4 + completeness*0.25 + actionability*0.2 + clarity*0.15',
        '',
        'Output one JSON object wrapped with tags:',
        '<EVAL_JSON>{...}</EVAL_JSON>',
        '',
        'JSON schema:',
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
        'Do not output markdown or any text outside <EVAL_JSON> tags.'
    ].join('\n')
};

const pendingReviewTasks = new Map();

function logReviewTrace(stage, task, extra) {
    const summary = `roundId=${task?.roundId || '-'} evaluationId=${task?.evaluationId || '-'} requestId=${task?.requestId || '-'} judgeModel=${task?.judgeModel || '-'}`;
    if (typeof extra === 'undefined') {
        console.log(`[review:${stage}] ${summary}`);
        return;
    }
    console.log(`[review:${stage}] ${summary}`, extra);
}

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
    const model = String(message.model || '').trim();
    const requestedRoundId = String(message.roundId || '').trim();
    const createRoundIfMissing = Boolean(message.createRoundIfMissing);

    if (!model) {
        return { status: 'error', code: 'invalid_request', message: 'model is required' };
    }
    if (!MODEL_NAMES.includes(model)) {
        return { status: 'error', code: 'invalid_request', message: `Unknown model: ${model}` };
    }

    const state = await ensureRtState();
    const modelState = (state[RT_KEYS.modelState] || {})[model];
    if (!modelState || !String(modelState.lastSummary || '').trim()) {
        return {
            status: 'error',
            code: 'candidate_summary_missing',
            message: `No captured answer for model ${model}`
        };
    }

    let roundId = requestedRoundId;
    let roundCreated = false;
    let workingState = state;

    if (!roundId) {
        if (!createRoundIfMissing) {
            return {
                status: 'error',
                code: 'invalid_request',
                message: 'roundId is required unless createRoundIfMissing=true'
            };
        }

        const question = String(message.questionIfCreate || '').trim() || '\u624b\u52a8\u56de\u5408';
        const targetModels = [...new Set(
            (Array.isArray(message.targetModelsIfCreate) ? message.targetModelsIfCreate : [])
                .map((item) => String(item || '').trim())
                .filter((item) => MODEL_NAMES.includes(item))
        )];

        const createResp = await handleRoundCreate({
            question,
            targetModels: targetModels.length > 0 ? targetModels : MODEL_NAMES
        });

        if (!createResp || createResp.status !== 'round_created' || !createResp.roundId) {
            return {
                status: 'error',
                code: 'invalid_request',
                message: createResp?.message || 'Failed to create round'
            };
        }

        roundId = createResp.roundId;
        roundCreated = true;
        workingState = await ensureRtState();
    }

    const round = (workingState[RT_KEYS.rounds] || {})[roundId];
    if (!round) {
        return {
            status: 'error',
            code: 'round_not_found',
            message: `Round not found: ${roundId}`
        };
    }

    const normalizedAnswerText = normalizeCandidateAnswerText(modelState.lastSummary);
    const rounds = { ...(workingState[RT_KEYS.rounds] || {}) };
    const candidates = { ...(workingState[RT_KEYS.candidates] || {}) };

    const existingCandidate = (round.candidateIds || [])
        .map((candidateId) => candidates[candidateId])
        .find((candidate) => (
            candidate
            && candidate.model === model
            && normalizeCandidateAnswerText(candidate.answerText) === normalizedAnswerText
        ));

    if (existingCandidate) {
        return {
            status: 'candidate_added',
            roundId,
            candidateId: existingCandidate.candidateId,
            candidate: existingCandidate,
            roundCreated,
            duplicate: true
        };
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
    return { status: 'candidate_added', roundId, candidateId, candidate, roundCreated, duplicate: false };
}

function normalizeCandidateAnswerText(text) {
    return String(text || '').replaceAll('\r\n', '\n').trim();
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
            rawParsedScores: [],
            status: 'pending',
            normalizedBy: null,
            normalizeError: null,
            normalizeLatencyMs: null,
            parseSource: null,
            rawSummaryChars: null,
            dispatchAt: null,
            firstIdleAt: null,
            firstGeneratingAt: null,
            lastGeneratingAt: null,
            normalizedAt: null,
            finalizeSource: null,
            finalizedAt: null,
            finalizeAttempts: 0,
            createdAt: Date.now(),
            completedAt: null
        };

        evaluations[evaluationId] = evaluation;
        nextRound.evaluationIds.push(evaluationId);
        dispatchQueue.push({
            evaluationId,
            requestId,
            roundId: nextRound.roundId,
            judgeModel,
            promptText
        });
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
        logReviewTrace('dispatch_start', task);
        const dispatchAt = Date.now();
        await patchEvaluationFields(task.evaluationId, { dispatchAt });

        const tabId = activeTabs[task.judgeModel];
        if (!tabId) {
            skipped += 1;
            logReviewTrace('dispatch_failed', task, { reason: 'judge_tab_unavailable' });
            await markEvaluationFailure(task.evaluationId, 'timeout', 'Judge tab unavailable', { dispatchAt });
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
            logReviewTrace('dispatch_failed', task, { reason: `send_failed:${response.error}` });
            await markEvaluationFailure(task.evaluationId, 'timeout', `Send failed: ${response.error}`, { dispatchAt });
            continue;
        }

        started += 1;
        registerPendingReviewTask({
            requestId: task.requestId,
            evaluationId: task.evaluationId,
            roundId: task.roundId,
            judgeModel: task.judgeModel,
            dispatchAt
        });
        logReviewTrace('dispatch_done', task, { dispatchAt });
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

    pendingReviewTasks.set(task.requestId, {
        ...task,
        lastIdleAt: null,
        lastSummary: '',
        firstIdleAt: task.firstIdleAt || null,
        idleTimerId: null,
        firstGeneratingAt: null,
        lastGeneratingAt: null,
        finalizeAttempts: 0,
        finalizing: false,
        timeoutId
    });
}

function clearIdleFinalizeTimer(task) {
    if (!task?.idleTimerId) return;
    clearTimeout(task.idleTimerId);
    task.idleTimerId = null;
}

function scheduleIdleFinalize(task, reason = 'idle_stable') {
    if (!task || !pendingReviewTasks.has(task.requestId)) return;
    clearIdleFinalizeTimer(task);
    task.idleTimerId = setTimeout(() => {
        finalizeTaskIfReady(task, reason).catch((error) => {
            console.error('Finalize task error:', error);
        });
    }, IDLE_STABILIZE_MS);
}

async function handleReviewStatus(message) {
    const task = findPendingReviewTask(message);
    if (!task) return;
    logReviewTrace('status_update', task, { status: message.status });

    const now = Date.now();
    if (message.status === 'generating') {
        if (!task.firstGeneratingAt) {
            task.firstGeneratingAt = now;
            patchEvaluationFields(task.evaluationId, { firstGeneratingAt: now }).catch(() => {});
        }
        task.lastGeneratingAt = now;
        patchEvaluationFields(task.evaluationId, { lastGeneratingAt: now }).catch(() => {});
        clearIdleFinalizeTimer(task);

        emitRoundEvent(task.roundId, 'review_progress', {
            evaluationId: task.evaluationId,
            judgeModel: task.judgeModel,
            status: 'generating'
        });
        return;
    }

    if (message.status !== 'idle') return;

    const rawResponse = String(message.summary || '');
    const rawResponseTrimmed = rawResponse.trim();
    const firstIdleAt = now;
    if (!task.firstIdleAt) {
        task.firstIdleAt = firstIdleAt;
        await patchEvaluationFields(task.evaluationId, { firstIdleAt });
    }
    task.lastIdleAt = now;
    if (!rawResponseTrimmed) {
        logReviewTrace('idle_empty_summary_ignored', task, { summaryChars: rawResponse.length });
        logReviewTrace('idle_blocked_reason', task, {
            reason: 'idle_empty_summary',
            summaryChars: rawResponse.length
        });
        scheduleIdleFinalize(task, 'idle_empty_summary');
        return;
    }
    task.lastSummary = rawResponse;
    logReviewTrace('idle_deferred', task, { summaryChars: rawResponseTrimmed.length });
    scheduleIdleFinalize(task, 'idle_stable');
}

function getTaskAgeMs(task) {
    if (!task) return 0;
    const startAt = Number(task.dispatchAt || Date.now());
    return Math.max(0, Date.now() - startAt);
}

async function finalizeTaskIfReady(task, trigger = 'idle_stable') {
    if (!task || !pendingReviewTasks.has(task.requestId)) return { ok: false, error: 'task_missing' };
    if (task.finalizing) return { ok: false, error: 'already_finalizing' };

    task.finalizing = true;
    clearIdleFinalizeTimer(task);

    try {
        let rawResponse = String(task.lastSummary || '').trim();
        const ageMs = getTaskAgeMs(task);
        const forceFinalize = trigger === 'timeout_fallback';

        if (!rawResponse) {
            const summaryResult = await resolveModelStateSummaryForTask(task);
            if (summaryResult.ok) {
                rawResponse = summaryResult.summary;
                task.lastSummary = rawResponse;
                logReviewTrace('modelstate_summary_used', task, {
                    sameRequest: summaryResult.sameRequest,
                    uniquePendingByModel: summaryResult.uniquePendingByModel,
                    summaryChars: rawResponse.length,
                    trigger
                });
            } else {
                logReviewTrace('modelstate_summary_unavailable', task, { reason: summaryResult.error, trigger });
            }
        }

        if (!rawResponse) {
            if (!forceFinalize && ageMs < IDLE_MAX_WAIT_MS) {
                logReviewTrace('idle_blocked_reason', task, {
                    reason: 'empty_summary',
                    ageMs,
                    trigger
                });
                scheduleIdleFinalize(task, 'idle_retry_empty');
                return { ok: false, error: 'waiting_for_non_empty_summary' };
            }
            logReviewTrace('idle_blocked_reason', task, {
                reason: 'empty_summary_after_wait',
                ageMs,
                trigger
            });
            clearPendingReviewTask(task.requestId);
            await markEvaluationFailure(task.evaluationId, 'parse_failed', '', {
                normalizeError: 'empty_summary_after_wait',
                finalizeSource: forceFinalize ? 'timeout_fallback' : null,
                finalizedAt: Date.now(),
                finalizeAttempts: task.finalizeAttempts,
                rawSummaryChars: 0
            });
            return { ok: false, error: 'empty_summary_after_wait' };
        }

        if (!forceFinalize && rawResponse.length < IDLE_MIN_CHARS && ageMs < IDLE_MAX_WAIT_MS) {
            logReviewTrace('idle_wait_short_summary', task, { summaryChars: rawResponse.length, ageMs });
            logReviewTrace('idle_blocked_reason', task, {
                reason: 'short_text',
                summaryChars: rawResponse.length,
                ageMs,
                trigger
            });
            scheduleIdleFinalize(task, 'idle_retry_short');
            return { ok: false, error: 'summary_too_short_waiting' };
        }

        task.finalizeAttempts = Number(task.finalizeAttempts || 0) + 1;
        const finalizeResult = await finalizeEvaluationFromSummary(task, rawResponse, { trigger });
        if (finalizeResult.ok) {
            clearPendingReviewTask(task.requestId);
            return finalizeResult;
        }

        if (!forceFinalize && ageMs < IDLE_MAX_WAIT_MS) {
            logReviewTrace('idle_wait_retry', task, { ageMs, error: finalizeResult.error });
            logReviewTrace('idle_blocked_reason', task, {
                reason: 'parse_retry',
                ageMs,
                trigger,
                error: finalizeResult.error || 'parse_failed'
            });
            scheduleIdleFinalize(task, 'idle_retry_failed');
            return finalizeResult;
        }

        clearPendingReviewTask(task.requestId);
        await markEvaluationFailure(task.evaluationId, 'parse_failed', rawResponse, {
            normalizedBy: null,
            normalizeError: finalizeResult.error || 'parse_failed',
            finalizeSource: forceFinalize ? 'timeout_fallback' : null,
            finalizedAt: Date.now(),
            finalizeAttempts: task.finalizeAttempts,
            rawSummaryChars: rawResponse.length
        });
        return finalizeResult;
    } finally {
        if (pendingReviewTasks.has(task.requestId)) {
            const aliveTask = pendingReviewTasks.get(task.requestId);
            if (aliveTask) {
                aliveTask.finalizing = false;
            }
        }
    }
}

async function finalizeEvaluationFromSummary(task, rawResponse, options = {}) {
    const trigger = String(options.trigger || 'idle_stable');

    const state = await ensureRtState();
    const evaluations = state[RT_KEYS.evaluations] || {};
    const rounds = state[RT_KEYS.rounds] || {};
    const evaluation = evaluations[task.evaluationId];
    if (!evaluation) {
        return { ok: false, error: 'evaluation_not_found' };
    }

    const round = rounds[evaluation.roundId];
    const expectedSlots = Object.keys(evaluation.blindMap || {})
        .map((slot) => normalizeSlot(slot))
        .filter(Boolean);
    const weights = sanitizeWeights(round?.config?.weights || DEFAULT_SETTINGS.weights);

    const parseResult = parseEvaluationResponse(rawResponse, {
        expectedSlots,
        weights,
        logContext: task
    });
    if (parseResult.ok) {
        const completedAt = Date.now();
        await completeEvaluation(task.evaluationId, {
            status: 'done',
            rawResponse,
            parsedScores: parseResult.scores,
            rawParsedScores: parseResult.scores,
            normalizedBy: null,
            normalizeError: null,
            normalizeLatencyMs: null,
            parseSource: parseResult.parseSource || null,
            rawSummaryChars: rawResponse.length,
            finalizeSource: 'local_strict',
            finalizedAt: completedAt,
            finalizeAttempts: task.finalizeAttempts,
            completedAt
        });
        logReviewTrace('parse_done', task, {
            scoreRows: parseResult.scores.length,
            parseSource: parseResult.parseSource || null,
            finalizeSource: 'local_strict',
            summaryChars: rawResponse.length,
            trigger
        });
        return { ok: true, finalizeSource: 'local_strict' };
    }

    const rawExtract = extractRawScoreRowsLenient(rawResponse, {
        logContext: task,
        weights
    });

    emitRoundEvent(task.roundId, 'deepseek_normalize_started', {
        evaluationId: task.evaluationId,
        judgeModel: task.judgeModel,
        parseError: parseResult.error || 'parse_failed'
    });
    logReviewTrace('deepseek_normalize_started', task, { parseError: parseResult.error || 'parse_failed' });

    const normalizeStart = Date.now();
    let normalizedResult;
    try {
        normalizedResult = await normalizeWithDeepSeek(rawResponse, evaluation.blindMap || {}, {
            logContext: task
        });
    } catch (error) {
        normalizedResult = { ok: false, error: error.message || String(error) };
    }
    const normalizeLatencyMs = Date.now() - normalizeStart;

    if (!normalizedResult.ok) {
        const failure = buildNormalizeFailureMessage(parseResult.error, normalizedResult.error, null);
        emitRoundEvent(task.roundId, 'deepseek_normalize_failed', {
            evaluationId: task.evaluationId,
            judgeModel: task.judgeModel,
            error: failure,
            normalizeLatencyMs
        });
        logReviewTrace('deepseek_normalize_failed', task, {
            error: failure,
            normalizeLatencyMs
        });
        return { ok: false, error: failure };
    }

    const merged = mergeStructuralScores(rawExtract, normalizedResult.scores, expectedSlots, {
        weights,
        logContext: task
    });
    if (!merged.ok) {
        const failure = buildNormalizeFailureMessage(parseResult.error, 'deepseek_ok', merged.error);
        emitRoundEvent(task.roundId, 'deepseek_normalize_failed', {
            evaluationId: task.evaluationId,
            judgeModel: task.judgeModel,
            error: failure,
            normalizeLatencyMs
        });
        logReviewTrace('deepseek_merge_failed', task, {
            error: failure,
            normalizeLatencyMs
        });
        return { ok: false, error: failure };
    }

    const normalizedAt = Date.now();
    await completeEvaluation(task.evaluationId, {
        status: 'done',
        rawResponse,
        parsedScores: merged.scores,
        rawParsedScores: rawExtract,
        normalizedBy: DEEPSEEK_MODEL,
        normalizeError: null,
        normalizeLatencyMs,
        parseSource: parseResult.parseSource || 'best_candidate',
        rawSummaryChars: rawResponse.length,
        normalizedAt,
        finalizeSource: trigger === 'timeout_fallback' ? 'timeout_fallback' : 'deepseek_structural',
        finalizedAt: normalizedAt,
        finalizeAttempts: task.finalizeAttempts,
        completedAt: normalizedAt
    });

    emitRoundEvent(task.roundId, 'deepseek_normalize_done', {
        evaluationId: task.evaluationId,
        judgeModel: task.judgeModel,
        normalizeLatencyMs,
        scoreRows: merged.scores.length
    });
    logReviewTrace('deepseek_normalize_done', task, {
        normalizeLatencyMs,
        scoreRows: merged.scores.length,
        parseSource: parseResult.parseSource || null,
        summaryChars: rawResponse.length,
        finalizeSource: trigger === 'timeout_fallback' ? 'timeout_fallback' : 'deepseek_structural'
    });
    return { ok: true, finalizeSource: trigger === 'timeout_fallback' ? 'timeout_fallback' : 'deepseek_structural' };
}

async function handleReviewTimeout(requestId) {
    const task = pendingReviewTasks.get(requestId);
    if (!task) return;
    logReviewTrace('timeout', task);
    clearIdleFinalizeTimer(task);

    const fallbackResult = await tryFinalizeFromModelState(task);
    if (fallbackResult.ok) {
        clearPendingReviewTask(requestId);
        return;
    }

    clearPendingReviewTask(requestId);
    await markEvaluationFailure(task.evaluationId, 'timeout', 'Evaluation timed out', {
        normalizeError: fallbackResult.error || null,
        finalizeSource: 'timeout_fallback',
        finalizedAt: Date.now(),
        finalizeAttempts: task.finalizeAttempts,
        rawSummaryChars: String(task.lastSummary || '').trim().length || 0
    });
}

async function tryFinalizeFromModelState(task) {
    const summaryResult = await resolveModelStateSummaryForTask(task);
    if (!summaryResult.ok) {
        if (summaryResult.error === 'modelstate_summary_missing') {
            return { ok: false, error: 'timeout_fallback_no_model_summary' };
        }
        return { ok: false, error: 'timeout_fallback_request_mismatch' };
    }

    task.lastSummary = summaryResult.summary;
    logReviewTrace('timeout_fallback_started', task, {
        sameRequest: summaryResult.sameRequest,
        uniquePendingByModel: summaryResult.uniquePendingByModel,
        summaryChars: summaryResult.summary.length
    });

    const finalizeResult = await finalizeTaskIfReady(task, 'timeout_fallback');
    if (!finalizeResult.ok) {
        return { ok: false, error: finalizeResult.error || 'timeout_fallback_finalize_failed' };
    }
    logReviewTrace('timeout_fallback_done', task, { finalizeSource: finalizeResult.finalizeSource || 'unknown' });
    return { ok: true };
}

async function resolveModelStateSummaryForTask(task) {
    const state = await ensureRtState();
    const modelState = (state[RT_KEYS.modelState] || {})[task.judgeModel] || null;
    const summary = String(modelState?.lastSummary || '').trim();
    if (!summary) {
        return { ok: false, error: 'modelstate_summary_missing' };
    }

    const sameRequest = Boolean(modelState?.requestId) && modelState.requestId === task.requestId;
    const sameModelTasks = [...pendingReviewTasks.values()].filter((item) => item.judgeModel === task.judgeModel);
    const uniquePendingByModel = sameModelTasks.length === 1 && sameModelTasks[0].requestId === task.requestId;
    if (!sameRequest && !uniquePendingByModel) {
        return {
            ok: false,
            error: 'modelstate_request_mismatch',
            sameRequest,
            uniquePendingByModel
        };
    }

    return {
        ok: true,
        summary,
        sameRequest,
        uniquePendingByModel
    };
}

async function completeEvaluation(evaluationId, patch) {
    const updated = await patchEvaluationFields(evaluationId, patch);
    if (!updated) return;
    await recomputeRoundRanking(updated.roundId);
}

async function patchEvaluationFields(evaluationId, patch) {
    const state = await ensureRtState();
    const evaluations = { ...(state[RT_KEYS.evaluations] || {}) };
    const evaluation = evaluations[evaluationId];
    if (!evaluation) return null;

    evaluations[evaluationId] = {
        ...evaluation,
        ...patch
    };

    await chrome.storage.local.set({ [RT_KEYS.evaluations]: evaluations });
    return evaluations[evaluationId];
}

async function markEvaluationFailure(evaluationId, status, rawResponse, extraPatch = {}) {
    await completeEvaluation(evaluationId, {
        ...extraPatch,
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

function parseEvaluationResponse(text, options = {}) {
    if (!text || typeof text !== 'string') {
        return { ok: false, error: 'Empty response' };
    }

    const expectedSlots = [...new Set(
        (Array.isArray(options.expectedSlots) ? options.expectedSlots : [])
            .map((slot) => normalizeSlot(slot))
            .filter(Boolean)
    )];
    const weights = sanitizeWeights(options.weights || DEFAULT_SETTINGS.weights);
    const logContext = options.logContext || null;

    const candidates = extractEvalJsonCandidates(text);
    if (candidates.length === 0) {
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            candidates.push(text.slice(firstBrace, lastBrace + 1).trim());
        }
    }
    if (candidates.length === 0) {
        return { ok: false, error: 'Missing JSON payload' };
    }

    const selected = parseEvaluationCandidates(candidates, {
        expectedSlots,
        weights,
        logContext
    });
    if (!selected.ok) {
        return {
            ok: false,
            error: selected.error || 'No valid score rows',
            parseSource: selected.parseSource || null
        };
    }

    if (expectedSlots.length > 0 && selected.missingSlots.length > 0) {
        logReviewTrace('parse_missing_slots', logContext || {}, { missingSlots: selected.missingSlots });
        return {
            ok: false,
            error: `Missing expected slots: ${selected.missingSlots.join(', ')}`,
            parseSource: selected.parseSource || null,
            candidateText: selected.candidateText || ''
        };
    }

    return {
        ok: true,
        scores: selected.scores,
        parseSource: selected.parseSource || null,
        candidateText: selected.candidateText || ''
    };
}

function extractEvalJsonCandidates(text) {
    const source = String(text || '');
    if (!source.trim()) return [];

    const tagRegex = /<EVAL_JSON>([\s\S]*?)<\/EVAL_JSON>/gi;
    const tagged = [...source.matchAll(tagRegex)]
        .map((match) => String(match[1] || '').trim())
        .filter(Boolean);
    if (tagged.length > 0) {
        return tagged;
    }
    return [];
}

function parseEvaluationCandidates(candidates, options = {}) {
    let best = null;
    let lastError = 'No valid score rows';
    const logContext = options.logContext || null;

    candidates.forEach((candidateText, index) => {
        const parsed = parseEvaluationCandidatePayload(candidateText, {
            ...options,
            strictExpectedCoverage: false
        });
        if (!parsed.ok) {
            lastError = parsed.error || lastError;
            return;
        }

        const contender = {
            ...parsed,
            candidateText,
            candidateIndex: index,
            templateLike: isTemplateScoreCandidate(candidateText, parsed.scores),
            reasonRichness: countRichReasonRows(parsed.scores)
        };
        if (!best) {
            best = contender;
            return;
        }
        if (isBetterEvaluationCandidate(contender, best)) {
            best = contender;
        }
    });

    if (!best) {
        return { ok: false, error: lastError };
    }

    logReviewTrace('parse_candidate_selected', logContext || {}, {
        candidateCount: candidates.length,
        candidateIndex: best.candidateIndex,
        coverage: best.coverage,
        templateLike: best.templateLike,
        reasonRichness: best.reasonRichness
    });

    return {
        ok: true,
        scores: best.scores,
        coverage: best.coverage,
        missingSlots: best.missingSlots,
        candidateText: best.candidateText,
        parseSource: candidates.length > 1 ? (best.templateLike ? 'best_candidate_template' : 'best_candidate') : 'first_tag'
    };
}

function isBetterEvaluationCandidate(contender, current) {
    if (!current) return true;
    if ((contender.coverage || 0) !== (current.coverage || 0)) {
        return (contender.coverage || 0) > (current.coverage || 0);
    }
    if (Boolean(contender.templateLike) !== Boolean(current.templateLike)) {
        return !Boolean(contender.templateLike);
    }
    if ((contender.reasonRichness || 0) !== (current.reasonRichness || 0)) {
        return (contender.reasonRichness || 0) > (current.reasonRichness || 0);
    }
    return (contender.candidateIndex || 0) > (current.candidateIndex || 0);
}

function countRichReasonRows(scores) {
    const rows = Array.isArray(scores) ? scores : [];
    return rows.filter((row) => String(row?.reason || '').trim().length >= 12).length;
}

function isTemplateScoreCandidate(candidateText, scores) {
    const normalized = String(candidateText || '').trim().toLowerCase();
    if (!normalized) return false;

    if (
        normalized.includes('"reason": "short reason"')
        || normalized.includes('"reason":"short reason"')
    ) {
        return true;
    }
    if (
        normalized.includes('"evidence": ["point1", "point2"]')
        || normalized.includes('"evidence":["point1","point2"]')
    ) {
        return true;
    }
    if (normalized.includes('json schema') && normalized.includes('scores')) {
        return true;
    }

    const rows = Array.isArray(scores) ? scores : [];
    if (rows.length === 0) return false;

    const reasonTemplateRows = rows.filter((row) => String(row?.reason || '').trim().toLowerCase() === 'short reason').length;
    const evidenceTemplateRows = rows.filter((row) => {
        if (!Array.isArray(row?.evidence)) return false;
        const normalizedEvidence = row.evidence.map((item) => String(item || '').trim().toLowerCase());
        return normalizedEvidence.length >= 2 && normalizedEvidence[0] === 'point1' && normalizedEvidence[1] === 'point2';
    }).length;

    if (reasonTemplateRows === rows.length) return true;
    if (evidenceTemplateRows === rows.length) return true;
    return false;
}

function parseEvaluationCandidatePayload(jsonText, options = {}) {
    if (!jsonText || typeof jsonText !== 'string') {
        return { ok: false, error: 'Missing candidate JSON payload' };
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (error) {
        return { ok: false, error: `JSON parse error: ${error.message}` };
    }

    const expectedSlots = [...new Set(
        (Array.isArray(options.expectedSlots) ? options.expectedSlots : [])
            .map((slot) => normalizeSlot(slot))
            .filter(Boolean)
    )];
    const expectedSet = expectedSlots.length > 0 ? new Set(expectedSlots) : null;
    const weights = sanitizeWeights(options.weights || DEFAULT_SETTINGS.weights);
    const logContext = options.logContext || null;
    const strictExpectedCoverage = options.strictExpectedCoverage !== false;

    const rows = Array.isArray(parsed?.scores) ? parsed.scores : null;
    if (!rows) {
        return { ok: false, error: 'scores[] not found' };
    }

    const normalizedRows = [];
    const seenSlots = new Set();

    rows.forEach((row, index) => {
        const slot = normalizeSlot(row?.slot);
        if (!slot) {
            logRejectedScoreRow(logContext, index, 'missing_slot', row);
            return;
        }
        if (expectedSet && !expectedSet.has(slot)) {
            logRejectedScoreRow(logContext, index, `unexpected_slot:${slot}`, row);
            return;
        }
        if (seenSlots.has(slot)) {
            logRejectedScoreRow(logContext, index, `duplicate_slot:${slot}`, row);
            return;
        }

        const accuracy = coerceScore10(row?.accuracy);
        if (accuracy === null) {
            logRejectedScoreRow(logContext, index, `invalid_accuracy:${slot}`, row);
            return;
        }

        const completeness = coerceScore10(row?.completeness);
        if (completeness === null) {
            logRejectedScoreRow(logContext, index, `invalid_completeness:${slot}`, row);
            return;
        }

        const actionability = coerceScore10(row?.actionability);
        if (actionability === null) {
            logRejectedScoreRow(logContext, index, `invalid_actionability:${slot}`, row);
            return;
        }

        const clarity = coerceScore10(row?.clarity);
        if (clarity === null) {
            logRejectedScoreRow(logContext, index, `invalid_clarity:${slot}`, row);
            return;
        }

        const computedOverall = computeWeightedOverall({
            accuracy,
            completeness,
            actionability,
            clarity
        }, weights);
        const parsedOverall = coerceScore10(row?.overall);
        const overallProvided = hasProvidedValue(row?.overall);
        const overall = parsedOverall === null ? computedOverall : parsedOverall;
        if (overallProvided && parsedOverall === null) {
            logRejectedScoreRow(logContext, index, `invalid_overall_recomputed:${slot}`, row);
        }

        normalizedRows.push({
            slot,
            accuracy,
            completeness,
            actionability,
            clarity,
            overall,
            reason: String(row?.reason || ''),
            evidence: Array.isArray(row?.evidence) ? row.evidence.slice(0, 3).map((item) => String(item)) : []
        });
        seenSlots.add(slot);
    });

    if (normalizedRows.length === 0) {
        return { ok: false, error: 'No valid score rows' };
    }

    const missingSlots = expectedSlots.filter((slot) => !seenSlots.has(slot));
    const coverage = expectedSlots.length > 0 ? expectedSlots.length - missingSlots.length : normalizedRows.length;
    if (expectedSlots.length > 0) {
        normalizedRows.sort((a, b) => expectedSlots.indexOf(a.slot) - expectedSlots.indexOf(b.slot));
    }

    if (strictExpectedCoverage && missingSlots.length > 0) {
        return { ok: false, error: `Missing expected slots: ${missingSlots.join(', ')}` };
    }

    return {
        ok: true,
        scores: normalizedRows,
        coverage,
        missingSlots
    };
}

function extractRawScoreRowsLenient(text, options = {}) {
    const source = String(text || '');
    if (!source.trim()) return [];

    const weights = sanitizeWeights(options.weights || DEFAULT_SETTINGS.weights);
    const logContext = options.logContext || null;

    const candidates = extractEvalJsonCandidates(source);
    let baseText = source;
    if (candidates.length > 0) {
        const selected = parseEvaluationCandidates(candidates, { weights, logContext });
        if (selected.ok) {
            return selected.scores;
        }
        baseText = candidates[candidates.length - 1] || source;
    }

    const parsed = parseEvaluationResponse(baseText, {
        weights,
        logContext
    });
    if (parsed.ok) {
        return parsed.scores;
    }

    const slotMatches = [...baseText.matchAll(/["'`]?slot["'`]?\s*[:\uFF1A]\s*["'`]?([A-Za-z][A-Za-z0-9]*)["'`]?/gim)];
    if (slotMatches.length === 0) {
        logReviewTrace('lenient_extract_empty', logContext || {}, { reason: 'slot_not_found' });
        return [];
    }

    const rows = [];
    const seenSlots = new Set();

    for (let index = 0; index < slotMatches.length; index += 1) {
        const slot = normalizeSlot(slotMatches[index]?.[1]);
        if (!slot || seenSlots.has(slot)) continue;

        const start = Number(slotMatches[index].index || 0);
        const end = index + 1 < slotMatches.length
            ? Number(slotMatches[index + 1].index || baseText.length)
            : baseText.length;
        const segment = baseText.slice(start, end);

        const row = buildLenientRowFromSegment(slot, segment, weights);
        if (!row) {
            logRejectedScoreRow(logContext, index, `lenient_row_invalid:${slot}`, {
                slot,
                segment: segment.slice(0, 180)
            });
            continue;
        }

        rows.push(row);
        seenSlots.add(slot);
    }

    if (rows.length === 0) {
        logReviewTrace('lenient_extract_empty', logContext || {}, { reason: 'no_valid_rows' });
    } else {
        logReviewTrace('lenient_extract_ok', logContext || {}, { rowCount: rows.length });
    }

    return rows;
}

function buildLenientRowFromSegment(slot, segment, weights) {
    const accuracy = extractLenientScore(segment, 'accuracy');
    const completeness = extractLenientScore(segment, 'completeness');
    const actionability = extractLenientScore(segment, 'actionability');
    const clarity = extractLenientScore(segment, 'clarity');
    const overall = extractLenientScore(segment, 'overall');
    const reason = extractLenientReason(segment);
    const evidence = extractLenientEvidence(segment);

    const hasAnyScore = [accuracy, completeness, actionability, clarity, overall].some((value) => value !== null);
    if (!hasAnyScore && !reason && evidence.length === 0) {
        return null;
    }

    const next = {
        slot,
        accuracy,
        completeness,
        actionability,
        clarity,
        overall,
        reason,
        evidence
    };

    if (
        next.overall === null
        && next.accuracy !== null
        && next.completeness !== null
        && next.actionability !== null
        && next.clarity !== null
    ) {
        next.overall = computeWeightedOverall(next, weights);
    }

    return next;
}

function extractLenientScore(segment, key) {
    const raw = extractLenientFieldValue(segment, key);
    if (raw === null) return null;
    return coerceScore10(raw);
}

function extractLenientReason(segment) {
    const reason = extractLenientFieldValue(segment, 'reason');
    if (reason === null) return '';
    return String(reason).replace(/\s+/g, ' ').trim();
}

function extractLenientEvidence(segment) {
    const evidenceArrayMatch = segment.match(/["'`]?evidence["'`]?\s*[:\uFF1A]\s*\[([\s\S]*?)\]/i);
    if (evidenceArrayMatch) {
        const body = String(evidenceArrayMatch[1] || '');
        const quoted = [...body.matchAll(/"([^"]*)"|'([^']*)'/g)]
            .map((item) => String(item[1] || item[2] || '').trim())
            .filter(Boolean);
        if (quoted.length > 0) {
            return quoted.slice(0, 3);
        }
        return body
            .split(/[,\n\r]/)
            .map((item) => normalizeLenientValueToken(item))
            .filter(Boolean)
            .slice(0, 3);
    }

    const scalar = extractLenientFieldValue(segment, 'evidence');
    if (scalar === null) return [];
    const text = String(scalar).trim();
    return text ? [text] : [];
}

function extractLenientFieldValue(segment, key) {
    const escapedKey = escapeRegExp(key);
    const match = segment.match(new RegExp(
        `["'\`]?${escapedKey}["'\`]?\\s*[:\\uFF1A]\\s*("([^"\\\\]|\\\\.)*"|'([^'\\\\]|\\\\.)*'|[^,\\n\\r}\\]]+)`,
        'i'
    ));
    if (!match) return null;
    return normalizeLenientValueToken(match[1] || '');
}

function normalizeLenientValueToken(token) {
    let value = String(token || '').trim();
    if (!value) return '';
    if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\''))
        || (value.startsWith('`') && value.endsWith('`'))
    ) {
        value = value.slice(1, -1);
    }
    return value.trim();
}

function mergeStructuralScores(rawRows, deepseekRows, expectedSlots, options = {}) {
    const weights = sanitizeWeights(options.weights || DEFAULT_SETTINGS.weights);
    const logContext = options.logContext || null;
    const slots = [...new Set((expectedSlots || []).map((slot) => normalizeSlot(slot)).filter(Boolean))];
    if (slots.length === 0) {
        return { ok: false, error: 'merge_missing_expected_slots' };
    }

    const rawBySlot = new Map();
    for (const row of Array.isArray(rawRows) ? rawRows : []) {
        const slot = normalizeSlot(row?.slot);
        if (!slot || rawBySlot.has(slot)) continue;
        rawBySlot.set(slot, row);
    }

    const deepseekBySlot = new Map();
    for (const row of Array.isArray(deepseekRows) ? deepseekRows : []) {
        const slot = normalizeSlot(row?.slot);
        if (!slot || deepseekBySlot.has(slot)) continue;
        deepseekBySlot.set(slot, row);
    }

    const merged = [];
    for (const slot of slots) {
        const deepseekRow = deepseekBySlot.get(slot);
        if (!deepseekRow) {
            logReviewTrace('deepseek_merge_missing_slot', logContext || {}, { slot });
            return { ok: false, error: `merge_missing_slot:${slot}` };
        }

        const rawRow = rawBySlot.get(slot) || {};
        const accuracy = coerceScore10(rawRow.accuracy) ?? coerceScore10(deepseekRow.accuracy);
        const completeness = coerceScore10(rawRow.completeness) ?? coerceScore10(deepseekRow.completeness);
        const actionability = coerceScore10(rawRow.actionability) ?? coerceScore10(deepseekRow.actionability);
        const clarity = coerceScore10(rawRow.clarity) ?? coerceScore10(deepseekRow.clarity);
        if (accuracy === null || completeness === null || actionability === null || clarity === null) {
            return { ok: false, error: `merge_invalid_metrics:${slot}` };
        }

        const overall = (
            coerceScore10(rawRow.overall)
            ?? coerceScore10(deepseekRow.overall)
            ?? computeWeightedOverall({ accuracy, completeness, actionability, clarity }, weights)
        );
        const reason = String(rawRow.reason || '').trim();
        const evidence = Array.isArray(rawRow.evidence)
            ? rawRow.evidence.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
            : [];

        merged.push({
            slot,
            accuracy,
            completeness,
            actionability,
            clarity,
            overall,
            reason,
            evidence
        });
    }

    return { ok: true, scores: merged };
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function coerceScore10(value) {
    if (typeof value === 'undefined' || value === null) {
        return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return normalizeNumericScore(value);
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const fraction = raw.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (fraction) {
        const numerator = Number(fraction[1]);
        const denominator = Number(fraction[2]);
        if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
            return normalizeNumericScore((numerator / denominator) * 10);
        }
    }

    const percent = raw.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
    if (percent) {
        return normalizeNumericScore(Number(percent[1]) / 10);
    }

    const chineseScore = raw.match(/^(-?\d+(?:\.\d+)?)\s*\u5206?$/);
    if (chineseScore) {
        return normalizeNumericScore(Number(chineseScore[1]));
    }

    const outOfTen = raw.match(/^(-?\d+(?:\.\d+)?)\s*(?:out\s*of)\s*10$/i);
    if (outOfTen) {
        return normalizeNumericScore(Number(outOfTen[1]));
    }

    const numeric = Number(raw.replaceAll(',', ''));
    if (Number.isFinite(numeric)) {
        return normalizeNumericScore(numeric);
    }

    return null;
}

function normalizeNumericScore(value) {
    if (!Number.isFinite(value)) return null;
    let normalized = Number(value);
    if (normalized > 0 && normalized <= 1) {
        normalized *= 10;
    }
    if (normalized < 1 || normalized > 10) {
        return null;
    }
    return roundTo(normalized, 4);
}

function hasProvidedValue(value) {
    if (typeof value === 'undefined' || value === null) return false;
    return String(value).trim() !== '';
}

function computeWeightedOverall(row, weights) {
    return roundTo(
        row.accuracy * weights.accuracy
        + row.completeness * weights.completeness
        + row.actionability * weights.actionability
        + row.clarity * weights.clarity,
        4
    );
}

function logRejectedScoreRow(logContext, index, reason, row) {
    const preview = String(JSON.stringify(row || {})).slice(0, 220);
    logReviewTrace('parse_row_rejected', logContext || {}, {
        rowIndex: index,
        reason,
        rowPreview: preview
    });
}

function buildNormalizeFailureMessage(localParseError, deepseekError, mergeError) {
    const local = String(localParseError || 'local_parse_failed').trim();
    const remote = String(deepseekError || 'deepseek_not_run').trim();
    const merge = String(mergeError || 'merge_not_run').trim();
    return `${local} | ${remote} | ${merge}`;
}

async function normalizeWithDeepSeek(rawText, blindMapSlots, options = {}) {
    const slots = [...new Set(
        (Array.isArray(blindMapSlots) ? blindMapSlots : Object.keys(blindMapSlots || {}))
            .map((slot) => normalizeSlot(slot))
            .filter(Boolean)
    )];
    if (slots.length === 0) {
        return { ok: false, error: 'No blind-map slots available for normalization' };
    }

    const truncatedRaw = String(rawText || '').slice(0, 20000);
    const systemPrompt = [
        'You are a strict structural normalizer for AI evaluation outputs.',
        'Return JSON only.',
        'Output schema: {"scores":[{"slot":"A","accuracy":8,"completeness":8,"actionability":8,"clarity":8,"overall":8}]}',
        'Do not output markdown, comments, or explanations.',
        'Only use slots from the provided slot list.',
        'All slots must be present exactly once.',
        'All numeric fields must be numbers in range 1-10.',
        'Do not rewrite or summarize any reason/evidence text. If unavailable, omit reason/evidence.'
    ].join('\n');

    const userPrompt = [
        `Allowed slots: ${slots.join(', ')}`,
        'Normalize the following raw evaluation text into strict JSON.',
        '',
        'RAW_EVALUATION_TEXT_START',
        truncatedRaw,
        'RAW_EVALUATION_TEXT_END'
    ].join('\n');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(DEEPSEEK_API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                temperature: 0,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ]
            }),
            signal: controller.signal
        });
    } catch (error) {
        if (error?.name === 'AbortError') {
            return { ok: false, error: `DeepSeek timeout after ${DEEPSEEK_TIMEOUT_MS}ms` };
        }
        return { ok: false, error: `DeepSeek request failed: ${error.message || String(error)}` };
    } finally {
        clearTimeout(timeoutId);
    }

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
            ok: false,
            error: `DeepSeek HTTP ${response.status}: ${String(body || '').slice(0, 240)}`
        };
    }

    let data;
    try {
        data = await response.json();
    } catch (error) {
        return { ok: false, error: `DeepSeek JSON decode failed: ${error.message}` };
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
        return { ok: false, error: 'DeepSeek response missing choices[0].message.content' };
    }

    return parseDeepSeekNormalization(content, slots, options);
}

function parseDeepSeekNormalization(text, slots, options = {}) {
    const allowedSlots = [...new Set((slots || []).map((slot) => normalizeSlot(slot)).filter(Boolean))];
    if (allowedSlots.length === 0) {
        return { ok: false, error: 'No allowed slots provided' };
    }

    const base = parseEvaluationResponse(text, {
        expectedSlots: allowedSlots,
        logContext: options.logContext || null
    });
    if (!base.ok) {
        return { ok: false, error: base.error || 'Invalid DeepSeek normalization payload' };
    }

    const rowBySlot = new Map((base.scores || []).map((row) => [normalizeSlot(row.slot), row]));
    const normalizedScores = allowedSlots.map((slot) => {
        const row = rowBySlot.get(slot);
        if (!row) return null;
        return {
            slot,
            accuracy: row.accuracy,
            completeness: row.completeness,
            actionability: row.actionability,
            clarity: row.clarity,
            overall: row.overall,
            reason: '',
            evidence: []
        };
    }).filter(Boolean);
    if (normalizedScores.length !== allowedSlots.length) {
        return { ok: false, error: 'DeepSeek normalized payload missing required slots' };
    }

    return { ok: true, scores: normalizedScores };
}

function renderPrompt(template, vars) {
    return String(template || '')
        .replaceAll('{{question}}', vars.question || '')
        .replaceAll('{{answers}}', vars.answers || '');
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
    if (message.requestId) {
        const exact = pendingReviewTasks.get(message.requestId);
        if (exact) return exact;

        if (!message.model) return null;
        const sameModel = [...pendingReviewTasks.values()].filter((task) => task.judgeModel === message.model);
        if (sameModel.length === 1) {
            logReviewTrace('requestId_miss_fallback_hit', sameModel[0], {
                requestId: message.requestId,
                model: message.model
            });
            return sameModel[0];
        }
        if (sameModel.length > 1) {
            logReviewTrace('requestId_miss_fallback_ambiguous', sameModel[0], {
                requestId: message.requestId,
                model: message.model,
                pendingCount: sameModel.length
            });
        }
        return null;
    }

    if (!message.model) return null;

    const matches = [];
    for (const task of pendingReviewTasks.values()) {
        if (task.judgeModel === message.model) {
            matches.push(task);
        }
    }
    if (matches.length === 1) {
        return matches[0];
    }
    return null;
}

function clearPendingReviewTask(requestId, keepTimer = false) {
    const task = pendingReviewTasks.get(requestId);
    if (!task) return;
    clearIdleFinalizeTimer(task);
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

