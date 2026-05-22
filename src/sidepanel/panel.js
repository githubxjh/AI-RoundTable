import {
    DEFAULT_SETTINGS,
    RT_KEYS,
    Storage,
    getRtSettings,
    saveRtSettings
} from '../utils/storage.js';
import {
    DEFAULT_ANALYSIS_PROVIDER,
    buildAnalysisProviderOriginPattern,
    normalizeAnalysisProviderConfig
} from '../utils/analysis_provider.mjs';
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
const DISPLAY_MODELS = ['ChatGPT', 'Grok', 'Gemini', 'Doubao', 'DeepSeek', 'Claude'];

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
const BROADCAST_DROP_HINT_FALLBACK = '附件上传测试中：可以粘贴或拖拽文件，最多 3 个、每个不超过 5MB。部分模型可能无法带附件发送，系统会尝试降级为纯文本；重要内容建议直接粘贴到问题里。';

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
    analysisProviderKeyVisible: false,
    ...createEmptyRouterPresetState()
};

const refs = {};
let pendingConfirmResolve = null;

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
    setBroadcastStatus('info', t('broadcastDropHint', BROADCAST_DROP_HINT_FALLBACK));
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
    refs.toastRoot = document.getElementById('toast-root');
    refs.quoteList = document.getElementById('quote-list');
    refs.clearQuotesBtn = document.getElementById('clear-quotes');
    refs.routerPreview = document.getElementById('router-preview');
    refs.routerFollowupControls = document.getElementById('router-followup-controls');
    refs.routerFollowupSource = document.getElementById('router-followup-source');
    refs.routerInput = document.getElementById('router-input');
    refs.routeTargetsHint = document.getElementById('route-targets-hint');
    refs.routeBtn = document.getElementById('route-btn');
    refs.reviewMode = document.getElementById('review-mode');
    refs.reviewModeHelp = document.getElementById('review-mode-help');
    refs.labelMode = document.getElementById('label-mode');
    refs.labelModeHelp = document.getElementById('label-mode-help');
    refs.analysisProviderPanel = document.getElementById('analysis-provider-panel');
    refs.analysisProviderSummary = document.getElementById('analysis-provider-summary');
    refs.analysisProviderEnabled = document.getElementById('analysis-provider-enabled');
    refs.analysisProviderBaseUrl = document.getElementById('analysis-provider-base-url');
    refs.analysisProviderModel = document.getElementById('analysis-provider-model');
    refs.analysisProviderApiKey = document.getElementById('analysis-provider-api-key');
    refs.analysisProviderToggleKey = document.getElementById('analysis-provider-toggle-key');
    refs.analysisProviderThinkingMode = document.getElementById('analysis-provider-thinking-mode');
    refs.analysisProviderReasoningEffort = document.getElementById('analysis-provider-reasoning-effort');
    refs.analysisProviderResponseFormat = document.getElementById('analysis-provider-response-format');
    refs.analysisProviderTimeout = document.getElementById('analysis-provider-timeout');
    refs.analysisProviderSaveBtn = document.getElementById('analysis-provider-save-btn');
    refs.analysisProviderTestBtn = document.getElementById('analysis-provider-test-btn');
    refs.analysisProviderStatus = document.getElementById('analysis-provider-status');
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
    refs.confirmModal = document.getElementById('confirm-modal');
    refs.confirmModalTitle = document.getElementById('confirm-modal-title');
    refs.confirmModalMessage = document.getElementById('confirm-modal-message');
    refs.confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    refs.confirmOkBtn = document.getElementById('confirm-ok-btn');
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
    refs.analysisProviderToggleKey?.addEventListener('click', onToggleAnalysisProviderKey);
    refs.analysisProviderSaveBtn?.addEventListener('click', () => { void onSaveAnalysisProvider(); });
    refs.analysisProviderTestBtn?.addEventListener('click', () => { void onTestAnalysisProvider(); });
    refs.reviewTemplate?.addEventListener('change', () => { void persistCurrentTemplate(); });
    refs.confirmCancelBtn?.addEventListener('click', () => resolveConfirm(false));
    refs.confirmOkBtn?.addEventListener('click', () => resolveConfirm(true));
    refs.confirmModal?.addEventListener('click', (event) => {
        if (event.target === refs.confirmModal) {
            resolveConfirm(false);
        }
    });
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
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            resolveConfirm(false);
        }
    });
    chrome.runtime.onMessage.addListener((message) => {
        void handleRuntimeMessage(message);
    });
}

