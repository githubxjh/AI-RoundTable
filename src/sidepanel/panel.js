import { DEFAULT_SETTINGS, getRtSettings, saveRtSettings } from '../utils/storage.js';

const MODEL_CARD_MAP = {
    ChatGPT: 'card-gpt',
    Claude: 'card-claude',
    Grok: 'card-grok',
    Gemini: 'card-gemini',
    Doubao: 'card-doubao'
};

const FIXED_WEIGHTS = {
    accuracy: 0.4,
    completeness: 0.25,
    actionability: 0.2,
    clarity: 0.15
};

const PRESETS = {
    'red-teaming': '请作为严格评审者，指出上面方案最大的漏洞和风险。',
    'fact-check': '请核实上面观点中的事实、数据和时效性，标出可疑点。',
    'trade-off': '请分析该方案的收益、机会成本和潜在副作用。',
    'execution': '请把这个思路整理成可执行的分步计划与时间节点。'
};

const state = {
    quoteList: [],
    activeRoundId: null,
    activeRound: null,
    settings: { ...DEFAULT_SETTINGS },
    latestReviewProgress: null
};

const refs = {};

document.addEventListener('DOMContentLoaded', async () => {
    bindRefs();
    bindEvents();
    await initializeSettings();
    await loadLatestRound();
    renderQuoteList();
    updateRouteExclusions();
    renderRound();
    renderReviewProgress();
    renderJudgeStatusList();
    renderResultBoard();
});

function bindRefs() {
    refs.globalInput = document.getElementById('global-input');
    refs.broadcastBtn = document.getElementById('broadcast-btn');
    refs.quoteList = document.getElementById('quote-list');
    refs.clearQuotesBtn = document.getElementById('clear-quotes');
    refs.routerInput = document.getElementById('router-input');
    refs.routeBtn = document.getElementById('route-btn');
    refs.reviewTemplate = document.getElementById('review-template');
    refs.resetTemplateBtn = document.getElementById('reset-template-btn');
    refs.startReviewBtn = document.getElementById('start-review-btn');
    refs.reviewProgress = document.getElementById('review-progress');
    refs.judgeStatusList = document.getElementById('judge-status-list');
    refs.resultBoard = document.getElementById('result-board');
    refs.roundId = document.getElementById('round-id');
    refs.roundStatus = document.getElementById('round-status');
    refs.roundCandidateCount = document.getElementById('round-candidate-count');
    refs.roundCreatedAt = document.getElementById('round-created-at');
    refs.roundQuestion = document.getElementById('round-question');
    refs.deleteRoundBtn = document.getElementById('delete-round-btn');
}

function bindEvents() {
    refs.broadcastBtn.addEventListener('click', onBroadcast);
    refs.clearQuotesBtn.addEventListener('click', onClearQuotes);
    refs.routeBtn.addEventListener('click', onRoute);
    refs.resetTemplateBtn.addEventListener('click', onResetTemplate);
    refs.startReviewBtn.addEventListener('click', onStartReview);
    refs.deleteRoundBtn.addEventListener('click', onDeleteRound);

    refs.reviewTemplate.addEventListener('change', () => {
        saveRtSettings({ reviewPromptTemplate: refs.reviewTemplate.value }).catch(console.error);
    });

    document.addEventListener('click', (event) => {
        const target = event.target;

        if (target.classList.contains('btn-quote')) {
            const source = target.dataset.source;
            const card = target.closest('.ai-card');
            const bodyText = card?.querySelector('.card-body')?.innerText || '';
            addQuote(source, bodyText);
            return;
        }

        if (target.classList.contains('btn-candidate')) {
            const model = target.dataset.model;
            onAddCandidate(model);
            return;
        }

        if (target.classList.contains('quote-close')) {
            const index = Number(target.closest('.quote-item')?.dataset.index);
            removeQuote(index);
            return;
        }

        if (target.classList.contains('chip')) {
            const presetKey = target.dataset.preset;
            if (PRESETS[presetKey]) {
                refs.routerInput.value = PRESETS[presetKey];
                refs.routerInput.focus();
            }
            return;
        }

        const header = target.closest('.card-header');
        if (header) {
            const card = header.closest('.ai-card');
            const model = getModelFromCard(card?.id);
            if (model) {
                sendMessage({ type: 'ACTIVATE_TAB', model }).catch(console.error);
            }
        }
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (!message || !message.type) return;
        if (message.type === 'STATUS_UPDATE') {
            updateCard(message.model, message.status, message.summary);
            return;
        }
        if (message.type === 'ROUND_EVENT') {
            onRoundEvent(message);
        }
    });
}

