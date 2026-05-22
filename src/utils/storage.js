import {
    DEFAULT_ANALYSIS_PROVIDER,
    normalizeAnalysisProviderConfig
} from './analysis_provider.mjs';

export const RT_SCHEMA_VERSION = 2;
export const RT_KEYS = {
    schemaVersion: 'rt_schema_version',
    roundIndex: 'rt_round_index',
    rounds: 'rt_rounds',
    candidates: 'rt_candidates',
    evaluations: 'rt_evaluations',
    modelState: 'rt_model_state',
    settings: 'rt_settings'
};

export const DEFAULT_SETTINGS = {
    retentionDays: 30,
    selfReviewWeight: 0.2,
    nonSelfWeight: 1.0,
    semanticFallbackEnabled: true,
    semanticFallbackWeight: 0.3,
    semanticFallbackMinConfidence: 0.65,
    templateScoreReminderOnly: true,
    weights: {
        accuracy: 0.4,
        completeness: 0.25,
        actionability: 0.2,
        clarity: 0.15
    },
    scoringScale: '1-10',
    blindReview: true,
    isolationMode: 'reuse_current_chat',
    analysisProvider: { ...DEFAULT_ANALYSIS_PROVIDER },
    reviewPromptTemplate: [
        '你是一名客观中立的评审员。',
        '问题：',
        '{{question}}',
        '',
        '请评估以下匿名答案：',
        '{{answers}}',
        '',
        '评分规则（每个维度 1-10 分）：',
        '- accuracy（准确性）',
        '- completeness（完整性）',
        '- actionability（可执行性）',
        '- clarity（清晰度）',
        '',
        '请按以下权重计算 overall：',
        'accuracy=0.4, completeness=0.25, actionability=0.2, clarity=0.15.',
        '',
        '只输出一个 JSON 对象，并用以下标签包裹：',
        '<EVAL_JSON>{...}</EVAL_JSON>',
        '',
        'JSON 结构：',
        '{',
        '  "scores": [',
        '    {',
        '      "slot": "A",',
        '      "accuracy": 1-10,',
        '      "completeness": 1-10,',
        '      "actionability": 1-10,',
        '      "clarity": 1-10,',
        '      "overall": 1-10,',
        '      "reason": "short reason",',
        '      "evidence": ["point1","point2"]',
        '    }',
        '  ]',
        '}',
        '',
        '不要输出 Markdown。不要在 <EVAL_JSON> 标签外输出任何额外文本。'
    ].join('\n'),
    discussionPromptTemplate: [
        '你将作为圆桌审议成员参与讨论。',
        '问题：',
        '{{question}}',
        '',
        '以下是不同 AI 的候选回答：',
        '{{answers}}',
        '',
        '请完成以下任务：',
        '1) 给出你的综合回答（可直接改进候选观点）；',
        '2) 指出你认为仍不清楚或存在分歧的点；',
        '3) 提出最多 3 个推进讨论的新问题（可选）。',
        '',
        '注意：本模式不需要打分，不需要输出 JSON，可以直接输出自然语言。'
    ].join('\n'),
    reviewMode: 'scoring',
    labelMode: 'blind'
};

const LEGACY_REVIEW_TEMPLATE = [
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
].join('\n');

const LEGACY_DISCUSSION_TEMPLATE = [
    'You are participating in an AI roundtable discussion.',
    'Question:',
    '{{question}}',
    '',
    'Here are candidate responses from different AIs:',
    '{{answers}}',
    '',
    'Please provide:',
    '1) your best consolidated answer,',
    '2) what is still unclear or contested,',
    '3) up to 3 follow-up questions that could move the discussion forward.',
    '',
    'No scoring is required. No JSON is required. Reply in natural language.'
].join('\n');

export function mergeSettings(partial = {}) {
    const merged = {
        ...DEFAULT_SETTINGS,
        ...partial,
        weights: {
            ...DEFAULT_SETTINGS.weights,
            ...(partial.weights || {})
        },
        analysisProvider: normalizeAnalysisProviderConfig(partial.analysisProvider || {})
    };

    merged.reviewPromptTemplate = normalizeTemplateSetting(
        merged.reviewPromptTemplate,
        DEFAULT_SETTINGS.reviewPromptTemplate,
        LEGACY_REVIEW_TEMPLATE
    );
    merged.discussionPromptTemplate = normalizeTemplateSetting(
        merged.discussionPromptTemplate,
        DEFAULT_SETTINGS.discussionPromptTemplate,
        LEGACY_DISCUSSION_TEMPLATE
    );

    return merged;
}

function normalizeTemplateSetting(template, defaultTemplate, legacyTemplate) {
    const current = String(template || '').trim();
    if (!current) {
        return defaultTemplate;
    }

    if (current === legacyTemplate || looksLikeTemplateCorruption(current)) {
        return defaultTemplate;
    }

    return current;
}