function showToast(message, level = 'info') {
    const text = String(message || '').trim();
    if (!text || !refs.toastRoot) return null;

    const toast = document.createElement('div');
    const normalizedLevel = ['success', 'error', 'warning'].includes(level) ? level : 'info';
    toast.className = `toast ${normalizedLevel}`;

    const messageNode = document.createElement('div');
    messageNode.className = 'toast-message';
    messageNode.textContent = text;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'toast-close';
    closeButton.title = t('toastClose', '关闭');
    closeButton.setAttribute('aria-label', t('toastClose', '关闭'));
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => toast.remove());

    toast.append(messageNode, closeButton);
    refs.toastRoot.append(toast);

    const duration = normalizedLevel === 'success' ? 2000 : 4000;
    setTimeout(() => toast.remove(), duration);
    return toast;
}

function showConfirm(message, {
    title = t('confirmModalTitle', '请确认'),
    confirmLabel = t('confirmOk', '确认'),
    cancelLabel = t('confirmCancel', '取消')
} = {}) {
    const text = String(message || '').trim();
    if (!text || !refs.confirmModal || !refs.confirmModalTitle || !refs.confirmModalMessage || !refs.confirmOkBtn || !refs.confirmCancelBtn) {
        return Promise.resolve(false);
    }

    resolveConfirm(false);

    refs.confirmModalTitle.textContent = title;
    refs.confirmModalMessage.textContent = text;
    refs.confirmOkBtn.textContent = confirmLabel;
    refs.confirmCancelBtn.textContent = cancelLabel;
    refs.confirmModal.hidden = false;
    refs.confirmOkBtn.focus();

    return new Promise((resolve) => {
        pendingConfirmResolve = resolve;
    });
}

