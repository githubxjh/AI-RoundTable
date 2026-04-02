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

const REVIEW_MODES = {
    scoring: 'scoring',
    discussion: 'discussion'
};

const LABEL_MODES = {
    blind: 'blind',
    named: 'named'
};

const PRESETS = {
    'red-teaming': 'Act as a strict reviewer and point out the largest risks and flaws in the proposal.',
    'fact-check': 'Fact-check the statements above and identify any uncertain, outdated, or unsupported claims.',
    'trade-off': 'Analyze trade-offs: benefits, opportunity cost, constraints, and side effects.',
    'execution': 'Turn this idea into an executable plan with steps, owners, and timeline.'
};

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

const state = {
    quoteList: [],
    activeRoundId: null,
    activeRound: null,
    settings: { ...DEFAULT_SETTINGS },
    latestReviewProgress: null,
    selectedCandidateId: null,
    broadcastFiles: [],
    broadcastStatus: {
        level: 'info',
        message: 'You can paste or drag files here (max 3 files, 5MB each).'
    },
    dragDepth: 0,
    reviewMode: REVIEW_MODES.scoring,
    labelMode: LABEL_MODES.blind,
    isStartingReview: false
};

const refs = {};

document.addEventListener('DOMContentLoaded', async () => {
    bindRefs();
    bindEvents();
    await initializeSettings();
    await loadLatestRound();
    renderBroadcastFileList();
    renderBroadcastStatus();
    renderQuoteList();
    updateRouteExclusions();
    renderRound();
    renderReviewProgress();
    renderJudgeStatusList();
    renderResultBoard();
});

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

