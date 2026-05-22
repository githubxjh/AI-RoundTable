export const ATTACHMENT_LIMITS = Object.freeze({
    maxFiles: 3,
    maxBytes: 5 * 1024 * 1024
});

export const ATTACHMENT_ALLOWED_MIME = Object.freeze([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv'
]);

export const ATTACHMENT_ALLOWED_EXT = Object.freeze([
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

export const ATTACHMENT_EXT_TO_MIME = Object.freeze({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv'
});

export const ATTACHMENT_METHODS = Object.freeze({
    none: 'none',
    domExperimental: 'dom_experimental',
    clipboardAssist: 'clipboard_assist',
    manual: 'manual',
    cdpAdvanced: 'cdp_advanced',
    textFallback: 'text_fallback'
});

export const ATTACHMENT_STATUS = Object.freeze({
    none: 'none',
    supported: 'supported',
    manualRequired: 'manual_required',
    unsupported: 'unsupported',
    failed: 'failed',
    textFallback: 'text_fallback'
});

const allowedMimeSet = new Set(ATTACHMENT_ALLOWED_MIME);
const allowedExtSet = new Set(ATTACHMENT_ALLOWED_EXT);

const ALL_KINDS = Object.freeze(['image', 'pdf', 'text']);

const CAPABILITY_MATRIX = Object.freeze({
    ChatGPT: {
        domExperimental: ALL_KINDS,
        clipboardAssist: ['image'],
        cdpAdvanced: ALL_KINDS
    },
    Gemini: {
        domExperimental: ALL_KINDS,
        clipboardAssist: ['image'],
        cdpAdvanced: ALL_KINDS
    },
    Grok: {
        domExperimental: ALL_KINDS,
        clipboardAssist: [],
        cdpAdvanced: ALL_KINDS
    },
    Doubao: {
        domExperimental: ALL_KINDS,
        clipboardAssist: [],
        cdpAdvanced: ALL_KINDS
    },
    DeepSeek: {
        domExperimental: [],
        clipboardAssist: [],
        manualRequired: ALL_KINDS,
        cdpAdvanced: ALL_KINDS
    }
});

export function getAttachmentExtension(name) {
    const value = String(name || '').toLowerCase();
    const index = value.lastIndexOf('.');
    return index >= 0 ? value.slice(index) : '';
}

export function getAttachmentKind(attachment = {}) {
    const mimeType = String(attachment?.mimeType || attachment?.type || '').trim().toLowerCase();
    const extension = getAttachmentExtension(attachment?.name);

    if (mimeType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) {
        return 'image';
    }
    if (mimeType === 'application/pdf' || extension === '.pdf') {
        return 'pdf';
    }
    if (
        mimeType.startsWith('text/')
        || ['text/markdown', 'text/csv'].includes(mimeType)
        || ['.txt', '.md', '.csv'].includes(extension)
    ) {
        return 'text';
    }
    return 'unknown';
}

export function isAttachmentPayloadSupported(attachment = {}) {
    const mimeType = String(attachment?.mimeType || attachment?.type || '').trim().toLowerCase();
    const extension = getAttachmentExtension(attachment?.name);
    return allowedMimeSet.has(mimeType) || allowedExtSet.has(extension);
}

export function normalizeAttachmentPayloads(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
        return { ok: true, attachments: [] };
    }

    if (attachments.length > ATTACHMENT_LIMITS.maxFiles) {
        return {
            ok: false,
            message: `Too many attachments: max ${ATTACHMENT_LIMITS.maxFiles}`
        };
    }

    const normalized = [];
    for (const item of attachments) {
        const name = String(item?.name || '').trim();
        const mimeType = String(item?.mimeType || item?.type || '').trim().toLowerCase();
        const size = Number(item?.size || 0);
        const base64 = String(item?.base64 || '').trim();
        const extension = getAttachmentExtension(name);
        const normalizedMimeType = mimeType || ATTACHMENT_EXT_TO_MIME[extension] || '';

        if (!name) {
            return { ok: false, message: 'Attachment name is required' };
        }
        if (!Number.isFinite(size) || size <= 0) {
            return { ok: false, message: `Invalid attachment size: ${name}` };
        }
        if (size > ATTACHMENT_LIMITS.maxBytes) {
            return {
                ok: false,
                message: `Attachment too large: ${name} (max ${ATTACHMENT_LIMITS.maxBytes} bytes)`
            };
        }
        if (!base64) {
            return { ok: false, message: `Attachment payload is empty: ${name}` };
        }
        if (!isAttachmentPayloadSupported({ name, mimeType: normalizedMimeType })) {
            return { ok: false, message: `Unsupported attachment type: ${name}` };
        }

        normalized.push({
            name,
            mimeType: normalizedMimeType || 'application/octet-stream',
            size,
            base64
        });
    }

    return { ok: true, attachments: normalized };
}

export function isAttachmentFileSupported(file = {}) {
    return isAttachmentPayloadSupported({
        name: file?.name,
        mimeType: file?.type || file?.mimeType
    });
}

export function getAttachmentCapability(model, attachments = [], options = {}) {
    const normalizedModel = String(model || '').trim();
    const matrix = CAPABILITY_MATRIX[normalizedModel];
    const advanced = Boolean(options?.advanced);
    const kinds = getAttachmentKinds(attachments);
    const base = {
        model: normalizedModel,
        kinds,
        domExperimental: Boolean(matrix?.domExperimental?.length),
        clipboardAssist: Boolean(matrix?.clipboardAssist?.length),
        manualRequired: Boolean(matrix?.manualRequired?.length),
        cdpAdvanced: Boolean(matrix?.cdpAdvanced?.length)
    };

    if (kinds.length === 0) {
        return {
            ...base,
            status: ATTACHMENT_STATUS.none,
            method: ATTACHMENT_METHODS.none,
            code: 'no_attachments',
            reason: 'No attachments provided'
        };
    }

    if (!matrix || kinds.includes('unknown')) {
        return {
            ...base,
            status: ATTACHMENT_STATUS.unsupported,
            method: ATTACHMENT_METHODS.none,
            code: 'attachment_type_rejected',
            reason: 'Unsupported attachment type'
        };
    }

    if (advanced && supportsKinds(matrix.cdpAdvanced, kinds)) {
        return {
            ...base,
            status: ATTACHMENT_STATUS.supported,
            method: ATTACHMENT_METHODS.cdpAdvanced,
            code: 'attachment_cdp_available',
            reason: 'Advanced CDP upload is available'
        };
    }

    if (supportsKinds(matrix.manualRequired, kinds)) {
        return {
            ...base,
            status: ATTACHMENT_STATUS.manualRequired,
            method: ATTACHMENT_METHODS.manual,
            code: 'attachment_manual_required',
            reason: `${normalizedModel} requires manual attachment upload in Lite mode`
        };
    }

    if (supportsKinds(matrix.domExperimental, kinds)) {
        return {
            ...base,
            status: ATTACHMENT_STATUS.supported,
            method: ATTACHMENT_METHODS.domExperimental,
            code: 'attachment_dom_experimental',
            reason: 'Lite DOM attachment path is experimental'
        };
    }

    if (supportsKinds(matrix.clipboardAssist, kinds)) {
        return {
            ...base,
            status: ATTACHMENT_STATUS.supported,
            method: ATTACHMENT_METHODS.clipboardAssist,
            code: 'attachment_clipboard_assist',
            reason: 'Clipboard-assisted upload is available'
        };
    }

    return {
        ...base,
        status: ATTACHMENT_STATUS.unsupported,
        method: ATTACHMENT_METHODS.none,
        code: 'attachment_type_rejected',
        reason: `${normalizedModel} does not support these attachments`
    };
}

export function summarizeAttachmentCapabilities(models = [], attachments = [], options = {}) {
    const summary = {
        autoModels: [],
        manualModels: [],
        unsupportedModels: [],
        capabilities: {},
        hasManualRequired: false,
        hasUnsupported: false
    };

    for (const model of models) {
        const capability = getAttachmentCapability(model, attachments, options);
        summary.capabilities[capability.model] = capability;
        if (capability.status === ATTACHMENT_STATUS.supported) {
            summary.autoModels.push(capability.model);
        } else if (capability.status === ATTACHMENT_STATUS.manualRequired) {
            summary.manualModels.push(capability.model);
        } else if (capability.status === ATTACHMENT_STATUS.unsupported) {
            summary.unsupportedModels.push(capability.model);
        }
    }

    summary.hasManualRequired = summary.manualModels.length > 0;
    summary.hasUnsupported = summary.unsupportedModels.length > 0;
    return summary;
}

function getAttachmentKinds(attachments) {
    const kinds = new Set();
    for (const attachment of Array.isArray(attachments) ? attachments : []) {
        kinds.add(getAttachmentKind(attachment));
    }
    return [...kinds];
}

function supportsKinds(supportedKinds = [], requestedKinds = []) {
    if (!Array.isArray(supportedKinds) || supportedKinds.length === 0) return false;
    const supported = new Set(supportedKinds);
    return requestedKinds.every((kind) => supported.has(kind));
}