function resolveConfirm(value) {
    if (!pendingConfirmResolve) return;
    const resolve = pendingConfirmResolve;
    pendingConfirmResolve = null;
    if (refs.confirmModal) {
        refs.confirmModal.hidden = true;
    }
    resolve(Boolean(value));
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
            showToast(getModelDisabledMessage(source), 'warning');
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
                showToast(getModelDisabledMessage(model), 'warning');
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
    renderAnalysisProviderSettings();
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

function getAnalysisProviderFromForm({ forceEnabled = false } = {}) {
    const previous = normalizeAnalysisProviderConfig(state.settings.analysisProvider || {});
    return normalizeAnalysisProviderConfig({
        ...previous,
        enabled: forceEnabled ? true : refs.analysisProviderEnabled?.checked === true,
        baseUrl: refs.analysisProviderBaseUrl?.value || DEFAULT_ANALYSIS_PROVIDER.baseUrl,
        model: refs.analysisProviderModel?.value || DEFAULT_ANALYSIS_PROVIDER.model,
        apiKey: refs.analysisProviderApiKey?.value || '',
        thinkingMode: refs.analysisProviderThinkingMode?.value || DEFAULT_ANALYSIS_PROVIDER.thinkingMode,
        reasoningEffort: refs.analysisProviderReasoningEffort?.value || DEFAULT_ANALYSIS_PROVIDER.reasoningEffort,
        responseFormatJson: refs.analysisProviderResponseFormat?.checked !== false,
        timeoutMs: refs.analysisProviderTimeout?.value || DEFAULT_ANALYSIS_PROVIDER.timeoutMs
    });
}

function renderAnalysisProviderSettings() {
    const provider = normalizeAnalysisProviderConfig(state.settings.analysisProvider || {});
    if (refs.analysisProviderEnabled) refs.analysisProviderEnabled.checked = provider.enabled;
    if (refs.analysisProviderBaseUrl) refs.analysisProviderBaseUrl.value = provider.baseUrl;
    if (refs.analysisProviderModel) refs.analysisProviderModel.value = provider.model;
    if (refs.analysisProviderApiKey) {
        refs.analysisProviderApiKey.value = provider.apiKey || '';
        refs.analysisProviderApiKey.type = state.analysisProviderKeyVisible ? 'text' : 'password';
    }
    if (refs.analysisProviderToggleKey) {
        refs.analysisProviderToggleKey.textContent = state.analysisProviderKeyVisible
            ? t('analysisProviderHideKey', '隐藏')
            : t('analysisProviderShowKey', '显示');
    }
    if (refs.analysisProviderThinkingMode) refs.analysisProviderThinkingMode.value = provider.thinkingMode;
    if (refs.analysisProviderReasoningEffort) refs.analysisProviderReasoningEffort.value = provider.reasoningEffort;
    if (refs.analysisProviderResponseFormat) refs.analysisProviderResponseFormat.checked = provider.responseFormatJson !== false;
    if (refs.analysisProviderTimeout) refs.analysisProviderTimeout.value = String(provider.timeoutMs);
    updateAnalysisProviderSummary(provider);
}

function updateAnalysisProviderSummary(provider = normalizeAnalysisProviderConfig(state.settings.analysisProvider || {})) {
    if (!refs.analysisProviderSummary) return;
    refs.analysisProviderSummary.textContent = provider.enabled
        ? t('analysisProviderSummaryEnabled', '已启用：{0}', [provider.model])
        : t('analysisProviderSummaryDisabled', '未启用');
}

function setAnalysisProviderStatus(level, message) {
    if (!refs.analysisProviderStatus) return;
    const normalizedLevel = ['success', 'error', 'warn'].includes(level) ? level : 'info';
    refs.analysisProviderStatus.className = `file-status ${normalizedLevel}`;
    refs.analysisProviderStatus.textContent = message || '';
    refs.analysisProviderStatus.hidden = !message;
}

function onToggleAnalysisProviderKey() {
    state.settings.analysisProvider = getAnalysisProviderFromForm();
    state.analysisProviderKeyVisible = !state.analysisProviderKeyVisible;
    renderAnalysisProviderSettings();
}

async function onSaveAnalysisProvider() {
    let provider = getAnalysisProviderFromForm();
    const permission = await ensureAnalysisProviderPermission(provider);
    if (provider.enabled && !permission) {
        provider = normalizeAnalysisProviderConfig({ ...provider, enabled: false });
        setAnalysisProviderStatus('warn', t(
            'analysisProviderPermissionDenied',
            '浏览器尚未授权访问该接口地址，配置已保存但分析模型暂未启用。'
        ));
    } else {
        setAnalysisProviderStatus('success', t('analysisProviderSaved', '分析模型配置已保存。'));
    }

    state.settings.analysisProvider = provider;
    state.settings = await saveRtSettings({ analysisProvider: provider });
    renderAnalysisProviderSettings();
}

async function onTestAnalysisProvider() {
    const provider = getAnalysisProviderFromForm({ forceEnabled: true });
    if (!provider.apiKey) {
        setAnalysisProviderStatus('error', t('analysisProviderKeyRequired', '请先填写 API Key。'));
        return;
    }

    const permission = await ensureAnalysisProviderPermission(provider);
    if (!permission) {
        setAnalysisProviderStatus('error', t('analysisProviderPermissionRequired', '浏览器尚未授权访问该接口地址，无法测试连接。'));
        return;
    }

    setAnalysisProviderStatus('info', t('analysisProviderTesting', '正在测试分析模型连接...'));
    const response = await sendMessage({
        type: 'ANALYSIS_PROVIDER_TEST',
        provider
    });
    if (response?.status === 'ok') {
        setAnalysisProviderStatus('success', t('analysisProviderTestOk', '连接测试通过：{0}', [response.model || provider.model]));
        return;
    }
    setAnalysisProviderStatus('error', localizeBackgroundError(response) || t('analysisProviderTestFailed', '连接测试失败，请检查配置。'));
}

async function ensureAnalysisProviderPermission(provider) {
    if (!provider.enabled) return true;
    if (!chrome.permissions?.contains || !chrome.permissions?.request) return true;
    let origins;
    try {
        origins = [buildAnalysisProviderOriginPattern(provider)];
    } catch {
        setAnalysisProviderStatus('error', t('analysisProviderInvalidBaseUrl', '接口地址无效，请填写 https:// 开头的地址。'));
        return false;
    }

    const hasPermission = await chrome.permissions.contains({ origins }).catch(() => false);
    if (hasPermission) return true;
    return chrome.permissions.request({ origins }).catch(() => false);
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
            return t('candidateInvalidRequest', '纳入本轮时请求无效。');
        case 'candidate_answer_missing':
            return t('reviewNoCandidateAnswer', '当前轮次还没有可用候选答案，请先纳入本轮。');
        case 'broadcast_no_supported_targets':
            return t('broadcastNoSupportedTargets', '所选模型都不支持当前附件。');
        case 'invalid_attachments':
            return t('invalidAttachments', '附件数据无效，请重新选择文件。');
        case 'model_disabled':
            return t('modelDisabledGeneric', '该模型暂不允许使用。');
        case 'analysis_provider_disabled':
            return t('analysisProviderDisabledError', '分析模型尚未启用。');
        case 'analysis_provider_api_key_missing':
            return t('analysisProviderKeyRequired', '请先填写 API Key。');
        case 'analysis_provider_permission_missing':
            return t('analysisProviderPermissionRequired', '浏览器尚未授权访问该接口地址，无法测试连接。');
        case 'analysis_provider_timeout':
            return t('analysisProviderTimeoutError', '分析模型请求超时，请稍后重试或调大超时时间。');
        case 'analysis_provider_http_401':
        case 'analysis_provider_http_403':
            return t('analysisProviderAuthError', '分析模型鉴权失败，请检查 API Key。');
        case 'analysis_provider_http_404':
            return t('analysisProviderNotFoundError', '分析模型接口或模型名不可用，请检查接口地址和模型名。');
        case 'analysis_provider_http_429':
            return t('analysisProviderRateLimitError', '分析模型请求过于频繁或额度不足，请稍后重试。');
        case 'analysis_provider_json_failed':
        case 'analysis_provider_test_json_failed':
        case 'analysis_provider_missing_content':
            return t('analysisProviderJsonError', '分析模型没有按 JSON 格式返回，请检查模型是否支持 JSON 输出。');
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
        showToast(t('broadcastEnterQuestion', '请先输入问题再同时提问。'), 'warning');
        return;
    }

    const targets = getBroadcastTargets();
    if (targets.length === 0) {
        showToast(t('broadcastSelectTargetModel', '请至少选择一个目标模型。'), 'warning');
        return;
    }

    const attachments = await serializeBroadcastFiles();
    setBroadcastStatus('info', t('broadcasting', '同时提问中...'));

    const response = await sendMessage({
        type: 'BROADCAST',
        text: question,
        targets,
        attachments
    });

    if (response?.status === 'error') {
        const localizedError = localizeBackgroundError(response)
            || t('broadcastFailedGeneric', '同时提问失败，请稍后重试。');
        setBroadcastStatus('error', t('broadcastFailedPrefix', '同时提问失败：{0}', [localizedError]));
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
            const reason = localizeBroadcastIssueReason(item);
            return reason ? `${model}: ${reason}` : model;
        })
        .filter(Boolean)
        .join('；');
}

