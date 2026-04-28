import {
    DEFAULT_SETTINGS,
    RT_KEYS,
    Storage,
    getRtSettings,
    saveRtSettings
} from '../utils/storage.js';
import { applyI18n, t } from './i18n.mjs';
import {
    FOLLOWUP_PRIMARY_PRESET_ID,
    MAX_ROUTER_MODIFIERS,
    ROUTER_QUOTE_KIND,
    applyPresetSelection,
    buildFinalRouterPrompt,
    buildRouteReferenceBlock,
    buildRouterInstruction,
    createEmptyRouterPresetState,
    getFollowupEligibleSources,
    getPresetById,
    isRespondReviewMode,
    validateFollowupRoute
} from './router_presets.mjs';
import { buildReviewImportBundle } from './router_review_import.mjs';

const ENABLED_MODELS = ['ChatGPT', 'Grok', 'Gemini', 'Doubao', 'DeepSeek'];
const DISABLED_MODELS = ['Claude'];
const DISPLAY_MODELS = ['ChatGPT', 'Claude', 'Grok', 'Gemini', 'Doubao', 'DeepSeek'];

const MODEL_CARD_MAP = {
    ChatGPT: 'card-gpt',
    Claude: 'card-claude',
    Grok: 'card-grok',
    Gemini: 'card-gemini',
    Doubao: 'card-doubao',
    DeepSeek: 'card-deepseek'
};

function isEnabledModel(model) {
    return ENABLED_MODELS.includes(String(model || '').trim());
}

function isDisabledModel(model) {
    return DISABLED_MODELS.includes(String(model || '').trim());
}

function getModelDisabledMessage(model) {
    if (model === 'Claude') {
        return t('modelDisabledClaude', 'Claude 暂不允许使用：当前网页自动化可能触发风控或封号风险。');
    }
    return t('modelDisabledGeneric', '该模型暂不允许使用。');
}

const BROADCAST_MAX_FILES = 3;
const BROADCAST_MAX_FILE_BYTES = 5 * 1024 * 1024;
const BROADCAST_ALLOWED_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv'
]);
const BROADCAST_ALLOWED_EXT = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.gif',
    '.pdf',
    '.txt',
    '.md',
    '.csv'
]);
const BROADCAST_EXT_TO_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv'
};

const REVIEW_MODES = {
    scoring: 'scoring',
    discussion: 'discussion'
};

const LABEL_MODES = {
    blind: 'blind',
    named: 'named'
};

const FIXED_WEIGHTS = {
    accuracy: 0.4,
    completeness: 0.25,
    actionability: 0.2,
    clarity: 0.15
};

const state = {
    modelState: {},
    quoteList: [],
    activeRoundId: null,
    activeRound: null,
    settings: { ...DEFAULT_SETTINGS },
    selectedCandidateId: null,
    broadcastFiles: [],
    broadcastStatus: {
        level: 'info',
        message: ''
    },
    generatedRouterInstruction: '',
    routerSupplement: '',
    dragDepth: 0,
    reviewMode: REVIEW_MODES.scoring,
    labelMode: LABEL_MODES.blind,
    isStartingReview: false,
    ...createEmptyRouterPresetState()
};

const refs = {};

document.addEventListener('DOMContentLoaded', () => {
    void bootstrapPanel();
});

async function bootstrapPanel() {
    setPanelAutomationState('pending');
    try {
        await initializePanel();
        setPanelAutomationState('ready');
    } catch (error) {
        console.error('initializePanel failed', error);
        setPanelAutomationState('error', error);
    }
}

function setPanelAutomationState(status, error = null) {
    const normalized = status === 'ready'
        ? 'true'
        : status === 'error'
            ? 'error'
            : 'pending';

    document.body.dataset.panelReady = normalized;
    globalThis.__AI_RT_PANEL_READY__ = normalized === 'true';
    globalThis.__AI_RT_PANEL_STATUS__ = normalized;
    globalThis.__AI_RT_PANEL_ERROR__ = error
        ? String(error instanceof Error ? error.message : error || '')
        : '';
}

async function initializePanel() {
    bindRefs();
    applyI18n(document);
    document.title = t('panelTitle', 'AI RoundTable');
    initializeSelectorDefaults();
    bindEvents();
    await initializeSettings();
    await loadModelState();
    await loadLatestRound();
    setBroadcastStatus('info', t('broadcastDropHint', '可以粘贴或拖拽文件到这里，最多 3 个文件，每个不超过 5MB。'));
    renderBroadcastFileList();
    renderQuoteList();
    refreshRouterComposer();
    renderRound();
    renderReviewProgress();
    renderJudgeStatusList();
    renderResultBoard();
}

function bindRefs() {
    refs.globalInput = document.getElementById('global-input');
    refs.broadcastFileInput = document.getElementById('broadcast-file-input');
    refs.broadcastAttachBtn = document.getElementById('broadcast-attach-btn');
    refs.broadcastClearFilesBtn = document.getElementById('broadcast-clear-files-btn');
    refs.broadcastFileList = document.getElementById('broadcast-file-list');
    refs.broadcastFileStatus = document.getElementById('broadcast-file-status');
    refs.broadcastBtn = document.getElementById('broadcast-btn');
    refs.quoteList = document.getElementById('quote-list');
    refs.clearQuotesBtn = document.getElementById('clear-quotes');
    refs.routerPreview = document.getElementById('router-preview');
    refs.routerFollowupControls = document.getElementById('router-followup-controls');
    refs.routerFollowupSource = document.getElementById('router-followup-source');
    refs.routerInput = document.getElementById('router-input');
    refs.routeBtn = document.getElementById('route-btn');
    refs.reviewMode = document.getElementById('review-mode');
    refs.labelMode = document.getElementById('label-mode');
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

function initializeSelectorDefaults() {
    getRouteTargetCheckboxes().forEach((checkbox) => {
        checkbox.checked = isEnabledModel(checkbox.value);
        checkbox.disabled = !isEnabledModel(checkbox.value);
    });
}

function bindEvents() {
    refs.broadcastBtn?.addEventListener('click', () => { void onBroadcast(); });
    refs.broadcastAttachBtn?.addEventListener('click', onBroadcastAttachClick);
    refs.broadcastClearFilesBtn?.addEventListener('click', onClearBroadcastFiles);
    refs.broadcastFileInput?.addEventListener('change', onSelectBroadcastFiles);
    refs.routerFollowupSource?.addEventListener('change', onFollowupSourceChange);
    refs.routerInput?.addEventListener('input', onRouterSupplementInput);
    refs.clearQuotesBtn?.addEventListener('click', onClearQuotes);
    refs.routeBtn?.addEventListener('click', () => { void onRoute(); });
    refs.resetTemplateBtn?.addEventListener('click', () => { void onResetTemplate(); });
    refs.startReviewBtn?.addEventListener('click', () => { void onStartReview(); });
    refs.deleteRoundBtn?.addEventListener('click', () => { void onDeleteRound(); });
    refs.reviewMode?.addEventListener('change', () => { void onReviewModeChange(); });
    refs.labelMode?.addEventListener('change', () => { void onLabelModeChange(); });
    refs.reviewTemplate?.addEventListener('change', () => { void persistCurrentTemplate(); });
    getRouteTargetCheckboxes().forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
            refreshRouterComposer();
        });
    });
    document.body.addEventListener('paste', onPanelPaste);
    document.body.addEventListener('dragenter', onPanelDragEnter);
    document.body.addEventListener('dragover', onPanelDragOver);
    document.body.addEventListener('dragleave', onPanelDragLeave);
    document.body.addEventListener('drop', onPanelDrop);
    document.addEventListener('click', onDocumentClick);
    chrome.runtime.onMessage.addListener((message) => {
        void handleRuntimeMessage(message);
    });
}