function bindEvents() {
    refs.broadcastBtn.addEventListener('click', onBroadcast);
    refs.broadcastAttachBtn?.addEventListener('click', onBroadcastAttachClick);
    refs.broadcastClearFilesBtn?.addEventListener('click', onClearBroadcastFiles);
    refs.broadcastFileInput?.addEventListener('change', onSelectBroadcastFiles);
    document.body.addEventListener('paste', onPanelPaste);
    document.body.addEventListener('dragenter', onPanelDragEnter);
    document.body.addEventListener('dragover', onPanelDragOver);
    document.body.addEventListener('dragleave', onPanelDragLeave);
    document.body.addEventListener('drop', onPanelDrop);
    refs.clearQuotesBtn.addEventListener('click', onClearQuotes);
    refs.routeBtn.addEventListener('click', onRoute);
    refs.resetTemplateBtn.addEventListener('click', onResetTemplate);
    refs.startReviewBtn.addEventListener('click', onStartReview);
    refs.deleteRoundBtn.addEventListener('click', onDeleteRound);
    refs.reviewMode?.addEventListener('change', () => onReviewModeChange().catch(console.error));
    refs.labelMode?.addEventListener('change', () => onLabelModeChange().catch(console.error));

    refs.reviewTemplate.addEventListener('change', () => {
        persistCurrentTemplate().catch(console.error);
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

        const rankRow = target.closest('.rank-row[data-candidate-id]');
        if (rankRow && refs.resultBoard?.contains(rankRow)) {
            onToggleCandidateDetails(rankRow.dataset.candidateId || '');
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
        currentTemplate.includes('<button id="start-review-btn"')
        || currentTemplate.includes('<div id="review-progress">')
        || currentTemplate.includes('<div id="result-board">')
        || currentTemplate.includes('?/button>')
        || currentTemplate.includes('?/div>')
        || currentTemplate.includes('?/span>');

    if (shouldResetTemplate) {
        state.settings.reviewPromptTemplate = DEFAULT_SETTINGS.reviewPromptTemplate;
        saveRtSettings({ reviewPromptTemplate: DEFAULT_SETTINGS.reviewPromptTemplate }).catch(console.error);
    }

    const currentDiscussionTemplate = String(state.settings.discussionPromptTemplate || '');
    const shouldResetDiscussionTemplate =
        currentDiscussionTemplate.includes('<button id="start-review-btn"')
        || currentDiscussionTemplate.includes('<div id="review-progress">')
        || currentDiscussionTemplate.includes('<div id="result-board">')
        || currentDiscussionTemplate.includes('?/button>')
        || currentDiscussionTemplate.includes('?/div>')
        || currentDiscussionTemplate.includes('?/span>');

    if (shouldResetDiscussionTemplate) {
        state.settings.discussionPromptTemplate = DEFAULT_SETTINGS.discussionPromptTemplate;
        saveRtSettings({ discussionPromptTemplate: DEFAULT_SETTINGS.discussionPromptTemplate }).catch(console.error);
    }

    state.reviewMode = normalizeReviewMode(state.settings.reviewMode);
    state.labelMode = normalizeLabelMode(state.settings.labelMode);

    if (refs.reviewMode) refs.reviewMode.value = state.reviewMode;
    if (refs.labelMode) refs.labelMode.value = state.labelMode;

    refreshTemplateEditorForCurrentMode();
    updateReviewModeUI();
    syncReviewControlsState();
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

function getTemplateKeyByMode(mode) {
    return normalizeReviewMode(mode) === REVIEW_MODES.discussion ? 'discussionPromptTemplate' : 'reviewPromptTemplate';
}

function getDefaultTemplateByMode(mode) {
    return normalizeReviewMode(mode) === REVIEW_MODES.discussion
        ? DEFAULT_SETTINGS.discussionPromptTemplate
        : DEFAULT_SETTINGS.reviewPromptTemplate;
}

function getCurrentReviewMode() {
    return normalizeReviewMode(refs.reviewMode?.value || state.reviewMode);
}

function getCurrentLabelMode() {
    return normalizeLabelMode(refs.labelMode?.value || state.labelMode);
}

function updateReviewModeUI() {
    const mode = getCurrentReviewMode();
    refs.startReviewBtn.textContent = mode === REVIEW_MODES.discussion ? 'Start Discussion Review' : 'Start Scoring Review';
    refs.reviewTemplate.placeholder = mode === REVIEW_MODES.discussion
        ? 'Discussion template (supports {{question}} and {{answers}})'
        : 'Scoring template (supports {{question}} and {{answers}})';
}

function syncReviewControlsState() {
    const reviewLocked = state.activeRound?.status === 'reviewing';
    const requestPending = state.isStartingReview === true;

    refs.reviewTemplate.disabled = reviewLocked || requestPending;
    refs.startReviewBtn.disabled = requestPending;
    refs.reviewMode.disabled = requestPending;
    refs.labelMode.disabled = requestPending;
}

function refreshTemplateEditorForCurrentMode() {
    const mode = getCurrentReviewMode();
    const key = getTemplateKeyByMode(mode);
    refs.reviewTemplate.value = String(state.settings[key] || getDefaultTemplateByMode(mode));
}

async function persistCurrentTemplate() {
    const mode = getCurrentReviewMode();
    const key = getTemplateKeyByMode(mode);
    const value = refs.reviewTemplate.value || getDefaultTemplateByMode(mode);
    state.settings[key] = value;
    await saveRtSettings({ [key]: value });
}

async function onReviewModeChange() {
    const prevMode = state.reviewMode;
    const nextMode = getCurrentReviewMode();

    if (prevMode !== nextMode) {
        const prevKey = getTemplateKeyByMode(prevMode);
        const prevTemplate = refs.reviewTemplate.value || getDefaultTemplateByMode(prevMode);
        state.settings[prevKey] = prevTemplate;
        await saveRtSettings({ [prevKey]: prevTemplate });
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
        state.selectedCandidateId = null;
        renderRound();
        renderReviewProgress();
        renderJudgeStatusList();
        renderResultBoard();
        syncCandidateButtons();
        syncReviewControlsState();
        return;
    }

    const response = await sendMessage({ type: 'ROUND_GET', roundId });
    if (!response || response.status !== 'ok') {
        throw new Error(response?.message || 'ROUND_GET failed');
    }

    state.activeRoundId = roundId;
    state.activeRound = response.round;
    if (!isCandidateInActiveRound(state.selectedCandidateId)) {
        state.selectedCandidateId = null;
    }
    renderRound();
    renderReviewProgress();
    renderJudgeStatusList();
    renderResultBoard();
    syncCandidateButtons();
    syncReviewControlsState();
}

function isCandidateInActiveRound(candidateId) {
    if (!candidateId || !state.activeRound) return false;
    return (state.activeRound.candidates || []).some((candidate) => candidate.candidateId === candidateId);
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
        setBroadcastStatus('error', 'Please enter a question before broadcasting.');
        return;
    }
    const targets = getCheckedValues('.target-selector input[type="checkbox"]');
    if (targets.length === 0) {
        setBroadcastStatus('error', 'Please select at least one target model.');
        return;
    }
    const validation = validateBroadcastFiles(state.broadcastFiles);
    if (!validation.ok) {
        setBroadcastStatus('error', validation.message);
        return;
    }

    refs.broadcastBtn.disabled = true;
    if (refs.broadcastAttachBtn) refs.broadcastAttachBtn.disabled = true;
    if (refs.broadcastClearFilesBtn) refs.broadcastClearFilesBtn.disabled = true;
    setBroadcastStatus('info', 'Broadcasting...');

    try {
        const attachments = await buildBroadcastAttachments(state.broadcastFiles);
        await ensureRoundForBroadcast(text, targets);
        const response = await sendMessage({
            type: 'BROADCAST',
            text,
            targets,
            attachments
        });

        if (response?.status !== 'broadcast_done') {
            const degraded = Array.isArray(response?.degraded) ? response.degraded : [];
            const skipped = Array.isArray(response?.skipped) ? response.skipped : [];
            const failed = Array.isArray(response?.failed) ? response.failed : [];
            const details = (degraded.length > 0 || skipped.length > 0 || failed.length > 0)
                ? buildBroadcastOutcomeMessage([], degraded, skipped, failed)
                : '';
            setBroadcastStatus('error', getBroadcastErrorMessage(response), details);
            return;
        }

        const sentModels = Array.isArray(response?.sentModels) ? response.sentModels : [];
        const degraded = Array.isArray(response?.degraded) ? response.degraded : [];
        const skipped = Array.isArray(response?.skipped) ? response.skipped : [];
        const failed = Array.isArray(response?.failed) ? response.failed : [];

        if (sentModels.length > 0) {
            clearBroadcastFiles();
        }

        if (degraded.length > 0 || skipped.length > 0 || failed.length > 0) {
            setBroadcastStatus('warn', buildBroadcastOutcomeMessage(sentModels, degraded, skipped, failed));
        } else {
            setBroadcastStatus('success', `Broadcast sent to ${sentModels.length} model(s).`);
        }
    } catch (error) {
        console.error(error);
        setBroadcastStatus('error', `Broadcast failed: ${error.message || String(error)}`);
    } finally {
        refs.broadcastBtn.disabled = false;
        if (refs.broadcastAttachBtn) refs.broadcastAttachBtn.disabled = false;
        if (refs.broadcastClearFilesBtn) refs.broadcastClearFilesBtn.disabled = false;
    }
}

function renderBroadcastFileList() {
    if (!refs.broadcastFileList) return;

    if (!Array.isArray(state.broadcastFiles) || state.broadcastFiles.length === 0) {
        refs.broadcastFileList.innerHTML = '<div class="empty">No files selected.</div>';
        if (refs.broadcastClearFilesBtn) refs.broadcastClearFilesBtn.disabled = true;
        return;
    }

    refs.broadcastFileList.innerHTML = state.broadcastFiles.map((file, index) => {
        const name = escapeHtml(String(file?.name || `file-${index + 1}`));
        const sizeText = escapeHtml(formatBytes(Number(file?.size || 0)));
        return `<div class="file-item">${index + 1}. ${name} (${sizeText})</div>`;
    }).join('');
    if (refs.broadcastClearFilesBtn) refs.broadcastClearFilesBtn.disabled = false;
}

function renderBroadcastStatus() {
    if (!refs.broadcastFileStatus) return;

    const level = String(state.broadcastStatus?.level || 'info').toLowerCase();
    const safeLevel = ['info', 'success', 'warn', 'error'].includes(level) ? level : 'info';
    const message = String(state.broadcastStatus?.message || '').trim();
    const details = String(state.broadcastStatus?.details || '').trim();

    refs.broadcastFileStatus.className = `file-status ${safeLevel}`;
    refs.broadcastFileStatus.innerText = details ? `${message}\n${details}` : message;
}

function setBroadcastStatus(level, message, details = '') {
    state.broadcastStatus = {
        level: String(level || 'info').toLowerCase(),
        message: String(message || ''),
        details: String(details || '')
    };
    renderBroadcastStatus();
}

function onBroadcastAttachClick() {
    refs.broadcastFileInput?.click();
}

function onSelectBroadcastFiles(event) {
    const input = event?.target;
    const files = Array.from(input?.files || []);
    mergeBroadcastFiles(files, 'Selected files');
    if (input) input.value = '';
}

function onClearBroadcastFiles() {
    clearBroadcastFiles();
    setBroadcastStatus('info', 'Attachments cleared.');
}

function clearBroadcastFiles() {
    state.broadcastFiles = [];
    if (refs.broadcastFileInput) refs.broadcastFileInput.value = '';
    renderBroadcastFileList();
}

function onPanelPaste(event) {
    const clipboardData = event?.clipboardData;
    if (!clipboardData) return;

    const files = extractFilesFromClipboardData(clipboardData);
    if (files.length === 0) {
        return;
    }

    event.preventDefault();
    mergeBroadcastFiles(files, 'Pasted files');
}

function onPanelDragEnter(event) {
    if (!hasFilePayload(event?.dataTransfer)) return;
    event.preventDefault();
    state.dragDepth += 1;
    document.body.classList.add('drag-active');
}

function onPanelDragOver(event) {
    if (!hasFilePayload(event?.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
    }
}

function onPanelDragLeave(event) {
    if (!hasFilePayload(event?.dataTransfer)) return;
    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) {
        document.body.classList.remove('drag-active');
    }
}

function onPanelDrop(event) {
    if (!hasFilePayload(event?.dataTransfer)) return;
    event.preventDefault();
    state.dragDepth = 0;
    document.body.classList.remove('drag-active');

    const files = Array.from(event?.dataTransfer?.files || []);
    mergeBroadcastFiles(files, 'Dropped files');
}

function hasFilePayload(dataTransfer) {
    if (!dataTransfer) return false;
    if (dataTransfer.files && dataTransfer.files.length > 0) return true;
    const types = Array.from(dataTransfer.types || []);
    return types.includes('Files');
}

function extractFilesFromClipboardData(clipboardData) {
    const files = [];
    const items = Array.from(clipboardData.items || []);

    for (const item of items) {
        if (item?.kind !== 'file') continue;
        const file = item.getAsFile?.();
        if (file) files.push(file);
    }

    if (files.length > 0) {
        return files;
    }

    return Array.from(clipboardData.files || []);
}

function mergeBroadcastFiles(rawFiles, sourceLabel = 'Files') {
    const incoming = normalizeIncomingFiles(rawFiles);
    if (incoming.length === 0) {
        setBroadcastStatus('warn', `${sourceLabel}: no usable file detected.`);
        return;
    }

    const existingFingerprints = new Set(state.broadcastFiles.map(getFileFingerprint));
    const uniqueFiles = [];
    const duplicateFiles = [];

    for (const file of incoming) {
        const fingerprint = getFileFingerprint(file);
        if (existingFingerprints.has(fingerprint)) {
            duplicateFiles.push(file);
            continue;
        }
        existingFingerprints.add(fingerprint);
        uniqueFiles.push(file);
    }

    let candidates = uniqueFiles;
    let duplicateAction = 'skipped';

    if (duplicateFiles.length > 0) {
        const keepDuplicates = confirm(`Detected ${duplicateFiles.length} duplicate file(s). Keep duplicates?`);
        if (keepDuplicates) {
            duplicateAction = 'kept';
            candidates = uniqueFiles.concat(duplicateFiles);
        }
    }

    const accepted = [];
    const rejectedType = [];
    const rejectedSize = [];

    for (const file of candidates) {
        const validation = validateSingleBroadcastFile(file);
        if (!validation.ok) {
            if (validation.reason === 'size') {
                rejectedSize.push(file);
            } else {
                rejectedType.push(file);
            }
            continue;
        }
        accepted.push(file);
    }

    const availableSlots = Math.max(0, BROADCAST_MAX_FILES - state.broadcastFiles.length);
    const kept = accepted.slice(0, availableSlots);
    const overflowCount = Math.max(0, accepted.length - kept.length);

    if (kept.length > 0) {
        state.broadcastFiles = state.broadcastFiles.concat(kept);
    }

    renderBroadcastFileList();

    const details = [];
    details.push(`Added ${kept.length} file(s).`);
    if (duplicateFiles.length > 0) details.push(`Duplicates ${duplicateAction}: ${duplicateFiles.length}.`);
    if (rejectedType.length > 0) details.push(`Type rejected: ${rejectedType.length}.`);
    if (rejectedSize.length > 0) details.push(`Size rejected: ${rejectedSize.length}.`);
    if (overflowCount > 0) details.push(`Skipped by limit (${BROADCAST_MAX_FILES} files max): ${overflowCount}.`);

    const totalRejected = rejectedType.length + rejectedSize.length + overflowCount + (duplicateAction === 'skipped' ? duplicateFiles.length : 0);

    if (kept.length > 0 && totalRejected === 0) {
        setBroadcastStatus('success', `${sourceLabel} queued.`, details.join(' '));
        return;
    }

    if (kept.length > 0) {
        setBroadcastStatus('warn', `${sourceLabel} partially queued.`, details.join(' '));
        return;
    }

    setBroadcastStatus('error', `${sourceLabel} not queued.`, details.join(' '));
}

function normalizeIncomingFiles(rawFiles) {
    const normalized = [];
    const files = Array.from(rawFiles || []);

    for (const file of files) {
        if (!(file instanceof File)) continue;
        normalized.push(ensureFileName(file));
    }

    return normalized;
}

function ensureFileName(file) {
    const name = String(file?.name || '').trim();
    if (name) {
        return file;
    }

    const mimeType = String(file?.type || '').toLowerCase();
    const guessedExt = Object.entries(BROADCAST_EXT_TO_MIME)
        .find(([, mime]) => mime === mimeType)?.[0] || '.bin';
    const generatedName = `pasted-${Date.now()}${guessedExt}`;

    return new File([file], generatedName, {
        type: mimeType || 'application/octet-stream',
        lastModified: Number(file?.lastModified || Date.now())
    });
}

function validateBroadcastFiles(files) {
    const list = Array.from(files || []);

    if (list.length > BROADCAST_MAX_FILES) {
        return {
            ok: false,
            message: `Too many attachments. Max ${BROADCAST_MAX_FILES} files are allowed.`
        };
    }

    for (const file of list) {
        const validation = validateSingleBroadcastFile(file);
        if (!validation.ok) {
            if (validation.reason === 'size') {
                return {
                    ok: false,
                    message: `File too large: ${file.name} (max ${formatBytes(BROADCAST_MAX_FILE_BYTES)}).`
                };
            }
            return {
                ok: false,
                message: `Unsupported file type: ${file.name}.`
            };
        }
    }

    return { ok: true };
}

function validateSingleBroadcastFile(file) {
    const size = Number(file?.size || 0);
    if (!Number.isFinite(size) || size <= 0 || size > BROADCAST_MAX_FILE_BYTES) {
        return { ok: false, reason: 'size' };
    }

    const ext = getFileExtension(file?.name);
    const mimeType = String(file?.type || '').toLowerCase();
    const resolvedMime = mimeType || BROADCAST_EXT_TO_MIME[ext] || '';
    const allowed = BROADCAST_ALLOWED_MIME.has(resolvedMime) || BROADCAST_ALLOWED_EXT.has(ext);

    if (!allowed) {
        return { ok: false, reason: 'type' };
    }

    return { ok: true, mimeType: resolvedMime || 'application/octet-stream' };
}

function getFileExtension(name) {
    const value = String(name || '').toLowerCase();
    const idx = value.lastIndexOf('.');
    if (idx < 0) return '';
    return value.slice(idx);
}

function getFileFingerprint(file) {
    return `${String(file?.name || '')}::${Number(file?.size || 0)}::${Number(file?.lastModified || 0)}`;
}

async function buildBroadcastAttachments(files) {
    const list = Array.from(files || []);
    const attachments = [];

    for (const file of list) {
        const validation = validateSingleBroadcastFile(file);
        if (!validation.ok) {
            throw new Error(`Invalid attachment: ${file?.name || 'unknown file'}`);
        }

        const base64 = await fileToBase64(file);
        attachments.push({
            name: String(file?.name || 'attachment'),
            mimeType: validation.mimeType || 'application/octet-stream',
            size: Number(file?.size || 0),
            base64
        });
    }

    return attachments;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const dataUrl = String(reader.result || '');
            const commaIndex = dataUrl.indexOf(',');
            resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl);
        };

        reader.onerror = () => {
            reject(new Error(`Failed to read file: ${file?.name || 'unknown file'}`));
        };

        reader.readAsDataURL(file);
    });
}