function localizeBroadcastIssueReason(item) {
    const code = String(item?.code || '').trim();
    const reason = String(item?.reason || '').trim();
    const lowerReason = reason.toLowerCase();

    if (code === 'model_disabled') {
        return t('modelDisabledGeneric', '该模型暂不允许使用。');
    }
    if (code === 'attachment_type_rejected') {
        return t('attachmentTypeRejectedSummary', '该模型不接受当前附件类型或数量。');
    }
    if (code === 'attachment_input_not_found') {
        if (lowerReason.includes('deepseek') || lowerReason.includes('native user gesture')) {
            return t('attachmentDeepSeekManualRequiredSummary', 'DeepSeek 需要手动选择附件，当前自动发送无法代传附件，已改为纯文本。');
        }
        return t('attachmentInputMissingSummary', '没有找到可用的附件入口，已改为纯文本。');
    }
    if (code === 'attachment_upload_failed') {
        return t('attachmentUploadFailedSummary', '附件上传未完成，已尝试改为纯文本。');
    }
    if (code === 'send_failed') {
        return t('broadcastSendFailedSummary', '发送失败。');
    }
    if (lowerReason.includes('attachment upload is unsupported')) {
        return t('attachmentUnsupportedSummary', '该模型页面暂不支持自动附件上传。');
    }

    return reason;
}