async function handleRuntimeMessage(message) {
    if (!message || !message.type) return;
    if (message.type === 'STATUS_UPDATE') {
        updateCard(message.model, message.status, message.summary);
        return;
    }
    if (message.type !== 'ROUND_EVENT') return;
    if (!state.activeRoundId) {
        await loadLatestRound();
        return;
    }
    if (message.roundId === state.activeRoundId) {
        await loadRound(state.activeRoundId);
        return;
    }
    if (message.event === 'round_deleted' || message.event === 'candidate_added') {
        await loadLatestRound();
    }
}

function onDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.classList.contains('btn-quote')) {
        if (target.disabled) return;
        const source = target.dataset.source || '';
        if (isDisabledModel(source)) {
            window.alert(getModelDisabledMessage(source));
            return;
        }
        const card = target.closest('.ai-card');
        const bodyText = card?.querySelector('.card-body')?.textContent || '';
        addQuote(source, bodyText);
        return;
    }

    if (target.classList.contains('btn-candidate')) {
        if (target.disabled) return;
        void onAddCandidate(target.dataset.model || '');
        return;
    }

    if (target.classList.contains('btn-import-review')) {
        void onImportCandidateReview(target.dataset.candidateId || '');
        return;
    }

    if (target.classList.contains('quote-close')) {
        const index = Number(target.closest('.quote-item')?.dataset.index);
        if (Number.isFinite(index)) {
            removeQuote(index);
        }
        return;
    }

    if (target.classList.contains('chip') && target.dataset.presetId) {
        onToggleRouterPreset(target.dataset.presetId);
        return;
    }

    const rankRow = target.closest('.rank-row[data-candidate-id]');
    if (rankRow && refs.resultBoard?.contains(rankRow)) {
        onToggleCandidateDetails(rankRow.dataset.candidateId || '');
        return;
    }

    const header = target.closest('.card-header');
    if (header) {
        const card = header.closest('.ai-card');
        const model = getModelFromCard(card?.id || '');
        if (model) {
            if (isDisabledModel(model)) {
                window.alert(getModelDisabledMessage(model));
                return;
            }
            void sendMessage({ type: 'ACTIVATE_TAB', model });
        }
    }
}

async function initializeSettings() {
    try {
        state.settings = await getRtSettings();
    } catch (error) {
        console.warn('Failed to load settings, using defaults.', error);
        state.settings = { ...DEFAULT_SETTINGS };
    }

    state.reviewMode = normalizeReviewMode(state.settings.reviewMode);
    state.labelMode = normalizeLabelMode(state.settings.labelMode);
    state.routerSupplement = '';
    refs.reviewMode.value = state.reviewMode;
    refs.labelMode.value = state.labelMode;
    refs.routerInput.value = state.routerSupplement;
    refreshTemplateEditorForCurrentMode();
    updateReviewModeUI();
    syncReviewControlsState();
}

async function loadModelState() {
    const data = await Storage.get(RT_KEYS.modelState);
    state.modelState = data[RT_KEYS.modelState] || {};
    renderCards();
}

async function loadLatestRound() {
    const response = await sendMessage({ type: 'ROUND_LIST', limit: 1 });
    const latest = response?.status === 'ok' && Array.isArray(response.rounds) ? response.rounds[0] : null;
    if (!latest?.roundId) {
        clearActiveRound();
        return;
    }
    await loadRound(latest.roundId);
}

async function loadRound(roundId) {
    if (!roundId) {
        clearActiveRound();
        return;
    }

    const response = await sendMessage({ type: 'ROUND_GET', roundId });
    if (response?.status !== 'ok' || !response.round) {
        clearActiveRound();
        return;
    }

    state.activeRoundId = roundId;
    state.activeRound = response.round;

    const candidateIds = new Set((state.activeRound.candidates || []).map((candidate) => candidate.candidateId));
    if (!candidateIds.has(state.selectedCandidateId)) {
        state.selectedCandidateId = state.activeRound.ranking?.[0]?.candidateId || null;
    }

    renderRound();
    syncReviewControlsState();
    renderReviewProgress();
    renderJudgeStatusList();
    renderResultBoard();
}

function clearActiveRound() {
    state.activeRoundId = null;
    state.activeRound = null;
    state.selectedCandidateId = null;
    renderRound();
    syncReviewControlsState();
    renderReviewProgress();
    renderJudgeStatusList();
    renderResultBoard();
}

function getCurrentReviewMode() {
    return normalizeReviewMode(refs.reviewMode?.value || state.reviewMode);
}

function getCurrentLabelMode() {
    return normalizeLabelMode(refs.labelMode?.value || state.labelMode);
}

function getTemplateKeyByMode(mode) {
    return normalizeReviewMode(mode) === REVIEW_MODES.discussion ? 'discussionPromptTemplate' : 'reviewPromptTemplate';
}

function getDefaultTemplateByMode(mode) {
    return normalizeReviewMode(mode) === REVIEW_MODES.discussion
        ? DEFAULT_SETTINGS.discussionPromptTemplate
        : DEFAULT_SETTINGS.reviewPromptTemplate;
}

function normalizeReviewMode(value) {
    return String(value || '').trim().toLowerCase() === REVIEW_MODES.discussion
        ? REVIEW_MODES.discussion
        : REVIEW_MODES.scoring;
}

function normalizeLabelMode(value) {
    return String(value || '').trim().toLowerCase() === LABEL_MODES.named
        ? LABEL_MODES.named
        : LABEL_MODES.blind;
}

function getBroadcastTargets() {
    return getCheckedValues('.target-selector input[type="checkbox"]');
}

function getRouteTargets() {
    if (isRespondReviewMode(state) && isEnabledModel(state.selectedFollowupSource)) {
        return [state.selectedFollowupSource];
    }
    return getCheckedValues('.router-targets input[type="checkbox"]');
}

function getJudgeModels() {
    return getCheckedValues('.judge-targets input[type="checkbox"]');
}

function getRouteTargetCheckboxes() {
    return Array.from(document.querySelectorAll('.router-targets input[type="checkbox"]'));
}

function getCheckedValues(selector) {
    return Array.from(document.querySelectorAll(selector))
        .filter((input) => input instanceof HTMLInputElement && input.checked && !input.disabled)
        .map((input) => input.value)
        .filter((value) => isEnabledModel(value));
}

function getModelFromCard(cardId) {
    return Object.entries(MODEL_CARD_MAP).find(([, id]) => id === cardId)?.[0] || null;
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(Number(value));
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('zh-CN', { hour12: false });
}