async function initializeSettings() {
    try {
        state.settings = await getRtSettings();
    } catch (error) {
        console.warn('Failed to load settings, using defaults', error);
        state.settings = { ...DEFAULT_SETTINGS };
    }

    const currentTemplate = String(state.settings.reviewPromptTemplate || '');
    // Backward compatibility + self-heal: migrate old template or reset if HTML fragment polluted this field.
    const shouldResetTemplate =
        currentTemplate.includes('You are an impartial evaluator.')
        || currentTemplate.includes('<button id="start-review-btn"')
        || currentTemplate.includes('<div id="review-progress">')
        || currentTemplate.includes('<div id="result-board">')
        || currentTemplate.includes('?/button>')
        || currentTemplate.includes('?/div>')
        || currentTemplate.includes('?/span>');

    if (shouldResetTemplate) {
        state.settings.reviewPromptTemplate = DEFAULT_SETTINGS.reviewPromptTemplate;
        saveRtSettings({ reviewPromptTemplate: DEFAULT_SETTINGS.reviewPromptTemplate }).catch(console.error);
    }

    refs.reviewTemplate.value = state.settings.reviewPromptTemplate || DEFAULT_SETTINGS.reviewPromptTemplate;
}

async function loadLatestRound() {
    try {
        const listResp = await sendMessage({ type: 'ROUND_LIST', limit: 1 });
        const rounds = Array.isArray(listResp?.rounds) ? listResp.rounds : [];
        if (rounds.length === 0) {
            await setActiveRound(null);
            return;
        }
        await setActiveRound(rounds[0].roundId);
    } catch (error) {
        console.error('Failed to load latest round:', error);
        await setActiveRound(null);
    }
}

async function setActiveRound(roundId) {
    if (!roundId) {
        state.activeRoundId = null;
        state.activeRound = null;
        renderRound();
        renderReviewProgress();
        renderJudgeStatusList();
        renderResultBoard();
        syncCandidateButtons();
        return;
    }

    const response = await sendMessage({ type: 'ROUND_GET', roundId });
    if (!response || response.status !== 'ok') {
        throw new Error(response?.message || 'ROUND_GET failed');
    }

    state.activeRoundId = roundId;
    state.activeRound = response.round;
    renderRound();
    renderReviewProgress();
    renderJudgeStatusList();
    renderResultBoard();
    syncCandidateButtons();
}

async function ensureRoundForBroadcast(question, targetModels) {
    if (state.activeRoundId && state.activeRound) {
        if (state.activeRound.status === 'collecting' || state.activeRound.status === 'reviewing') {
            return state.activeRoundId;
        }
    }

    const resp = await sendMessage({
        type: 'ROUND_CREATE',
        question,
        targetModels
    });

    if (resp?.status !== 'round_created') {
        throw new Error(resp?.message || 'Failed to create round');
    }

    await setActiveRound(resp.roundId);
    return resp.roundId;
}

async function onBroadcast() {
    const text = String(refs.globalInput.value || '').trim();
    if (!text) {
        alert('请先输入问题');
        return;
    }

    const targets = getCheckedValues('.target-selector input[type="checkbox"]');
    if (targets.length === 0) {
        alert('请至少选择一个目标模型');
        return;
    }

    refs.broadcastBtn.disabled = true;
    try {
        await ensureRoundForBroadcast(text, targets);
        await sendMessage({
            type: 'BROADCAST',
            text,
            targets
        });
    } catch (error) {
        console.error(error);
        alert(`Broadcast 失败: ${error.message}`);
    } finally {
        refs.broadcastBtn.disabled = false;
    }
}

function getManualRoundQuestion() {
    return String(refs.globalInput?.value || '').trim() || '手动回合';
}

function getManualRoundTargetModels() {
    const selected = getCheckedValues('.target-selector input[type="checkbox"]');
    return selected.length > 0 ? selected : Object.keys(MODEL_CARD_MAP);
}

async function resolveRoundForCandidate() {
    if (!state.activeRoundId || !state.activeRound) {
        return { roundId: null, createRoundIfMissing: true };
    }

    const status = String(state.activeRound.status || '').trim().toLowerCase();
    if (status === 'collecting') {
        return { roundId: state.activeRoundId, createRoundIfMissing: false };
    }

    if (['reviewing', 'completed', 'failed'].includes(status)) {
        const createNewRound = confirm(
            '当前回合正在评审或已结束。\n确定：新建回合并加入候选\n取消：继续加入当前回合'
        );
        if (createNewRound) {
            return { roundId: null, createRoundIfMissing: true };
        }
        return { roundId: state.activeRoundId, createRoundIfMissing: false };
    }

    return { roundId: state.activeRoundId, createRoundIfMissing: false };
}