function localizeEvaluationFailureReason(reason) {
    const value = String(reason || '').trim();
    const lowerValue = value.toLowerCase();
    if (lowerValue.includes('deepseek_remote_assist_disabled_public_build')) {
        return t('evalRemoteAssistDisabled', '公开测试版暂未启用远程评分归一化；请让评审模型按指定格式重新输出评分。');
    }
    if (lowerValue.includes('analysis_provider_disabled')) {
        return t('analysisProviderDisabledError', '分析模型尚未启用。');
    }
    if (lowerValue.includes('analysis_provider_api_key_missing')) {
        return t('analysisProviderKeyRequired', '请先填写 API Key。');
    }
    if (lowerValue.includes('analysis_provider_permission_missing')) {
        return t('analysisProviderPermissionMissingForReview', '浏览器尚未授权访问分析模型接口，已跳过远程归一化。');
    }
    if (lowerValue.includes('analysis_provider_timeout')) {
        return t('analysisProviderTimeoutForReview', '分析模型请求超时，已跳过远程归一化。');
    }
    if (lowerValue.includes('analysis_provider_http_401') || lowerValue.includes('analysis_provider_http_403')) {
        return t('analysisProviderAuthForReview', '分析模型鉴权失败，已跳过远程归一化。');
    }
    if (lowerValue.includes('analysis_provider_http_')) {
        return t('analysisProviderHttpForReview', '分析模型接口返回错误，已跳过远程归一化。');
    }
    if (lowerValue.includes('invalid_json') || lowerValue.includes('json')) {
        return t('evalParseFailedInvalidJson', '解析失败：输出不是有效 JSON。');
    }
    return truncateText(value, 120);
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
    void addIncomingFiles(input.files, t('sourceSelectedFiles', '选中文件'));
    input.value = '';
}

function onPanelPaste(event) {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) {
        return;
    }
    event.preventDefault();
    void addIncomingFiles(files, t('sourcePastedFiles', '粘贴文件'));
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
    void addIncomingFiles(event.dataTransfer?.files, t('sourceDroppedFiles', '拖拽文件'));
}

function hasFilePayload(dataTransfer) {
    const types = Array.from(dataTransfer?.types || []);
    return types.includes('Files');
}