function formatScore(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0.00';
    return numeric.toFixed(2);
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

function truncateText(text, maxLength) {
    const value = String(text || '').trim();
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function localizeBackgroundError(response) {
    const code = String(response?.code || '').trim();
    switch (code) {
        case 'candidate_summary_missing':
            return t('candidateSummaryMissing', '当前模型还没有捕获到可用回答，请等它输出完成后再试。');
        case 'round_not_found':
            return t('candidateRoundNotFound', '所选轮次不存在，请刷新后重试。');
        case 'invalid_request':
            return t('candidateInvalidRequest', '加入候选时请求无效。');
        case 'candidate_answer_missing':
            return t('reviewNoCandidateAnswer', '当前轮次还没有可用候选答案，请先加入候选。');
        case 'broadcast_no_supported_targets':
            return t('broadcastNoSupportedTargets', '所选模型都不支持当前附件。');
        case 'invalid_attachments':
            return t('invalidAttachments', '附件数据无效，请重新选择文件。');
        case 'model_disabled':
            return t('modelDisabledGeneric', '该模型暂不允许使用。');
        default:
            return String(response?.message || response?.error || '').trim();
    }
}

async function sendMessage(payload) {
    try {
        return await chrome.runtime.sendMessage(payload);
    } catch (error) {
        console.error('sendMessage failed', error);
        return {
            status: 'error',
            message: error instanceof Error ? error.message : String(error || 'Unknown error')
        };
    }
}

async function onBroadcast() {
    const question = String(refs.globalInput?.value || '').trim();
    if (!question) {
        window.alert(t('broadcastEnterQuestion', '请先输入问题再进行群发。'));
        return;
    }

    const targets = getBroadcastTargets();
    if (targets.length === 0) {
        window.alert(t('broadcastSelectTargetModel', '请至少选择一个目标模型。'));
        return;
    }

    const attachments = await serializeBroadcastFiles();
    setBroadcastStatus('info', t('broadcasting', '群发中...'));

    const response = await sendMessage({
        type: 'BROADCAST',
        text: question,
        targets,
        attachments
    });

    if (response?.status === 'error') {
        const localizedError = localizeBackgroundError(response)
            || t('broadcastFailedGeneric', '群发失败，请稍后重试。');
        setBroadcastStatus('error', t('broadcastFailedPrefix', '群发失败：{0}', [localizedError]));
        return;
    }

    const sentModels = Array.isArray(response?.sentModels) ? response.sentModels : [];
    const degraded = Array.isArray(response?.degraded) ? response.degraded : [];
    const skipped = Array.isArray(response?.skipped) ? response.skipped : [];
    const failed = Array.isArray(response?.failed) ? response.failed : [];

    const lines = [
        t('broadcastOutcomeSent', '已发送 {0} 个模型。', [sentModels.length])
    ];
    if (degraded.length > 0) {
        lines.push(t('broadcastOutcomeDegraded', '{0} 个模型已降级为纯文本发送（{1}）。', [
            degraded.length,
            summarizeBroadcastIssues(degraded)
        ]));
    }
    if (skipped.length > 0) {
        lines.push(t('broadcastOutcomeSkipped', '已跳过 {0} 个模型（{1}）。', [
            skipped.length,
            summarizeBroadcastIssues(skipped)
        ]));
    }
    if (failed.length > 0) {
        lines.push(t('broadcastOutcomeFailed', '{0} 个模型发送失败（{1}）。', [
            failed.length,
            summarizeBroadcastIssues(failed)
        ]));
    }

    setBroadcastStatus(failed.length > 0 ? 'warn' : 'success', lines.join('\n'));

    if (sentModels.length > 0) {
        await createFreshRound(question, sentModels.length > 0 ? sentModels : targets);
    }
}

async function createFreshRound(question, targetModels) {
    const response = await sendMessage({
        type: 'ROUND_CREATE',
        question,
        targetModels
    });
    if (response?.status === 'round_created' && response.roundId) {
        await loadRound(response.roundId);
    }
}

function summarizeBroadcastIssues(items) {
    return items
        .map((item) => {
            const model = String(item?.model || '').trim();
            const reason = String(item?.reason || '').trim();
            return reason ? `${model}: ${reason}` : model;
        })
        .filter(Boolean)
        .join('；');
}

async function serializeBroadcastFiles() {
    const attachments = [];
    for (const file of state.broadcastFiles) {
        attachments.push(await serializeFile(file));
    }
    return attachments;
}

async function serializeFile(file) {
    const dataUrl = await readFileAsDataUrl(file);
    return {
        name: file.name,
        mimeType: String(file.type || BROADCAST_EXT_TO_MIME[getFileExtension(file.name)] || ''),
        size: file.size,
        base64: dataUrl.split(',')[1] || ''
    };
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('File read failed'));
        reader.readAsDataURL(file);
    });
}

function onBroadcastAttachClick() {
    refs.broadcastFileInput?.click();
}

function onClearBroadcastFiles() {
    state.broadcastFiles = [];
    renderBroadcastFileList();
    setBroadcastStatus('info', t('attachmentsCleared', '已清空附件。'));
}

function onSelectBroadcastFiles(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    addIncomingFiles(input.files, t('sourceSelectedFiles', '选中文件'));
    input.value = '';
}

function onPanelPaste(event) {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) {
        return;
    }
    event.preventDefault();
    addIncomingFiles(files, t('sourcePastedFiles', '粘贴文件'));
}

function onPanelDragEnter(event) {
    if (!hasFilePayload(event.dataTransfer)) return;
    event.preventDefault();
    state.dragDepth += 1;
    document.body.classList.add('drag-active');
}

function onPanelDragOver(event) {
    if (!hasFilePayload(event.dataTransfer)) return;
    event.preventDefault();
}

function onPanelDragLeave(event) {
    if (!hasFilePayload(event.dataTransfer)) return;
    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) {
        document.body.classList.remove('drag-active');
    }
}

function onPanelDrop(event) {
    if (!hasFilePayload(event.dataTransfer)) return;
    event.preventDefault();
    state.dragDepth = 0;
    document.body.classList.remove('drag-active');
    addIncomingFiles(event.dataTransfer?.files, t('sourceDroppedFiles', '拖拽文件'));
}

function hasFilePayload(dataTransfer) {
    const types = Array.from(dataTransfer?.types || []);
    return types.includes('Files');
}

function addIncomingFiles(fileList, sourceLabel) {
    const incomingFiles = Array.from(fileList || []).filter((item) => item instanceof File);
    if (incomingFiles.length === 0) {
        setBroadcastStatus('warn', t('noUsableFilesDetected', '{0}：未检测到可用文件。', [sourceLabel]));
        return;
    }

    const existingKeys = new Set(state.broadcastFiles.map((file) => getFileKey(file)));
    const accepted = [];
    const duplicates = [];
    const typeRejected = [];
    const sizeRejected = [];
    let overflow = 0;

    incomingFiles.forEach((file) => {
        if (!isSupportedFile(file)) {
            typeRejected.push(file);
            return;
        }
        if (file.size > BROADCAST_MAX_FILE_BYTES) {
            sizeRejected.push(file);
            return;
        }
        const key = getFileKey(file);
        if (existingKeys.has(key)) {
            duplicates.push(file);
            return;
        }
        if (state.broadcastFiles.length + accepted.length >= BROADCAST_MAX_FILES) {
            overflow += 1;
            return;
        }
        existingKeys.add(key);
        accepted.push(file);
    });

    let duplicateKeptCount = 0;
    let duplicateSkippedCount = duplicates.length;
    if (duplicates.length > 0 && window.confirm(t('duplicateFilesConfirm', '检测到 {0} 个重复文件，仍然保留吗？', [duplicates.length]))) {
        duplicateKeptCount = duplicates.length;
        duplicateSkippedCount = 0;
        duplicates.forEach((file) => {
            if (state.broadcastFiles.length + accepted.length >= BROADCAST_MAX_FILES) {
                overflow += 1;
                return;
            }
            accepted.push(file);
        });
    }

    state.broadcastFiles = [...state.broadcastFiles, ...accepted];
    renderBroadcastFileList();

    const lines = [];
    if (accepted.length > 0) {
        lines.push(t('fileActionAdded', '已加入 {0} 个文件。', [accepted.length]));
    }
    if (duplicateKeptCount > 0) {
        lines.push(t('fileActionDuplicateKept', '重复文件已保留：{0} 个。', [duplicateKeptCount]));
    }
    if (duplicateSkippedCount > 0) {
        lines.push(t('fileActionDuplicateSkipped', '重复文件已跳过：{0} 个。', [duplicateSkippedCount]));
    }
    if (typeRejected.length > 0) {
        lines.push(t('fileActionTypeRejected', '类型不支持：{0} 个。', [typeRejected.length]));
    }
    if (sizeRejected.length > 0) {
        lines.push(t('fileActionSizeRejected', '大小不符合限制：{0} 个。', [sizeRejected.length]));
    }
    if (overflow > 0) {
        lines.push(t('fileActionOverflow', '超出数量上限（最多 {0} 个）：{1} 个。', [
            BROADCAST_MAX_FILES,
            overflow
        ]));
    }

    if (lines.length === 0) {
        setBroadcastStatus('warn', t('filesNotQueued', '{0}未加入待发送队列。', [sourceLabel]));
        return;
    }

    const level = typeRejected.length > 0 || sizeRejected.length > 0 || overflow > 0 ? 'warn' : 'success';
    setBroadcastStatus(level, lines.join('\n'));
}

