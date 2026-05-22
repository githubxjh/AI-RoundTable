export const ANALYSIS_PROVIDER_TYPE_OPENAI_COMPATIBLE = 'openai_compatible';
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';

export const DEFAULT_ANALYSIS_PROVIDER = Object.freeze({
    enabled: false,
    type: ANALYSIS_PROVIDER_TYPE_OPENAI_COMPATIBLE,
    name: 'DeepSeek',
    baseUrl: DEEPSEEK_DEFAULT_BASE_URL,
    apiKey: '',
    model: DEEPSEEK_DEFAULT_MODEL,
    thinkingMode: 'disabled',
    reasoningEffort: 'omit',
    timeoutMs: 25000,
    responseFormatJson: true
});

const ALLOWED_THINKING_MODES = new Set(['disabled', 'enabled', 'omit']);
const ALLOWED_REASONING_EFFORTS = new Set(['omit', 'low', 'medium', 'high']);
const MIN_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 120000;

export function normalizeAnalysisProviderConfig(partial = {}) {
    const input = partial && typeof partial === 'object' ? partial : {};
    const normalized = {
        ...DEFAULT_ANALYSIS_PROVIDER,
        ...input
    };

    normalized.enabled = input.enabled === true;
    normalized.type = ANALYSIS_PROVIDER_TYPE_OPENAI_COMPATIBLE;
    normalized.name = normalizeNonEmptyString(input.name, DEFAULT_ANALYSIS_PROVIDER.name);
    normalized.baseUrl = normalizeProviderBaseUrl(input.baseUrl) || DEFAULT_ANALYSIS_PROVIDER.baseUrl;
    normalized.apiKey = String(input.apiKey || '').trim();
    normalized.model = normalizeNonEmptyString(input.model, DEFAULT_ANALYSIS_PROVIDER.model);
    normalized.thinkingMode = ALLOWED_THINKING_MODES.has(String(input.thinkingMode || '').trim())
        ? String(input.thinkingMode).trim()
        : DEFAULT_ANALYSIS_PROVIDER.thinkingMode;
    normalized.reasoningEffort = ALLOWED_REASONING_EFFORTS.has(String(input.reasoningEffort || '').trim())
        ? String(input.reasoningEffort).trim()
        : DEFAULT_ANALYSIS_PROVIDER.reasoningEffort;
    normalized.timeoutMs = normalizeTimeoutMs(input.timeoutMs);
    normalized.responseFormatJson = input.responseFormatJson !== false;

    return normalized;
}

export function normalizeProviderBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') {
            return '';
        }
        url.hash = '';
        url.search = '';
        return url.toString().replace(/\/+$/, '');
    } catch {
        return '';
    }
}

export function buildAnalysisProviderEndpoint(providerConfig) {
    const provider = normalizeAnalysisProviderConfig(providerConfig);
    const base = provider.baseUrl.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(new URL(base).pathname.replace(/\/+$/, ''))) {
        return base;
    }
    return `${base}/chat/completions`;
}

export function buildAnalysisProviderOriginPattern(providerConfig) {
    const endpoint = buildAnalysisProviderEndpoint(providerConfig);
    return `${new URL(endpoint).origin}/*`;
}

export function buildOpenAICompatibleAnalysisRequest(providerConfig, messages, options = {}) {
    const provider = normalizeAnalysisProviderConfig(providerConfig);
    if (!provider.enabled) {
        return buildProviderConfigError('analysis_provider_disabled', '分析模型尚未启用。');
    }
    if (!provider.apiKey) {
        return buildProviderConfigError('analysis_provider_api_key_missing', '请先填写分析模型 API Key。');
    }
    if (!Array.isArray(messages) || messages.length === 0) {
        return buildProviderConfigError('analysis_provider_messages_missing', '分析模型请求内容为空。');
    }

    const body = {
        model: provider.model,
        messages
    };

    if ((options.responseFormatJson ?? provider.responseFormatJson) !== false) {
        body.response_format = { type: 'json_object' };
    }
    if (provider.thinkingMode !== 'omit') {
        body.thinking = { type: provider.thinkingMode };
    }
    if (provider.thinkingMode === 'enabled' && provider.reasoningEffort !== 'omit') {
        body.reasoning_effort = provider.reasoningEffort;
    }

    return {
        ok: true,
        provider,
        endpoint: buildAnalysisProviderEndpoint(provider),
        timeoutMs: provider.timeoutMs,
        requestInit: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify(body)
        },
        body
    };
}

export function parseOpenAICompatibleAnalysisContent(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        return {
            ok: false,
            code: 'analysis_provider_missing_content',
            error: '分析模型没有返回可解析的文本内容。'
        };
    }
    return { ok: true, content: content.trim() };
}

function buildProviderConfigError(code, error) {
    return { ok: false, code, error };
}

function normalizeNonEmptyString(value, fallback) {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function normalizeTimeoutMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_ANALYSIS_PROVIDER.timeoutMs;
    }
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(numeric)));
}