async function addIncomingFiles(fileList, sourceLabel) {
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
    if (duplicates.length > 0 && await showConfirm(t('duplicateFilesConfirm', '检测到 {0} 个重复文件，仍然保留吗？', [duplicates.length]))) {
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
        || t('broadcastDropHint', BROADCAST_DROP_HINT_FALLBACK);
}
function addQuote(source, text) {
    const quote = createQuoteItem({
        source,
        text,
        kind: ROUTER_QUOTE_KIND.answer
    });

    if (!quote || quote.text === t('waitingForResponse', '等待响应...')) {
        showToast(t('routeNoQuotes', '请至少引用一个模型回答后再路由。'), 'warning');
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
            t('routerQuotesEmpty', '点击“引用”把回答加入观点互评。')
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
        showToast(t('routePrimaryRequired', '请先选择一个分析角度，再添加额外要求。'), 'warning');
        return;
    }
    if (result.errorCode === 'followup_no_modifiers') {
        showToast(t('routeFollowupModifiersDisabled', '“回应评审”模式下不支持叠加额外要求。'), 'warning');
        return;
    }
    if (result.errorCode === 'modifier_limit_reached') {
        showToast(t('routeModifierLimitReached', '额外要求最多只能选择 {0} 个。', [MAX_ROUTER_MODIFIERS]), 'warning');
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
    updateRouteTargetsHint();

    const routeError = getRouteValidationError();

    if (refs.routerPreview) {
        refs.routerPreview.textContent = state.generatedRouterInstruction
            || t('routerGeneratedEmpty', '先选择一个分析角度，再按需叠加额外要求。');
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
    checkboxes.forEach(clearQuotedTargetState);

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
        const label = checkbox.closest('.checkbox-label');
        if (!isEnabledModel(checkbox.value)) {
            checkbox.checked = false;
            checkbox.disabled = true;
            if (label) {
                label.title = getModelDisabledMessage(checkbox.value);
            }
            return;
        }

        const shouldDisable = quotedSources.has(checkbox.value);
        if (shouldDisable) {
            if (!checkbox.disabled && checkbox.checked) {
                checkbox.dataset.restoreChecked = 'true';
            }
            checkbox.checked = false;
            checkbox.disabled = true;
            if (label) {
                label.dataset.quoted = 'true';
                label.title = t('routeTargetQuotedTitle', '该模型已在引用列表中，不能作为路由目标。');
            }
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

function clearQuotedTargetState(checkbox) {
    const label = checkbox.closest('.checkbox-label');
    if (!label) return;
    delete label.dataset.quoted;
    if (isEnabledModel(checkbox.value)) {
        label.removeAttribute('title');
    }
}

function updateRouteTargetsHint() {
    if (!refs.routeTargetsHint) return;

    const quotedSources = getQuotedEnabledSources();
    if (quotedSources.length === 0) {
        refs.routeTargetsHint.hidden = true;
        refs.routeTargetsHint.textContent = '';
        return;
    }

    if (isRespondReviewMode(state) && isEnabledModel(state.selectedFollowupSource)) {
        refs.routeTargetsHint.textContent = t(
            'routeTargetsFollowupHint',
            '回应评审已引用 {0} 的答案和外部反馈，路由目标会自动锁定为 {0}；如需改发其他模型，请先移除对应引用或切换分析角度。',
            [state.selectedFollowupSource]
        );
        refs.routeTargetsHint.hidden = false;
        return;
    }

    refs.routeTargetsHint.textContent = t(
        'routeTargetsQuotedHint',
        '已引用 {0} 的回答，这些模型不能作为路由目标；如需发送给它们，请先移除对应引用。',
        [formatModelList(quotedSources)]
    );
    refs.routeTargetsHint.hidden = false;
}

function getQuotedEnabledSources() {
    const seen = new Set();
    const sources = [];
    state.quoteList.forEach((item) => {
        const source = String(item?.source || '').trim();
        if (!source || seen.has(source) || !isEnabledModel(source)) return;
        seen.add(source);
        sources.push(source);
    });
    return sources;
}

function formatModelList(models) {
    return models.map((model) => String(model || '').trim()).filter(Boolean).join('、');
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
        showToast(routeError, 'warning');
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
        showToast(t('routeSentCount', '已向 {0} 个模型发起路由。', [response.sent_to || targets.length]), 'success');
        return;
    }

    showToast(t('routeFailedPrefix', '路由失败：{0}', [localizeBackgroundError(response) || 'Unknown error']), 'error');
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

function getImportedFeedbackCount(quoteList) {
    return (Array.isArray(quoteList) ? quoteList : [])
        .filter((item) => item?.kind === ROUTER_QUOTE_KIND.feedback)
        .length;
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
        return t('routeNoPrimary', '请先选择一个分析角度。');
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
        showToast(t('reviewNoRound', '当前没有活动轮次，请先同时提问创建一轮。'), 'warning');
        return;
    }

    const bundle = buildReviewImportBundle(state.activeRound, candidateId);
    if (bundle.errorCode) {
        switch (bundle.errorCode) {
            case 'candidate_not_found':
                showToast(t('routeImportCandidateMissing', '没有找到对应的候选答案。'), 'warning');
                return;
            case 'candidate_answer_missing':
                showToast(t('routeImportCandidateAnswerMissing', '该候选答案还没有可导入的原答案内容。'), 'warning');
                return;
            case 'followup_feedback_missing':
                showToast(t('routeImportFeedbackMissing', '还没有可导入的外部评审意见。'), 'warning');
                return;
            default:
                showToast(t('routeImportFailed', '导入评审失败，请稍后重试。'), 'error');
                return;
        }
    }

    if (isDisabledModel(bundle.followupSource)) {
        showToast(getModelDisabledMessage(bundle.followupSource), 'warning');
        return;
    }

    state.quoteList = bundle.quoteList;
    state.selectedPrimaryPresetId = FOLLOWUP_PRIMARY_PRESET_ID;
    state.selectedModifierPresetIds = [];
    state.selectedFollowupSource = bundle.followupSource;
    renderQuoteList();
    refreshRouterComposer();
    showToast(t(
        'routeImportSuccess',
        '已导入 {0} 的答案和 {1} 条外部评审意见。',
        [bundle.followupSource, getImportedFeedbackCount(bundle.quoteList)]
    ), 'success');
}

async function onAddCandidate(model) {
    if (isDisabledModel(model)) {
        showToast(getModelDisabledMessage(model), 'warning');
        return;
    }
    if (!isEnabledModel(model)) {
        showToast(t('unknownModel', '未知模型：{0}', [model]), 'warning');
        return;
    }

    let roundId = state.activeRoundId || '';
    if (state.activeRound && state.activeRound.status !== 'collecting') {
        const shouldCreateFresh = await showConfirm(
            t('candidateRoundClosedConfirm', '当前轮次已关闭或正在评审。要为这个候选答案新建一轮吗？')
        );
        if (!shouldCreateFresh) {
            return;
        }
        roundId = '';
    }

    const questionIfCreate = String(refs.globalInput?.value || '').trim()
        || state.activeRound?.question
        || t('candidateDefaultQuestion', '手动纳入候选答案');

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
            showToast(t('candidateDuplicate', '这条回答已经在当前轮次里了，没有重复纳入。'), 'warning');
        }
        return;
    }

    showToast(t('candidateAddFailedPrefix', '纳入本轮失败：{0}', [
        localizeBackgroundError(response) || t('candidateAddFailed', '纳入本轮失败。')
    ]), 'error');
}

async function onDeleteRound() {
    if (!state.activeRoundId) {
        showToast(t('deleteRoundNoActive', '当前没有可删除的轮次。'), 'warning');
        return;
    }

    const confirmed = await showConfirm(
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
        showToast(t('roundDeleted', '当前轮次已删除。'), 'success');
        return;
    }

    showToast(t('deleteRoundFailedPrefix', '删除轮次失败：{0}', [
        localizeBackgroundError(response) || 'Unknown error'
    ]), 'error');
}

async function onStartReview() {
    if (!state.activeRoundId || !state.activeRound) {
        showToast(t('reviewNoRound', '当前没有活动轮次，请先同时提问创建一轮。'), 'warning');
        return;
    }

    const judgeModels = getJudgeModels();
    if (judgeModels.length === 0) {
        showToast(t('reviewSelectJudge', '请至少选择一个评委模型。'), 'warning');
        return;
    }

    const mode = getCurrentReviewMode();
    const labelMode = getCurrentLabelMode();
    const candidateCount = Array.isArray(state.activeRound.candidates) ? state.activeRound.candidates.length : 0;

    if (mode === REVIEW_MODES.scoring && candidateCount < 2) {
        showToast(t('reviewScoringMinCandidates', '评分评审至少需要 2 个候选答案。'), 'warning');
        return;
    }
    if (mode === REVIEW_MODES.discussion && candidateCount < 1) {
        showToast(t('reviewDiscussionMinCandidates', '讨论评审至少需要 1 个候选答案。'), 'warning');
        return;
    }

    if (state.activeRound.status === 'reviewing') {
        const restart = await showConfirm(
            t('reviewRestartConfirm', '当前评审仍在进行中，重新开始会覆盖未完成结果。要继续吗？')
        );
        if (!restart) {
            return;
        }
    }

    if (mode === REVIEW_MODES.scoring && judgeModels.length < 2) {
        const proceed = await showConfirm(
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
        showToast(t('reviewStarted', '评审任务已经启动。'), 'success');
        return;
    }

    showToast(t('reviewStartFailedPrefix', '启动评审失败：{0}', [
        localizeBackgroundError(response) || t('reviewStartFailed', '启动评审失败。')
    ]), 'error');
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
    updateReviewModeUI();
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
    const labelMode = getCurrentLabelMode();
    refs.startReviewBtn.textContent = mode === REVIEW_MODES.discussion
        ? t('actionStartDiscussionReview', '开始讨论评审')
        : t('actionStartScoringReview', '开始评分评审');
    refs.reviewTemplate.placeholder = mode === REVIEW_MODES.discussion
        ? t('reviewTemplatePlaceholderDiscussion', '讨论模板（支持 {{question}} 和 {{answers}}）')
        : t('reviewTemplatePlaceholderScoring', '评分模板（支持 {{question}} 和 {{answers}}）');

    if (refs.reviewModeHelp) {
        refs.reviewModeHelp.textContent = mode === REVIEW_MODES.discussion
            ? t('reviewModeDiscussionHelp', '让评委输出文字评价，不要求打分。')
            : t('reviewModeScoringHelp', '让评委按维度打分，并汇总排名。');
    }
    if (refs.labelModeHelp) {
        refs.labelModeHelp.textContent = labelMode === LABEL_MODES.named
            ? t('labelModeNamedHelp', '显示模型来源，便于追踪每条答案来自哪个 AI。')
            : t('labelModeBlindHelp', '隐藏模型来源，降低评审偏见。');
    }
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
            localizeEvaluationFailureReason(evaluation?.normalizeError || t('evalTimeoutDefault', '评审超时'))
        ]);
    }
    if (status === 'parse_failed') {
        return t('evalParseFailedPrefix', '解析失败：{0}', [
            localizeEvaluationFailureReason(evaluation?.normalizeError || evaluation?.rawResponse || '')
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
        return t('evalParsedScoreItemsNormalizedBy', '已解析 {0} 条评分，归一化模型：{1}。', [
            itemCount,
            String(evaluation.normalizedBy || '').trim()
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