function looksLikeTemplateCorruption(template) {
    return [
        '<button id="start-review-btn"',
        '<div id="review-progress">',
        '<div id="result-board">',
        '?/button>',
        '?/div>',
        '?/span>',
        '浣犳',
        '闂',
        '璇峰',
        '鍙',
        '涓嶈'
    ].some((fragment) => template.includes(fragment));
}

export const Storage = {
    get: async (keys) => chrome.storage.local.get(keys),
    set: async (items) => chrome.storage.local.set(items),
    remove: async (keys) => chrome.storage.local.remove(keys)
};

export async function ensureRtState() {
    const current = await Storage.get(Object.values(RT_KEYS));
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
        await Storage.set(patch);
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

export async function getRtBundle() {
    return ensureRtState();
}

export async function getRtSettings() {
    const data = await ensureRtState();
    return data[RT_KEYS.settings];
}

export async function saveRtSettings(patch = {}) {
    const current = await ensureRtState();
    const next = mergeSettings({ ...(current[RT_KEYS.settings] || {}), ...patch });
    await Storage.set({ [RT_KEYS.settings]: next });
    return next;
}

export async function upsertRound(round) {
    const state = await ensureRtState();
    const rounds = { ...(state[RT_KEYS.rounds] || {}) };
    rounds[round.roundId] = round;

    const currentIndex = Array.isArray(state[RT_KEYS.roundIndex]) ? [...state[RT_KEYS.roundIndex]] : [];
    const nextIndex = [round.roundId, ...currentIndex.filter((id) => id !== round.roundId)];

    await Storage.set({
        [RT_KEYS.rounds]: rounds,
        [RT_KEYS.roundIndex]: nextIndex
    });
}

export async function appendCandidate(roundId, candidate) {
    const state = await ensureRtState();
    const rounds = { ...(state[RT_KEYS.rounds] || {}) };
    const candidates = { ...(state[RT_KEYS.candidates] || {}) };
    const round = rounds[roundId];
    if (!round) {
        throw new Error(`Round not found: ${roundId}`);
    }

    candidates[candidate.candidateId] = candidate;
    const nextRound = {
        ...round,
        candidateIds: [...new Set([...(round.candidateIds || []), candidate.candidateId])],
        updatedAt: Date.now()
    };
    rounds[roundId] = nextRound;

    await Storage.set({
        [RT_KEYS.rounds]: rounds,
        [RT_KEYS.candidates]: candidates
    });

    return nextRound;
}

export async function appendEvaluation(roundId, evaluation) {
    const state = await ensureRtState();
    const rounds = { ...(state[RT_KEYS.rounds] || {}) };
    const evaluations = { ...(state[RT_KEYS.evaluations] || {}) };
    const round = rounds[roundId];
    if (!round) {
        throw new Error(`Round not found: ${roundId}`);
    }

    evaluations[evaluation.evaluationId] = evaluation;
    const nextRound = {
        ...round,
        evaluationIds: [...new Set([...(round.evaluationIds || []), evaluation.evaluationId])],
        updatedAt: Date.now()
    };
    rounds[roundId] = nextRound;

    await Storage.set({
        [RT_KEYS.rounds]: rounds,
        [RT_KEYS.evaluations]: evaluations
    });

    return nextRound;
}

export async function cleanupExpiredRounds(retentionDays = DEFAULT_SETTINGS.retentionDays) {
    const state = await ensureRtState();
    const now = Date.now();
    const ttl = retentionDays * 24 * 60 * 60 * 1000;

    const rounds = { ...(state[RT_KEYS.rounds] || {}) };
    const candidates = { ...(state[RT_KEYS.candidates] || {}) };
    const evaluations = { ...(state[RT_KEYS.evaluations] || {}) };
    const index = Array.isArray(state[RT_KEYS.roundIndex]) ? [...state[RT_KEYS.roundIndex]] : [];

    const removedRoundIds = [];
    for (const [roundId, round] of Object.entries(rounds)) {
        if (!round || typeof round.createdAt !== 'number') {
            continue;
        }
        if (now - round.createdAt <= ttl) {
            continue;
        }

        removedRoundIds.push(roundId);
        for (const candidateId of round.candidateIds || []) {
            delete candidates[candidateId];
        }
        for (const evaluationId of round.evaluationIds || []) {
            delete evaluations[evaluationId];
        }
        delete rounds[roundId];
    }

    if (removedRoundIds.length > 0) {
        const removedSet = new Set(removedRoundIds);
        await Storage.set({
            [RT_KEYS.rounds]: rounds,
            [RT_KEYS.candidates]: candidates,
            [RT_KEYS.evaluations]: evaluations,
            [RT_KEYS.roundIndex]: index.filter((id) => !removedSet.has(id))
        });
    }

    return removedRoundIds;
}