function getBroadcastErrorMessage(response) {
    const code = String(response?.code || '').trim().toLowerCase();
    if (code === 'invalid_attachments') {
        return response?.message || 'Invalid attachments. Please check file size and type.';
    }
    if (code === 'broadcast_no_supported_targets') {
        return response?.message || 'No selected model supports the provided attachments.';
    }
    if (code === 'send_not_confirmed') {
        return response?.message || 'Message was injected but send was not confirmed. Please check model page and retry.';
    }
    return response?.message || 'Broadcast failed.';
}

function buildBroadcastOutcomeMessage(sentModels, degraded, skipped, failed) {
    const sentCount = Array.isArray(sentModels) ? sentModels.length : 0;
    const degradedItems = Array.isArray(degraded) ? degraded : [];
    const skippedItems = Array.isArray(skipped) ? skipped : [];
    const failedItems = Array.isArray(failed) ? failed : [];

    const segments = [`Sent ${sentCount} model(s).`];

    if (degradedItems.length > 0) {
        const degradedDetail = degradedItems
            .map((item) => `${item.model}: ${item.code}`)
            .join(', ');
        segments.push(`Attachment downgraded to text on ${degradedItems.length} model(s) (${degradedDetail}).`);
    }

    if (skippedItems.length > 0) {
        const skippedDetail = skippedItems
            .map((item) => `${item.model}: ${item.code}`)
            .join(', ');
        segments.push(`Skipped ${skippedItems.length} (${skippedDetail}).`);
    }

    if (failedItems.length > 0) {
        const failedDetail = failedItems
            .map((item) => {
                if (String(item?.code || '') === 'send_not_confirmed') {
                    return `${item.model}: send_not_confirmed (check model page and retry)`;
                }
                return `${item.model}: ${item.code}`;
            })
            .join(', ');
        segments.push(`Failed ${failedItems.length} (${failedDetail}).`);
    }

    return segments.join(' ');
}