function isSupportedFile(file) {
    const mimeType = String(file.type || '').toLowerCase();
    const extension = getFileExtension(file.name);
    return BROADCAST_ALLOWED_MIME.has(mimeType) || BROADCAST_ALLOWED_EXT.has(extension);
}

function getFileExtension(name) {
    const value = String(name || '').toLowerCase();
    const index = value.lastIndexOf('.');
    return index >= 0 ? value.slice(index) : '';
}

function getFileKey(file) {
    return `${file.name}:${file.size}:${file.lastModified}`;
}

function renderBroadcastFileList() {
    if (!refs.broadcastFileList) return;
    if (state.broadcastFiles.length === 0) {
        refs.broadcastFileList.innerHTML = `<div class="empty">${escapeHtml(
            t('broadcastNoFilesSelected', '尚未选择文件。')
        )}</div>`;
        return;
    }

    refs.broadcastFileList.innerHTML = state.broadcastFiles
        .map((file) => `<div class="file-item">${escapeHtml(file.name)} · ${escapeHtml(formatFileSize(file.size))}</div>`)
        .join('');
}

function setBroadcastStatus(level, message) {
    state.broadcastStatus = {
        level,
        message: String(message || '')
    };
    renderBroadcastStatus();
}

function renderBroadcastStatus() {
    if (!refs.broadcastFileStatus) return;
    refs.broadcastFileStatus.className = `file-status ${state.broadcastStatus.level || 'info'}`;
    refs.broadcastFileStatus.textContent = state.broadcastStatus.message
        || t('broadcastDropHint', '可以粘贴或拖拽文件到这里，最多 3 个文件，每个不超过 5MB。');
}
function addQuote(source, text) {
    const quote = createQuoteItem({
        source,
        text,
        kind: ROUTER_QUOTE_KIND.answer
    });

    if (!quote || quote.text === t('waitingForResponse', '等待响应...')) {
        window.alert(t('routeNoQuotes', '请至少引用一个模型回答后再路由。'));
        return;
    }

    const quoteKey = getQuoteDedupKey(quote);
    const isDuplicate = state.quoteList.some((item) => getQuoteDedupKey(item) === quoteKey);
    if (isDuplicate) {
        return;
    }

    state.quoteList = [...state.quoteList, quote];
    renderQuoteList();
    refreshRouterComposer();
}

function removeQuote(index) {
    state.quoteList = state.quoteList.filter((_, currentIndex) => currentIndex !== index);
    renderQuoteList();
    refreshRouterComposer();
}

function onClearQuotes() {
    state.quoteList = [];
    renderQuoteList();
    refreshRouterComposer();
}

function renderQuoteList() {
    if (!refs.quoteList) return;
    if (state.quoteList.length === 0) {
        refs.quoteList.innerHTML = `<div class="empty">${escapeHtml(
            t('routerQuotesEmpty', '点击“引用”把回答加入路由器。')
        )}</div>`;
        return;
    }

    refs.quoteList.innerHTML = state.quoteList
        .map((item, index) => `
            <div class="quote-item" data-index="${index}">
                <span class="quote-close" title="remove">×</span>
                <div class="quote-head">
                    <strong>${escapeHtml(item.source)}</strong>
                    <div class="quote-tags">
                        <span class="quote-tag ${escapeHtml(item.kind || ROUTER_QUOTE_KIND.generic)}">${escapeHtml(getQuoteKindLabel(item.kind))}</span>
                        ${item.targetSource ? `<span class="quote-tag generic">${escapeHtml(
                            t('quoteTargetTag', '回给：{0}', [item.targetSource])
                        )}</span>` : ''}
                    </div>
                </div>
                <div>${escapeHtml(truncateText(item.text, 260))}</div>
            </div>
        `)
        .join('');
}

function onToggleRouterPreset(presetId) {
    const result = applyPresetSelection(state, presetId);
    if (result.errorCode === 'primary_required') {
        window.alert(t('routePrimaryRequired', '请先选择一个主任务，再添加修饰器。'));
        return;
    }
    if (result.errorCode === 'followup_no_modifiers') {
        window.alert(t('routeFollowupModifiersDisabled', '“回应评审”模式下不支持叠加修饰器。'));
        return;
    }
    if (result.errorCode === 'modifier_limit_reached') {
        window.alert(t('routeModifierLimitReached', '修饰器最多只能选择 {0} 个。', [MAX_ROUTER_MODIFIERS]));
        return;
    }

    state.selectedPrimaryPresetId = result.nextState.selectedPrimaryPresetId;
    state.selectedModifierPresetIds = result.nextState.selectedModifierPresetIds;
    state.selectedFollowupSource = result.nextState.selectedFollowupSource;
    refreshRouterComposer();
}

function onFollowupSourceChange() {
    state.selectedFollowupSource = String(refs.routerFollowupSource?.value || '').trim();
    refreshRouterComposer();
}

function onRouterSupplementInput() {
    state.routerSupplement = String(refs.routerInput?.value || '');
    refreshRouterComposer();
}

function refreshRouterComposer() {
    normalizeFollowupSourceSelection();
    state.generatedRouterInstruction = buildRouterInstruction(state, (key) => t(key, ''));
    updatePresetChips();
    renderFollowupControls();
    updateRouteExclusions();

    const routeError = getRouteValidationError();

    if (refs.routerPreview) {
        refs.routerPreview.textContent = state.generatedRouterInstruction
            || t('routerGeneratedEmpty', '先选择一个主任务，再按需叠加修饰器。');
        refs.routerPreview.classList.toggle('empty', !state.generatedRouterInstruction);
    }

    if (refs.routeBtn) {
        refs.routeBtn.disabled = Boolean(routeError);
    }
}

function updatePresetChips() {
    const followupMode = isRespondReviewMode(state);
    document.querySelectorAll('.chip[data-preset-id]').forEach((node) => {
        const element = node;
        const presetId = element.dataset.presetId || '';
        const preset = getPresetById(presetId);
        if (!preset) return;

        const isActive = preset.role === 'primary'
            ? state.selectedPrimaryPresetId === presetId
            : state.selectedModifierPresetIds.includes(presetId);

        element.classList.toggle('active', isActive);
        element.disabled = preset.role === 'modifier' && (
            (!state.selectedPrimaryPresetId && !isActive)
            || followupMode
        );
    });
}