function getCandidateAddErrorMessage(response) {
    const code = String(response?.code || '').trim().toLowerCase();

    if (code === 'candidate_summary_missing') {
        return '该模型暂无可抓取回答。请先到对应官网完成一轮回复，再点加入候选。';
    }
    if (code === 'round_not_found') {
        return '当前回合不存在，请重试加入候选。';
    }
    if (code === 'invalid_request') {
        return response?.message || '加入候选请求无效';
    }
    return response?.message || '加入候选失败';
}

async function onAddCandidate(model) {
    try {
        const resolved = await resolveRoundForCandidate();
        const payload = {
            type: 'ROUND_ADD_CANDIDATE',
            model
        };

        if (resolved.roundId) {
            payload.roundId = resolved.roundId;
        }
        if (resolved.createRoundIfMissing) {
            payload.createRoundIfMissing = true;
            payload.questionIfCreate = getManualRoundQuestion();
            payload.targetModelsIfCreate = getManualRoundTargetModels();
        }

        const response = await sendMessage({
            ...payload
        });

        if (response?.status !== 'candidate_added') {
            alert(getCandidateAddErrorMessage(response));
            return;
        }

        if (response?.duplicate) {
            alert('已存在相同候选，未重复添加。');
        }

        await setActiveRound(response.roundId || resolved.roundId || state.activeRoundId);
    } catch (error) {
        console.error(error);
        alert(`加入候选失败: ${error.message}`);
    }
}

function onClearQuotes() {
    state.quoteList = [];
    renderQuoteList();
    updateRouteExclusions();
}

function addQuote(source, text) {
    if (!source || !text) return;
    state.quoteList.push({ source, text });
    renderQuoteList();
    updateRouteExclusions();
}

function removeQuote(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.quoteList.length) return;
    state.quoteList.splice(index, 1);
    renderQuoteList();
    updateRouteExclusions();
}

function renderQuoteList() {
    if (state.quoteList.length === 0) {
        refs.quoteList.innerHTML = '<div class="empty">点击“引用”把回答加入路由区</div>';
        return;
    }

    refs.quoteList.innerHTML = state.quoteList
        .map((quote, index) => (
            `<div class="quote-item" data-index="${index}">
                <span class="quote-close">×</span>
                <strong>${escapeHtml(quote.source)}</strong><br>
                ${escapeHtml(shorten(quote.text, 220))}
            </div>`
        ))
        .join('');
}

function updateRouteExclusions() {
    const quotedSources = new Set(state.quoteList.map((q) => q.source));
    const checkboxes = document.querySelectorAll('.router-targets input[type="checkbox"]');

    checkboxes.forEach((checkbox) => {
        const disabled = quotedSources.has(checkbox.value);
        checkbox.disabled = disabled;
        if (disabled) checkbox.checked = false;
        checkbox.parentElement.style.opacity = disabled ? '0.55' : '1';
    });
}

async function onRoute() {
    if (state.quoteList.length === 0) {
        alert('请先引用至少一条内容');
        return;
    }

    const targets = getCheckedValues('.router-targets input[type="checkbox"]');
    if (targets.length === 0) {
        alert('请至少选择一个路由目标');
        return;
    }

    const instruction = String(refs.routerInput.value || '').trim();
    const quoteText = state.quoteList
        .map((q, i) => `[Reference ${i + 1} / ${q.source}]\n${q.text}`)
        .join('\n\n');

    try {
        await sendMessage({
            type: 'ROUTE',
            source: 'Multiple',
            quote: quoteText,
            instruction,
            targets
        });
    } catch (error) {
        console.error(error);
        alert(`Route 失败: ${error.message}`);
    }
}

async function onStartReview() {
    if (!state.activeRoundId || !state.activeRound) {
        alert('没有可评审的回合，请先加入候选（可不 Broadcast）');
        return;
    }

    if ((state.activeRound.candidateIds || []).length < 2) {
        alert('至少需要 2 个候选答案才能评审');
        return;
    }

    const judgeModels = getCheckedValues('.judge-targets input[type="checkbox"]');
    if (judgeModels.length === 0) {
        alert('请至少选择一个评委模型');
        return;
    }
    if (judgeModels.length < 2 && !confirm('评委少于2个，结果稳定性较低。确定继续？')) {
        return;
    }

    const promptTemplate = refs.reviewTemplate.value || DEFAULT_SETTINGS.reviewPromptTemplate;
    refs.startReviewBtn.disabled = true;
    refs.reviewTemplate.disabled = true;

    try {
        await saveRtSettings({ reviewPromptTemplate: promptTemplate });
        const response = await sendMessage({
            type: 'ROUND_START_REVIEW',
            roundId: state.activeRoundId,
            judgeModels,
            promptTemplate,
            weights: FIXED_WEIGHTS,
            selfReviewWeight: 0.2
        });

        if (response?.status !== 'review_started') {
            alert(response?.message || '开始评审失败');
        }
        await setActiveRound(state.activeRoundId);
    } catch (error) {
        console.error(error);
        alert(`开始评审失败: ${error.message}`);
    } finally {
        if (state.activeRound?.status !== 'reviewing') {
            refs.startReviewBtn.disabled = false;
            refs.reviewTemplate.disabled = false;
        }
    }
}