function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function getManualRoundQuestion() {
    return String(refs.globalInput?.value || '').trim() || '閹靛濮╅崶鐐叉値';
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
            'Current round is already closed or reviewing. Create a new round for this candidate?'
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
        return 'No captured answer found for this model. Wait for model output, then try again.';
    }
    if (code === 'round_not_found') {
        return 'The selected round was not found. Please refresh and try again.';
    }
    if (code === 'invalid_request') {
        return response?.message || 'Invalid request when adding candidate.';
    }
    return response?.message || 'Failed to add candidate.';
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
            alert('This answer is already in the round. No duplicate candidate was added.');
        }

        await setActiveRound(response.roundId || resolved.roundId || state.activeRoundId);
    } catch (error) {
        console.error(error);
        alert(`Failed to add candidate: ${error.message}`);
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
        refs.quoteList.innerHTML = '<div class="empty">閻愮懓鍤垾婊冪穿閻劉鈧繃濡搁崶鐐电摕閸旂姴鍙嗙捄顖滄暠閸?/div>';
        return;
    }

    refs.quoteList.innerHTML = state.quoteList
        .map((quote, index) => (
            `<div class="quote-item" data-index="${index}">
                <span class="quote-close">鑴?/span>
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
        alert('Please quote at least one model answer before routing.');
        return;
    }

    const targets = getCheckedValues('.router-targets input[type="checkbox"]');
    if (targets.length === 0) {
        alert('Please select at least one routing target.');
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
        alert(`Route failed: ${error.message}`);
    }
}

async function onStartReview() {
    if (state.isStartingReview) {
        return;
    }

    if (!state.activeRoundId || !state.activeRound) {
        alert('No active round found. Please broadcast first to create a round.');
        return;
    }

    if (
        state.activeRound.status === 'reviewing'
        && !confirm('Current review is running. Restarting will overwrite unfinished judge results. Continue?')
    ) {
        return;
    }

    const reviewMode = getCurrentReviewMode();
    const labelMode = getCurrentLabelMode();
    const minCandidates = reviewMode === REVIEW_MODES.discussion ? 1 : 2;
    if ((state.activeRound.candidateIds || []).length < minCandidates) {
        if (reviewMode === REVIEW_MODES.discussion) {
            alert('Discussion review requires at least 1 candidate.');
        } else {
            alert('Scoring review requires at least 2 candidates.');
        }
        return;
    }

    const judgeModels = getCheckedValues('.judge-targets input[type="checkbox"]');
    if (judgeModels.length === 0) {
        alert('Please select at least one judge model.');
        return;
    }
    if (reviewMode === REVIEW_MODES.scoring && judgeModels.length < 2 && !confirm('Scoring with fewer than 2 judges may be unstable. Continue?')) {
        return;
    }

    const promptTemplate = refs.reviewTemplate.value || getDefaultTemplateByMode(reviewMode);
    state.isStartingReview = true;
    syncReviewControlsState();

    try {
        const templateKey = getTemplateKeyByMode(reviewMode);
        state.reviewMode = reviewMode;
        state.labelMode = labelMode;
        state.settings.reviewMode = reviewMode;
        state.settings.labelMode = labelMode;
        state.settings[templateKey] = promptTemplate;

        await saveRtSettings({
            reviewMode,
            labelMode,
            [templateKey]: promptTemplate
        });

        const response = await sendMessage({
            type: 'ROUND_START_REVIEW',
            roundId: state.activeRoundId,
            judgeModels,
            promptTemplate,
            mode: reviewMode,
            labelMode,
            weights: FIXED_WEIGHTS,
            selfReviewWeight: 0.2
        });

        if (response?.status !== 'review_started') {
            if (response?.code === 'candidate_answer_missing') {
                alert('Current round has no usable candidate answers. Add candidates before starting review.');
            } else {
                alert(response?.message || 'Failed to start review.');
            }
        }
        await setActiveRound(state.activeRoundId);
    } catch (error) {
        console.error(error);
        alert(`Failed to start review: ${error.message}`);
    } finally {
        state.isStartingReview = false;
        syncReviewControlsState();
    }
}

async function onDeleteRound() {
    if (!state.activeRoundId) {
        alert('No active round to delete.');
        return;
    }
    if (!confirm('Delete current round? This action cannot be undone.')) {
        return;
    }

    try {
        await sendMessage({ type: 'ROUND_DELETE', roundId: state.activeRoundId });
        await loadLatestRound();
    } catch (error) {
        console.error(error);
        alert(`Failed to delete round: ${error.message}`);
    }
}

function onToggleCandidateDetails(candidateId) {
    if (!candidateId) return;
    if (state.selectedCandidateId === candidateId) {
        state.selectedCandidateId = null;
    } else {
        state.selectedCandidateId = candidateId;
    }
    renderResultBoard();
}

function onResetTemplate() {
    const mode = getCurrentReviewMode();
    const key = getTemplateKeyByMode(mode);
    refs.reviewTemplate.value = getDefaultTemplateByMode(mode);
    state.settings[key] = refs.reviewTemplate.value;
    saveRtSettings({ [key]: refs.reviewTemplate.value }).catch(console.error);
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

    syncReviewControlsState();
}

function renderRound() {
    const round = state.activeRound;
    if (!round) {
        refs.roundId.innerText = '-';
        refs.roundStatus.innerText = 'none';
        refs.roundCandidateCount.innerText = '0';
        refs.roundCreatedAt.innerText = '-';
        refs.roundQuestion.innerText = 'No active round.';
        updateReviewModeUI();
        syncReviewControlsState();
        syncCandidateButtons();
        return;
    }

    refs.roundId.innerText = round.roundId;
    refs.roundStatus.innerText = round.status;
    refs.roundCandidateCount.innerText = String((round.candidateIds || []).length);
    refs.roundCreatedAt.innerText = new Date(round.createdAt).toLocaleString();
    refs.roundQuestion.innerText = round.question || '(empty question)';
    updateReviewModeUI();
    syncReviewControlsState();
}

function renderReviewProgress() {
    if (!state.activeRound) {
        refs.reviewProgress.innerText = 'No active round.';
        return;
    }

    const evaluations = state.activeRound.evaluations || [];
    if (evaluations.length === 0) {
        refs.reviewProgress.innerText = 'Review has not started yet.';
        return;
    }

    const done = evaluations.filter((e) => e.status === 'done').length;
    const failed = evaluations.filter((e) => e.status === 'parse_failed' || e.status === 'timeout').length;
    const pending = evaluations.length - done - failed;
    refs.reviewProgress.innerText = `鐎孤ゎ唴鏉╂稑瀹? done ${done} / failed ${failed} / pending ${pending}`;
}

function renderJudgeStatusList() {
    if (!refs.judgeStatusList) return;

    const round = state.activeRound;
    const evaluations = Array.isArray(round?.evaluations) ? round.evaluations : [];

    if (evaluations.length === 0) {
        refs.judgeStatusList.innerHTML = '<div class="empty">閺嗗倹妫ょ拠鍕潤娴犺濮?/div>';
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
    if (isDiscussionRound(round)) {
        renderDiscussionResultBoard(round);
        return;
    }

    if (!round || !Array.isArray(round.ranking) || round.ranking.length === 0) {
        refs.resultBoard.innerHTML = '<div class="empty">閺嗗倹妫ら幒鎺戞倳缂佹挻鐏?/div>';
        state.selectedCandidateId = null;
        return;
    }

    const doneCount = (round.evaluations || [])
        .filter((evaluation) => normalizeEvaluationStatus(evaluation.status) === 'done')
        .length;
    if (doneCount === 0) {
        refs.resultBoard.innerHTML = '<div class="empty">閺嗗倹妫ら張澶嬫櫏鐠囧嫬鍨庣紒鎾寸亯</div>';
        state.selectedCandidateId = null;
        return;
    }

    const candidateMap = {};
    (round.candidates || []).forEach((candidate) => {
        candidateMap[candidate.candidateId] = candidate;
    });

    const rankingCandidateIds = new Set((round.ranking || []).map((item) => item.candidateId));
    if (state.selectedCandidateId && !rankingCandidateIds.has(state.selectedCandidateId)) {
        state.selectedCandidateId = null;
    }

    refs.resultBoard.innerHTML = round.ranking.map((item, index) => {
        const candidate = candidateMap[item.candidateId];
        const model = candidate?.model || 'Unknown';
        const answerSnippet = shorten(candidate?.answerText || '', 180);
        const reasons = collectCandidateReasons(round, item.candidateId);
        const selected = state.selectedCandidateId === item.candidateId;
        const detailHtml = selected ? renderCandidateJudgeDetails(round, item.candidateId) : '';
        return `
            <div class="rank-row ${selected ? 'selected' : ''}" data-candidate-id="${escapeHtml(item.candidateId)}">
                <div class="rank-title">#${index + 1} ${escapeHtml(model)} | Final ${formatScore(item.finalScore)}</div>
                <div class="small-muted">raw ${formatScore(item.rawMean)} 璺?normalized ${formatScore(item.normalizedMean)} 璺?non-self ${formatScore(item.nonSelfMean)} 璺?variance ${formatScore(item.variance)}</div>
                <div style="margin-top:4px;">${escapeHtml(answerSnippet)}</div>
                ${reasons ? `<div class="small-muted" style="margin-top:4px;">鐠囧嫬顓搁悶鍡欐暠: ${escapeHtml(reasons)}</div>` : ''}
                <div class="small-muted" style="margin-top:4px;">${selected ? '閻愮懓鍤弨鎯版崳鐠囧嫬顫欑拠锔藉剰' : '閻愮懓鍤弻銉ф箙鐠囧嫬顫欑拠锔藉剰'}</div>
                ${detailHtml}
            </div>
        `;
    }).join('');
}

function renderDiscussionResultBoard(round) {
    state.selectedCandidateId = null;

    if (!round) {
        refs.resultBoard.innerHTML = '<div class="empty">閺嗗倹妫ょ拋銊啈缂佹挻鐏?/div>';
        return;
    }

    const evaluations = Array.isArray(round.evaluations) ? [...round.evaluations] : [];
    if (evaluations.length === 0) {
        refs.resultBoard.innerHTML = '<div class="empty">閺嗗倹妫ょ拋銊啈缂佹挻鐏?/div>';
        return;
    }

    evaluations.sort((a, b) => String(a?.judgeModel || '').localeCompare(String(b?.judgeModel || '')));

    refs.resultBoard.innerHTML = evaluations.map((evaluation) => {
        const status = normalizeEvaluationStatus(evaluation?.status);
        const model = evaluation?.judgeModel || 'Unknown';
        const detail = getEvaluationStatusDetail(evaluation);
        const raw = String(evaluation?.rawResponse || '').trim();
        const text = raw || (status === 'done' ? '[鐠併劏顔戦崶鐐差槻娑撹櫣鈹朷' : detail);
        return `
            <div class="rank-row">
                <div class="rank-title">${escapeHtml(model)}</div>
                <div class="small-muted" style="margin-bottom:4px;">閻樿埖鈧? <span class="status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span></div>
                <div class="rank-judge-text" style="margin-top:0; white-space: pre-wrap; word-break: break-word;">${escapeHtml(text)}</div>
            </div>
        `;
    }).join('');
}

function isDiscussionRound(round) {
    return normalizeReviewMode(round?.config?.reviewMode) === REVIEW_MODES.discussion;
}

function renderCandidateJudgeDetails(round, candidateId) {
    const rows = buildCandidateJudgeRows(round, candidateId);
    if (rows.length === 0) {
        return '<div class="rank-details"><div class="rank-details-empty">No judge detail records.</div></div>';
    }

    return `
        <div class="rank-details">
            ${rows.map(({ evaluation, status, score }) => {
                const model = evaluation?.judgeModel || 'Unknown';
                const detail = getEvaluationStatusDetail(evaluation);
                const sourceTag = evaluation?.normalizedBy
                    ? `<span class="judge-source-tag">${escapeHtml(String(evaluation.normalizedBy))}</span>`
                    : '';

                if (status === 'done' && score) {
                    const evidenceText = Array.isArray(score.evidence) && score.evidence.length > 0
                        ? score.evidence.map((x) => String(x)).join(' | ')
                        : '';
                    return `
                        <div class="rank-judge-row">
                            <div class="rank-judge-head">
                                <div class="rank-judge-left">
                                    <span class="rank-judge-model">${escapeHtml(model)}</span>
                                    <span class="status-pill done">done</span>
                                    ${sourceTag}
                                </div>
                            </div>
                            <div class="rank-judge-metrics">
                                accuracy ${formatScore(score.accuracy)} | completeness ${formatScore(score.completeness)} | actionability ${formatScore(score.actionability)} | clarity ${formatScore(score.clarity)} | overall ${formatScore(score.overall)}
                            </div>
                            ${score.reason ? `<div class="rank-judge-text"><strong>Reason:</strong> ${escapeHtml(score.reason)}</div>` : ''}
                            ${evidenceText ? `<div class="rank-judge-text"><strong>Evidence:</strong> ${escapeHtml(evidenceText)}</div>` : ''}
                        </div>
                    `;
                }

                return `
                    <div class="rank-judge-row">
                        <div class="rank-judge-head">
                            <div class="rank-judge-left">
                                <span class="rank-judge-model">${escapeHtml(model)}</span>
                                <span class="status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span>
                                ${sourceTag}
                            </div>
                        </div>
                        <div class="rank-judge-text">${escapeHtml(detail)}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function buildCandidateJudgeRows(round, candidateId) {
    const evaluations = Array.isArray(round?.evaluations) ? [...round.evaluations] : [];
    evaluations.sort((a, b) => String(a?.judgeModel || '').localeCompare(String(b?.judgeModel || '')));
    return evaluations.map((evaluation) => {
        const status = normalizeEvaluationStatus(evaluation?.status);
        const score = status === 'done' ? findCandidateScoreInEvaluation(evaluation, candidateId) : null;
        return { evaluation, status, score };
    });
}

function findCandidateScoreInEvaluation(evaluation, candidateId) {
    const scores = Array.isArray(evaluation?.parsedScores) ? evaluation.parsedScores : [];
    for (const score of scores) {
        const slot = String(score?.slot || '').trim().toUpperCase();
        if (!slot) continue;
        const mappedCandidate = evaluation?.blindMap?.[slot];
        if (mappedCandidate === candidateId) {
            return score;
        }
    }
    return null;
}

function collectCandidateReasons(round, candidateId) {
    const evaluations = round.evaluations || [];
    const reasons = [];
    for (const evaluation of evaluations) {
        if (evaluation.status !== 'done') continue;
        const score = findCandidateScoreInEvaluation(evaluation, candidateId);
        if (score?.reason) reasons.push(`[${evaluation.judgeModel}] ${score.reason}`);
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
    const evaluationMode = normalizeReviewMode(evaluation?.mode || state.activeRound?.config?.reviewMode);

    if (status === 'done') {
        if (evaluationMode === REVIEW_MODES.discussion) {
            const raw = String(evaluation?.rawResponse || '').trim();
            return raw ? `Discussion response captured (${raw.length} chars).` : 'Discussion response captured.';
        }

        const normalizedBy = String(evaluation?.normalizedBy || '').trim();
        if (normalizedBy) {
            if (normalizedBy === 'deepseek-chat') {
                return `Parsed ${scoreCount} score item(s). Scores normalized by deepseek-chat; reason/evidence preserved from raw output.`;
            }
            return `Parsed ${scoreCount} score item(s). Normalized by ${normalizedBy}.`;
        }
        return `Parsed ${scoreCount} score item(s).`;
    }

    if (status === 'parse_failed') {
        const normalizeError = String(evaluation?.normalizeError || '').replace(/\s+/g, ' ').trim();
        if (normalizeError) {
            return `Parse failed: ${shorten(normalizeError, 180)}`;
        }
        const raw = String(evaluation?.rawResponse || '').replace(/\s+/g, ' ').trim();
        return raw ? `Parse failed: ${shorten(raw, 140)}` : 'Parse failed: invalid JSON output.';
    }

    if (status === 'timeout') {
        const raw = String(evaluation?.rawResponse || '').replace(/\s+/g, ' ').trim();
        return raw ? `Timeout: ${shorten(raw, 140)}` : 'Timeout: no valid response received within the window.';
    }

    return 'Waiting for judge response...';
}

function syncCandidateButtons() {
    const hasRound = Boolean(state.activeRoundId);
    document.querySelectorAll('.btn-candidate').forEach((button) => {
        button.disabled = false;
        button.title = hasRound ? '' : 'Broadcast first to create a round.';
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