function updateRouteExclusions() {
    const checkboxes = getRouteTargetCheckboxes();
    if (isRespondReviewMode(state)) {
        checkboxes.forEach((checkbox) => {
            if (!isEnabledModel(checkbox.value)) {
                checkbox.checked = false;
                checkbox.disabled = true;
                return;
            }
            if (checkbox.dataset.followupLocked !== 'true') {
                checkbox.dataset.followupLocked = 'true';
                checkbox.dataset.followupPrevChecked = checkbox.checked ? 'true' : 'false';
            }
            checkbox.checked = checkbox.value === state.selectedFollowupSource;
            checkbox.disabled = true;
        });
        return;
    }

    checkboxes.forEach((checkbox) => {
        if (checkbox.dataset.followupLocked === 'true') {
            checkbox.checked = checkbox.dataset.followupPrevChecked === 'true';
            delete checkbox.dataset.followupLocked;
            delete checkbox.dataset.followupPrevChecked;
        }
    });

    const quotedSources = new Set(state.quoteList.map((item) => item.source));
    checkboxes.forEach((checkbox) => {
        if (!isEnabledModel(checkbox.value)) {
            checkbox.checked = false;
            checkbox.disabled = true;
            return;
        }

        const shouldDisable = quotedSources.has(checkbox.value);
        if (shouldDisable) {
            if (!checkbox.disabled && checkbox.checked) {
                checkbox.dataset.restoreChecked = 'true';
            }
            checkbox.checked = false;
            checkbox.disabled = true;
            return;
        }

        const shouldRestore = checkbox.dataset.restoreChecked === 'true';
        checkbox.disabled = false;
        if (shouldRestore) {
            checkbox.checked = true;
            delete checkbox.dataset.restoreChecked;
        }
    });
}