async function onDeleteRound() {
    if (!state.activeRoundId) {
        alert('当前没有回合');
        return;
    }
    if (!confirm('确定删除当前回合及其候选/评审记录？')) {
        return;
    }

    try {
        await sendMessage({ type: 'ROUND_DELETE', roundId: state.activeRoundId });
        await loadLatestRound();
    } catch (error) {
        console.error(error);
        alert(`删除失败: ${error.message}`);
    }
}

function onResetTemplate() {
    refs.reviewTemplate.value = DEFAULT_SETTINGS.reviewPromptTemplate;
    saveRtSettings({ reviewPromptTemplate: refs.reviewTemplate.value }).catch(console.error);
}

function onRoundEvent(message) {
    if (!message.roundId || !state.activeRoundId) return;
    if (message.roundId !== state.activeRoundId) return;

    if (message.event === 'review_progress' && message.data?.progress) {
        state.latestReviewProgress = message.data.progress;
        renderReviewProgress();
    }

    if ([
        'candidate_added',
        'review_started',
        'review_progress',
        'review_done',
        'review_failed',
        'ranking_updated'
    ].includes(message.event)) {
        setActiveRound(state.activeRoundId).catch(console.error);
    }
}

function renderRound() {
    const round = state.activeRound;
    if (!round) {
        refs.roundId.innerText = '-';
        refs.roundStatus.innerText = 'none';
        refs.roundCandidateCount.innerText = '0';
        refs.roundCreatedAt.innerText = '-';
        refs.roundQuestion.innerText = '当前未创建回合';
        refs.reviewTemplate.disabled = false;
        refs.startReviewBtn.disabled = false;
        syncCandidateButtons();
        return;
    }

    refs.roundId.innerText = round.roundId;
    refs.roundStatus.innerText = round.status;
    refs.roundCandidateCount.innerText = String((round.candidateIds || []).length);
    refs.roundCreatedAt.innerText = new Date(round.createdAt).toLocaleString();
    refs.roundQuestion.innerText = round.question || '(empty question)';

    const reviewLocked = round.status === 'reviewing';
    refs.reviewTemplate.disabled = reviewLocked;
    refs.startReviewBtn.disabled = reviewLocked;
}

function renderReviewProgress() {
    if (!state.activeRound) {
        refs.reviewProgress.innerText = '等待开始评审';
        return;
    }

    const evaluations = state.activeRound.evaluations || [];
    if (evaluations.length === 0) {
        refs.reviewProgress.innerText = '尚未开始评审';
        return;
    }

    const done = evaluations.filter((e) => e.status === 'done').length;
    const failed = evaluations.filter((e) => e.status === 'parse_failed' || e.status === 'timeout').length;
    const pending = evaluations.length - done - failed;
    refs.reviewProgress.innerText = `评审进度: done ${done} / failed ${failed} / pending ${pending}`;
}

function renderJudgeStatusList() {
    if (!refs.judgeStatusList) return;

    const round = state.activeRound;
    const evaluations = Array.isArray(round?.evaluations) ? round.evaluations : [];

    if (evaluations.length === 0) {
        refs.judgeStatusList.innerHTML = '<div class="empty">No judge tasks yet</div>';
        return;
    }

    const rows = [...evaluations].sort((a, b) => {
        const am = String(a?.judgeModel || '');
        const bm = String(b?.judgeModel || '');
        return am.localeCompare(bm);
    });

    refs.judgeStatusList.innerHTML = rows.map((evaluation) => {
        const status = normalizeEvaluationStatus(evaluation.status);
        const model = evaluation.judgeModel || 'Unknown';
        const detail = getEvaluationStatusDetail(evaluation);
        return `
            <div class="judge-status-row">
                <div class="judge-status-main">
                    <span class="judge-status-model">${escapeHtml(model)}</span>
                    <span class="status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span>
                </div>
                <div class="judge-status-detail">${escapeHtml(detail)}</div>
            </div>
        `;
    }).join('');
}

function renderResultBoard() {
    const round = state.activeRound;
    if (!round || !Array.isArray(round.ranking) || round.ranking.length === 0) {
        refs.resultBoard.innerHTML = '<div class="empty">暂无排名结果</div>';
        return;
    }

    const candidateMap = {};
    (round.candidates || []).forEach((candidate) => {
        candidateMap[candidate.candidateId] = candidate;
    });

    refs.resultBoard.innerHTML = round.ranking.map((item, index) => {
        const candidate = candidateMap[item.candidateId];
        const model = candidate?.model || 'Unknown';
        const answerSnippet = shorten(candidate?.answerText || '', 180);
        const reasons = collectCandidateReasons(round, item.candidateId);
        return `
            <div class="rank-row">
                <div class="rank-title">#${index + 1} ${escapeHtml(model)} | Final ${formatScore(item.finalScore)}</div>
                <div class="small-muted">raw ${formatScore(item.rawMean)} · normalized ${formatScore(item.normalizedMean)} · non-self ${formatScore(item.nonSelfMean)} · variance ${formatScore(item.variance)}</div>
                <div style="margin-top:4px;">${escapeHtml(answerSnippet)}</div>
                ${reasons ? `<div class="small-muted" style="margin-top:4px;">评审理由: ${escapeHtml(reasons)}</div>` : ''}
            </div>
        `;
    }).join('');
}

function collectCandidateReasons(round, candidateId) {
    const evaluations = round.evaluations || [];
    const reasons = [];
    for (const evaluation of evaluations) {
        if (evaluation.status !== 'done') continue;
        const scores = Array.isArray(evaluation.parsedScores) ? evaluation.parsedScores : [];
        for (const score of scores) {
            const mappedCandidate = evaluation.blindMap?.[String(score.slot || '').toUpperCase()];
            if (mappedCandidate !== candidateId) continue;
            if (score.reason) reasons.push(`[${evaluation.judgeModel}] ${score.reason}`);
            break;
        }
        if (reasons.length >= 2) break;
    }
    return reasons.join(' | ');
}

function normalizeEvaluationStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'done') return 'done';
    if (value === 'parse_failed') return 'parse_failed';
    if (value === 'timeout') return 'timeout';
    return 'pending';
}

function getEvaluationStatusDetail(evaluation) {
    const status = normalizeEvaluationStatus(evaluation?.status);
    const scoreCount = Array.isArray(evaluation?.parsedScores) ? evaluation.parsedScores.length : 0;

    if (status === 'done') {
        return `Parsed ${scoreCount} score item(s).`;
    }

    if (status === 'parse_failed') {
        const raw = String(evaluation?.rawResponse || '').replace(/\s+/g, ' ').trim();
        return raw ? `Parse failed: ${shorten(raw, 140)}` : 'Parse failed: invalid JSON output.';
    }

    if (status === 'timeout') {
        return 'Timeout: no valid response received within the window.';
    }

    return 'Waiting for judge response...';
}

function syncCandidateButtons() {
    const hasRound = Boolean(state.activeRoundId);
    document.querySelectorAll('.btn-candidate').forEach((button) => {
        button.disabled = false;
        button.title = hasRound ? '' : '将自动创建回合';
    });
}

function updateCard(model, status, summary) {
    const cardId = MODEL_CARD_MAP[model] || `card-${String(model || '').toLowerCase()}`;
    const card = document.getElementById(cardId);
    if (!card) return;

    const dot = card.querySelector('.status-dot');
    const statusText = card.querySelector('.status-text');
    if (dot) {
        dot.className = 'status-dot';
        if (status === 'generating') dot.classList.add('thinking');
        if (status === 'idle') dot.classList.add('active');
    }
    if (statusText) {
        statusText.innerText = status === 'generating' ? 'Generating' : 'Idle';
    }

    if (summary) {
        const body = card.querySelector('.card-body');
        if (body) body.innerText = summary;
    }
}

function getCheckedValues(selector) {
    const values = [];
    document.querySelectorAll(selector).forEach((checkbox) => {
        if (checkbox.checked && !checkbox.disabled) values.push(checkbox.value);
    });
    return values;
}

function getModelFromCard(cardId) {
    const entry = Object.entries(MODEL_CARD_MAP).find(([, id]) => id === cardId);
    return entry?.[0] || null;
}

function shorten(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
}

function formatScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0.00';
    return number.toFixed(2);
}

function escapeHtml(text) {
    return String(text || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function sendMessage(payload) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(payload, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
}