function renderFollowupControls() {
    if (!refs.routerFollowupControls || !refs.routerFollowupSource) return;

    const followupMode = isRespondReviewMode(state);
    refs.routerFollowupControls.hidden = !followupMode;

    if (!followupMode) {
        refs.routerFollowupSource.innerHTML = '';
        return;
    }

    const eligibleSources = getFollowupEligibleSources(state.quoteList).filter((source) => isEnabledModel(source));
    if (!eligibleSources.includes(state.selectedFollowupSource)) {
        state.selectedFollowupSource = '';
    }
    refs.routerFollowupSource.innerHTML = [
        `<option value="">${escapeHtml(t('routerFollowupSourcePlaceholder', '请选择要回给哪个原模型'))}</option>`,
        ...eligibleSources.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`)
    ].join('');
    refs.routerFollowupSource.value = state.selectedFollowupSource || '';
}

async function onRoute() {
    const routeError = getRouteValidationError();
    if (routeError) {
        window.alert(routeError);
        return;
    }

    const targets = getRouteTargets();
    const finalPrompt = buildFinalRouterPrompt(
        state.generatedRouterInstruction,
        state.routerSupplement,
        (key) => t(key, '')
    );

    const response = await sendMessage({
        type: 'ROUTE',
        instruction: finalPrompt,
        quote: buildRouteReferenceBlock(state.quoteList, state, (key) => t(key, '')),
        targets
    });

    if (response?.status === 'route_done') {
        window.alert(t('routeSentCount', '已向 {0} 个模型发起路由。', [response.sent_to || targets.length]));
        return;
    }

    window.alert(t('routeFailedPrefix', '路由失败：{0}', [localizeBackgroundError(response) || 'Unknown error']));
}

function createQuoteItem({
    source,
    text,
    kind = ROUTER_QUOTE_KIND.generic,
    targetSource = null,
    meta = null
} = {}) {
    const cleanedSource = String(source || '').trim();
    const cleanedText = String(text || '').trim();
    if (!cleanedSource || !cleanedText) {
        return null;
    }

    return {
        source: cleanedSource,
        text: cleanedText,
        kind: Object.values(ROUTER_QUOTE_KIND).includes(kind) ? kind : ROUTER_QUOTE_KIND.generic,
        targetSource: String(targetSource || '').trim() || null,
        meta: meta && typeof meta === 'object' ? { ...meta } : null
    };
}

function getQuoteDedupKey(item) {
    return [
        String(item?.source || '').trim(),
        String(item?.kind || '').trim(),
        String(item?.targetSource || '').trim(),
        String(item?.text || '').trim()
    ].join('::');
}

function getQuoteKindLabel(kind) {
    switch (kind) {
        case ROUTER_QUOTE_KIND.answer:
            return t('quoteKindAnswer', '原答案');
        case ROUTER_QUOTE_KIND.feedback:
            return t('quoteKindFeedback', '外部反馈');
        default:
            return t('quoteKindGeneric', '引用');
    }
}

function normalizeFollowupSourceSelection() {
    if (!isRespondReviewMode(state)) {
        state.selectedFollowupSource = null;
        return;
    }

    const eligibleSources = getFollowupEligibleSources(state.quoteList).filter((source) => isEnabledModel(source));
    if (!eligibleSources.includes(state.selectedFollowupSource)) {
        state.selectedFollowupSource = null;
    }
}

function getRouteValidationError() {
    if (!state.selectedPrimaryPresetId) {
        return t('routeNoPrimary', '请先选择一个主任务。');
    }

    if (state.quoteList.length === 0) {
        return t('routeNoQuotes', '请至少引用一个模型回答后再路由。');
    }

    if (isRespondReviewMode(state)) {
        const validation = validateFollowupRoute({
            selectedFollowupSource: state.selectedFollowupSource,
            quoteList: state.quoteList
        });

        switch (validation.errorCode) {
            case 'followup_source_required':
                return t('routeFollowupSourceRequired', '请选择一个被评对象。');
            case 'followup_original_answer_required':
                return t('routeFollowupOriginalRequired', '需要先有该对象自己的原答案引用。');
            case 'followup_feedback_required':
                return t('routeFollowupFeedbackRequired', '还需要至少一条来自其他 AI 的外部反馈。');
            default:
                return '';
        }
    }

    if (getRouteTargets().length === 0) {
        return t('routeNoTargets', '请至少选择一个路由目标。');
    }

    return '';
}

async function onImportCandidateReview(candidateId) {
    if (!state.activeRound || !candidateId) {
        window.alert(t('reviewNoRound', '当前没有活动轮次，请先群发创建一轮。'));
        return;
    }

    const bundle = buildReviewImportBundle(state.activeRound, candidateId);
    if (bundle.errorCode) {
        switch (bundle.errorCode) {
            case 'candidate_not_found':
                window.alert(t('routeImportCandidateMissing', '没有找到对应的候选答案。'));
                return;
            case 'candidate_answer_missing':
                window.alert(t('routeImportCandidateAnswerMissing', '该候选答案还没有可导入的原答案内容。'));
                return;
            case 'followup_feedback_missing':
                window.alert(t('routeImportFeedbackMissing', '还没有可导入的外部评审意见。'));
                return;
            default:
                window.alert(t('routeImportFailed', '导入评审失败，请稍后重试。'));
                return;
        }
    }

    if (isDisabledModel(bundle.followupSource)) {
        window.alert(getModelDisabledMessage(bundle.followupSource));
        return;
    }

    state.quoteList = bundle.quoteList;
    state.selectedPrimaryPresetId = FOLLOWUP_PRIMARY_PRESET_ID;
    state.selectedModifierPresetIds = [];
    state.selectedFollowupSource = bundle.followupSource;
    renderQuoteList();
    refreshRouterComposer();
}

async function onAddCandidate(model) {
    if (isDisabledModel(model)) {
        window.alert(getModelDisabledMessage(model));
        return;
    }
    if (!isEnabledModel(model)) {
        window.alert(t('unknownModel', '未知模型：{0}', [model]));
        return;
    }

    let roundId = state.activeRoundId || '';
    if (state.activeRound && state.activeRound.status !== 'collecting') {
        const shouldCreateFresh = window.confirm(
            t('candidateRoundClosedConfirm', '当前轮次已关闭或正在评审。要为这个候选答案新建一轮吗？')
        );
        if (!shouldCreateFresh) {
            return;
        }
        roundId = '';
    }

    const questionIfCreate = String(refs.globalInput?.value || '').trim()
        || state.activeRound?.question
        || t('candidateDefaultQuestion', '手动加入候选答案');

    const targetModelsIfCreate = getBroadcastTargets();
    const response = await sendMessage({
        type: 'ROUND_ADD_CANDIDATE',
        model,
        roundId,
        createRoundIfMissing: true,
        questionIfCreate,
        targetModelsIfCreate: targetModelsIfCreate.length > 0 ? targetModelsIfCreate : ENABLED_MODELS
    });

    if (response?.status === 'candidate_added') {
        if (response.roundId) {
            await loadRound(response.roundId);
        }
        if (response.duplicate) {
            window.alert(t('candidateDuplicate', '这条回答已经在当前轮次里了，没有重复加入。'));
        }
        return;
    }

    window.alert(t('candidateAddFailedPrefix', '加入候选失败：{0}', [
        localizeBackgroundError(response) || t('candidateAddFailed', '加入候选失败。')
    ]));
}

async function onDeleteRound() {
    if (!state.activeRoundId) {
        window.alert(t('deleteRoundNoActive', '当前没有可删除的轮次。'));
        return;
    }

    const confirmed = window.confirm(
        t('deleteRoundConfirm', '确定删除当前轮次吗？此操作无法撤销。')
    );
    if (!confirmed) {
        return;
    }

    const response = await sendMessage({
        type: 'ROUND_DELETE',
        roundId: state.activeRoundId
    });

    if (response?.status === 'round_deleted') {
        clearActiveRound();
        await loadLatestRound();
        window.alert(t('roundDeleted', '当前轮次已删除。'));
        return;
    }

    window.alert(t('deleteRoundFailedPrefix', '删除轮次失败：{0}', [
        localizeBackgroundError(response) || 'Unknown error'
    ]));
}

async function onStartReview() {
    if (!state.activeRoundId || !state.activeRound) {
        window.alert(t('reviewNoRound', '当前没有活动轮次，请先群发创建一轮。'));
        return;
    }

    const judgeModels = getJudgeModels();
    if (judgeModels.length === 0) {
        window.alert(t('reviewSelectJudge', '请至少选择一个评委模型。'));
        return;
    }

    const mode = getCurrentReviewMode();
    const labelMode = getCurrentLabelMode();
    const candidateCount = Array.isArray(state.activeRound.candidates) ? state.activeRound.candidates.length : 0;

    if (mode === REVIEW_MODES.scoring && candidateCount < 2) {
        window.alert(t('reviewScoringMinCandidates', '评分评审至少需要 2 个候选答案。'));
        return;
    }
    if (mode === REVIEW_MODES.discussion && candidateCount < 1) {
        window.alert(t('reviewDiscussionMinCandidates', '讨论评审至少需要 1 个候选答案。'));
        return;
    }

    if (state.activeRound.status === 'reviewing') {
        const restart = window.confirm(
            t('reviewRestartConfirm', '当前评审仍在进行中，重新开始会覆盖未完成结果。要继续吗？')
        );
        if (!restart) {
            return;
        }
    }

    if (mode === REVIEW_MODES.scoring && judgeModels.length < 2) {
        const proceed = window.confirm(
            t('reviewLowJudgeCountConfirm', '评分评审少于 2 个评委时结果可能不稳定。要继续吗？')
        );
        if (!proceed) {
            return;
        }
    }

    await persistCurrentTemplate();
    state.isStartingReview = true;
    syncReviewControlsState();

    const response = await sendMessage({
        type: 'ROUND_START_REVIEW',
        roundId: state.activeRoundId,
        judgeModels,
        promptTemplate: refs.reviewTemplate?.value || getDefaultTemplateByMode(mode),
        mode,
        labelMode,
        weights: FIXED_WEIGHTS,
        selfReviewWeight: state.settings.selfReviewWeight
    });

    state.isStartingReview = false;
    syncReviewControlsState();

    if (response?.status === 'review_started') {
        await loadRound(state.activeRoundId);
        window.alert(t('reviewStarted', '评审任务已经启动。'));
        return;
    }

    window.alert(t('reviewStartFailedPrefix', '启动评审失败：{0}', [
        localizeBackgroundError(response) || t('reviewStartFailed', '启动评审失败。')
    ]));
}

async function onResetTemplate() {
    const mode = getCurrentReviewMode();
    const key = getTemplateKeyByMode(mode);
    const nextTemplate = getDefaultTemplateByMode(mode);
    state.settings[key] = nextTemplate;
    refs.reviewTemplate.value = nextTemplate;
    await saveRtSettings({ [key]: nextTemplate });
}

async function onReviewModeChange() {
    const previousMode = state.reviewMode;
    const nextMode = getCurrentReviewMode();

    if (previousMode !== nextMode) {
        const previousKey = getTemplateKeyByMode(previousMode);
        const previousTemplate = refs.reviewTemplate?.value || getDefaultTemplateByMode(previousMode);
        state.settings[previousKey] = previousTemplate;
        await saveRtSettings({ [previousKey]: previousTemplate });
    }

    state.reviewMode = nextMode;
    state.settings.reviewMode = nextMode;
    await saveRtSettings({ reviewMode: nextMode });
    refreshTemplateEditorForCurrentMode();
    updateReviewModeUI();
}

async function onLabelModeChange() {
    const nextMode = getCurrentLabelMode();
    state.labelMode = nextMode;
    state.settings.labelMode = nextMode;
    await saveRtSettings({ labelMode: nextMode });
}

async function persistCurrentTemplate() {
    const mode = getCurrentReviewMode();
    const key = getTemplateKeyByMode(mode);
    const value = String(refs.reviewTemplate?.value || '').trim() || getDefaultTemplateByMode(mode);
    state.settings[key] = value;
    await saveRtSettings({ [key]: value });
}

function refreshTemplateEditorForCurrentMode() {
    const mode = getCurrentReviewMode();
    const key = getTemplateKeyByMode(mode);
    refs.reviewTemplate.value = String(state.settings[key] || getDefaultTemplateByMode(mode));
}

function updateReviewModeUI() {
    const mode = getCurrentReviewMode();
    refs.startReviewBtn.textContent = mode === REVIEW_MODES.discussion
        ? t('actionStartDiscussionReview', '开始讨论评审')
        : t('actionStartScoringReview', '开始评分评审');
    refs.reviewTemplate.placeholder = mode === REVIEW_MODES.discussion
        ? t('reviewTemplatePlaceholderDiscussion', '讨论模板（支持 {{question}} 和 {{answers}}）')
        : t('reviewTemplatePlaceholderScoring', '评分模板（支持 {{question}} 和 {{answers}}）');
}

function syncReviewControlsState() {
    const pending = state.isStartingReview === true;
    refs.reviewTemplate.disabled = pending;
    refs.reviewMode.disabled = pending;
    refs.labelMode.disabled = pending;
    refs.startReviewBtn.disabled = pending || !state.activeRoundId;
    refs.deleteRoundBtn.disabled = !state.activeRoundId;
}

function renderCards() {
    DISPLAY_MODELS.forEach((model) => renderCard(model));
}

function renderCard(model) {
    const card = document.getElementById(MODEL_CARD_MAP[model]);
    if (!card) return;

    if (isDisabledModel(model)) {
        card.classList.add('disabled');
        const dot = card.querySelector('.status-dot');
        const statusText = card.querySelector('.status-text');
        const body = card.querySelector('.card-body');
        const actions = card.querySelectorAll('.card-actions button');
        dot?.classList.remove('active', 'thinking');
        if (statusText) {
            statusText.textContent = t('statusDisabled', '已禁用');
        }
        if (body) {
            body.textContent = getModelDisabledMessage(model);
        }
        actions.forEach((button) => {
            button.disabled = true;
            button.title = getModelDisabledMessage(model);
        });
        return;
    }

    card.classList.remove('disabled');

    const payload = state.modelState[model] || {};
    const status = String(payload.status || 'idle').trim();
    const summary = String(payload.lastSummary || payload.summary || '').trim();

    const dot = card.querySelector('.status-dot');
    const statusText = card.querySelector('.status-text');
    const body = card.querySelector('.card-body');

    dot?.classList.remove('active', 'thinking');
    if (status === 'generating') {
        dot?.classList.add('thinking');
    } else if (summary) {
        dot?.classList.add('active');
    }

    if (statusText) {
        statusText.textContent = status === 'generating'
            ? t('statusGenerating', '生成中')
            : t('statusIdle', '空闲');
    }

    if (body) {
        body.textContent = summary || t('waitingForResponse', '等待响应...');
    }
}

function updateCard(model, status, summary) {
    if (!model || !DISPLAY_MODELS.includes(model) || isDisabledModel(model)) return;
    const nextSummary = String(summary || '').trim();
    state.modelState[model] = {
        ...(state.modelState[model] || {}),
        status: String(status || '').trim() || 'idle',
        lastSummary: nextSummary || state.modelState[model]?.lastSummary || ''
    };
    renderCard(model);
}

function renderRound() {
    const round = state.activeRound;
    refs.roundId.textContent = round?.roundId || '—';
    refs.roundStatus.textContent = round ? getRoundStatusLabel(round.status) : t('roundStatusNone', '无');
    refs.roundCandidateCount.textContent = String(round?.candidates?.length || round?.candidateIds?.length || 0);
    refs.roundCreatedAt.textContent = round?.createdAt ? formatDateTime(round.createdAt) : '—';
    refs.roundQuestion.textContent = round?.question || t('roundNoActive', '当前没有活动轮次。');
}

function renderReviewProgress() {
    if (!state.activeRound) {
        refs.reviewProgress.textContent = t('reviewHasNotStarted', '评审尚未开始。');
        return;
    }

    const evaluations = Array.isArray(state.activeRound.evaluations) ? state.activeRound.evaluations : [];
    if (evaluations.length === 0) {
        refs.reviewProgress.textContent = t('reviewProgressWaiting', '等待开始评审。');
        return;
    }

    const progress = buildReviewProgress(evaluations);
    refs.reviewProgress.textContent = t('reviewProgressSummary', '已完成 {0} / 失败 {1} / 等待中 {2}', [
        progress.done,
        progress.failed,
        progress.pending
    ]);
}
function renderJudgeStatusList() {
    if (!refs.judgeStatusList) return;
    const evaluations = Array.isArray(state.activeRound?.evaluations) ? state.activeRound.evaluations : [];

    if (evaluations.length === 0) {
        refs.judgeStatusList.innerHTML = `<div class="empty">${escapeHtml(
            t('judgeTasksEmpty', '还没有评委任务。')
        )}</div>`;
        return;
    }

    refs.judgeStatusList.innerHTML = evaluations
        .map((evaluation) => `
            <div class="judge-status-row">
                <div class="judge-status-main">
                    <span class="judge-status-model">${escapeHtml(evaluation.judgeModel || 'Unknown')}</span>
                    <span class="status-pill ${escapeHtml(getJudgeStatusClass(evaluation.status))}">${escapeHtml(
                        getJudgeStatusLabel(evaluation.status)
                    )}</span>
                </div>
                <div class="judge-status-detail">${escapeHtml(buildJudgeStatusDetail(evaluation))}</div>
            </div>
        `)
        .join('');
}

function renderResultBoard() {
    if (!refs.resultBoard) return;
    if (!state.activeRound) {
        refs.resultBoard.innerHTML = `<div class="empty">${escapeHtml(t('resultsEmpty', '暂无结果。'))}</div>`;
        return;
    }

    const mode = normalizeReviewMode(state.activeRound?.config?.reviewMode || state.reviewMode);
    if (mode === REVIEW_MODES.discussion) {
        renderDiscussionResults();
        return;
    }

    renderScoringResults();
}

function renderDiscussionResults() {
    const evaluations = (state.activeRound?.evaluations || []).filter((evaluation) => evaluation.status === 'done');
    if (evaluations.length === 0) {
        refs.resultBoard.innerHTML = `<div class="empty">${escapeHtml(
            t('discussionResultEmpty', '暂无讨论结果。')
        )}</div>`;
        return;
    }

    const candidates = Array.isArray(state.activeRound?.candidates) ? state.activeRound.candidates : [];
    const importRow = candidates.length > 0
        ? `
            <div class="discussion-import-row">
                ${candidates.map((candidate) => `
                    <button
                        class="btn btn-neutral btn-small btn-import-review"
                        data-candidate-id="${escapeHtml(candidate.candidateId || '')}"
                    >${escapeHtml(t('actionImportReview', '导入评审'))} · ${escapeHtml(candidate.model || 'Unknown')}</button>
                `).join('')}
            </div>
        `
        : '';

    refs.resultBoard.innerHTML = importRow + evaluations
        .map((evaluation) => `
            <div class="rank-row">
                <div class="rank-title">${escapeHtml(evaluation.judgeModel || 'Unknown')}</div>
                <div class="small-muted">${escapeHtml(t('discussionStatusLabel', '状态'))}：${escapeHtml(
                    getJudgeStatusLabel(evaluation.status)
                )}</div>
                <div class="rank-judge-text">${escapeHtml(evaluation.rawResponse || '')}</div>
            </div>
        `)
        .join('');
}

function renderScoringResults() {
    const ranking = Array.isArray(state.activeRound?.ranking) ? state.activeRound.ranking : [];
    const candidates = Array.isArray(state.activeRound?.candidates) ? state.activeRound.candidates : [];
    const candidateMap = Object.fromEntries(candidates.map((candidate) => [candidate.candidateId, candidate]));

    if (ranking.length === 0) {
        refs.resultBoard.innerHTML = `<div class="empty">${escapeHtml(
            t('resultNoRanking', '暂无排名结果。')
        )}</div>`;
        return;
    }

    if (!state.selectedCandidateId || !ranking.some((item) => item.candidateId === state.selectedCandidateId)) {
        state.selectedCandidateId = ranking[0].candidateId;
    }

    refs.resultBoard.innerHTML = ranking
        .map((item, index) => {
            const candidate = candidateMap[item.candidateId];
            const isSelected = state.selectedCandidateId === item.candidateId;
            return `
                <div class="rank-row ${isSelected ? 'selected' : ''}" data-candidate-id="${escapeHtml(item.candidateId)}">
                    <div class="rank-title">#${index + 1} ${escapeHtml(candidate?.model || 'Unknown')}</div>
                    <div class="small-muted">
                        ${escapeHtml(t('resultFinalScoreLabel', '最终分'))}: ${formatScore(item.finalScore)}
                        · ${escapeHtml(t('resultRawLabel', '原始'))}: ${formatScore(item.rawMean)}
                        · ${escapeHtml(t('resultNormalizedLabel', '归一化'))}: ${formatScore(item.normalizedMean)}
                        · ${escapeHtml(t('resultNonSelfLabel', '非自评'))}: ${formatScore(item.nonSelfMean)}
                        · ${escapeHtml(t('resultVarianceLabel', '方差'))}: ${formatScore(item.variance)}
                    </div>
                    <div class="small-muted">${escapeHtml(
                        isSelected
                            ? t('resultCollapseHint', '点击收起评委明细')
                            : t('resultExpandHint', '点击展开评委明细')
                    )}</div>
                    ${isSelected ? `<div class="rank-details">${buildCandidateDetailsHtml(item.candidateId, candidate)}</div>` : ''}
                </div>
            `;
        })
        .join('');
}

function buildCandidateDetailsHtml(candidateId, candidate) {
    const details = collectCandidateJudgeDetails(candidateId, candidate);
    if (details.length === 0) {
        return `
            <div class="rank-detail-actions">
                <button class="btn btn-neutral btn-small btn-import-review" data-candidate-id="${escapeHtml(candidateId)}">${escapeHtml(
                    t('actionImportReview', '导入评审')
                )}</button>
            </div>
            <div class="rank-details-empty">${escapeHtml(
                t('resultNoCompletedJudge', '评委尚未完成有效评分。')
            )}</div>
        `;
    }
    return `
        <div class="rank-detail-actions">
            <button class="btn btn-neutral btn-small btn-import-review" data-candidate-id="${escapeHtml(candidateId)}">${escapeHtml(
                t('actionImportReview', '导入评审')
            )}</button>
        </div>
        ${details.join('')}
    `;
}

function collectCandidateJudgeDetails(candidateId, candidate) {
    const evaluations = Array.isArray(state.activeRound?.evaluations) ? state.activeRound.evaluations : [];
    return evaluations
        .filter((evaluation) => evaluation.status === 'done')
        .map((evaluation) => {
            const row = findParsedScoreForCandidate(evaluation, candidateId);
            if (!row) return '';

            const metrics = [
                `accuracy ${formatScore(row.accuracy)}`,
                `completeness ${formatScore(row.completeness)}`,
                `actionability ${formatScore(row.actionability)}`,
                `clarity ${formatScore(row.clarity)}`,
                `overall ${formatScore(row.overall)}`
            ].join(' · ');

            const evidenceText = Array.isArray(row.evidence) ? row.evidence.filter(Boolean).join('；') : '';
            const isSelf = candidate?.model && candidate.model === evaluation.judgeModel;

            return `
                <div class="rank-judge-row">
                    <div class="rank-judge-head">
                        <div class="rank-judge-left">
                            <span class="rank-judge-model">${escapeHtml(evaluation.judgeModel || 'Unknown')}</span>
                            ${isSelf ? `<span class="judge-source-tag">${escapeHtml(t('judgeSourceSelf', '自评'))}</span>` : ''}
                        </div>
                        <span class="small-muted">${escapeHtml(buildJudgeStatusDetail(evaluation))}</span>
                    </div>
                    <div class="rank-judge-metrics">${escapeHtml(metrics)}</div>
                    ${row.reason ? `<div class="rank-judge-text">${escapeHtml(t('judgeReasonLabel', '理由：'))}${escapeHtml(row.reason)}</div>` : ''}
                    ${evidenceText ? `<div class="rank-judge-text">${escapeHtml(t('judgeEvidenceLabel', '证据：'))}${escapeHtml(evidenceText)}</div>` : ''}
                </div>
            `;
        })
        .filter(Boolean);
}

function findParsedScoreForCandidate(evaluation, candidateId) {
    const rows = Array.isArray(evaluation?.parsedScores) ? evaluation.parsedScores : [];
    return rows.find((row) => {
        const slot = String(row?.slot || '').trim().toUpperCase();
        return (evaluation.blindMap || {})[slot] === candidateId;
    }) || null;
}

function onToggleCandidateDetails(candidateId) {
    if (!candidateId) return;
    state.selectedCandidateId = state.selectedCandidateId === candidateId ? null : candidateId;
    renderResultBoard();
}

function buildReviewProgress(evaluations) {
    const done = evaluations.filter((evaluation) => evaluation.status === 'done').length;
    const failed = evaluations.filter((evaluation) => ['parse_failed', 'timeout'].includes(evaluation.status)).length;
    return {
        total: evaluations.length,
        done,
        failed,
        pending: Math.max(0, evaluations.length - done - failed)
    };
}

function buildJudgeStatusDetail(evaluation) {
    const status = String(evaluation?.status || '').trim();
    if (status === 'pending' || status === 'generating') {
        return t('evalWaiting', '等待评委回复...');
    }
    if (status === 'timeout') {
        return t('evalTimeoutPrefix', '超时：{0}', [
            String(evaluation?.normalizeError || t('evalTimeoutDefault', '评审超时')).trim()
        ]);
    }
    if (status === 'parse_failed') {
        return t('evalParseFailedPrefix', '解析失败：{0}', [
            truncateText(String(evaluation?.normalizeError || evaluation?.rawResponse || '').trim(), 120)
        ]);
    }
    if (status !== 'done') {
        return status || t('evalWaiting', '等待评委回复...');
    }

    if (normalizeReviewMode(evaluation.mode) === REVIEW_MODES.discussion) {
        const length = Number(evaluation?.rawSummaryChars || String(evaluation?.rawResponse || '').length || 0);
        return length > 0
            ? t('evalDiscussionCapturedWithLength', '已捕获讨论回复（{0} 个字符）。', [length])
            : t('evalDiscussionCaptured', '已捕获讨论回复。');
    }

    const itemCount = Array.isArray(evaluation?.parsedScores) ? evaluation.parsedScores.length : 0;
    if (evaluation?.normalizedBy) {
        return t('evalParsedScoreItemsDeepseek', '已解析 {0} 条评分，使用 deepseek-chat 做归一化，并保留原始理由与证据。', [
            itemCount
        ]);
    }

    return t('evalParsedScoreItems', '已解析 {0} 条评分。', [itemCount]);
}

function getJudgeStatusClass(status) {
    return ['done', 'pending', 'parse_failed', 'timeout'].includes(status) ? status : 'pending';
}

function getJudgeStatusLabel(status) {
    switch (String(status || '').trim()) {
        case 'done':
            return t('judgeStatusDone', '已完成');
        case 'parse_failed':
            return t('judgeStatusParseFailed', '解析失败');
        case 'timeout':
            return t('judgeStatusTimeout', '超时');
        default:
            return t('judgeStatusPending', '进行中');
    }
}

function getRoundStatusLabel(status) {
    switch (String(status || '').trim()) {
        case 'collecting':
            return t('roundStatusCollecting', '收集中');
        case 'reviewing':
            return t('roundStatusReviewing', '评审中');
        case 'completed':
            return t('roundStatusCompleted', '已完成');
        case 'failed':
            return t('roundStatusFailed', '失败');
        default:
            return t('roundStatusNone', '无');
    }
}
