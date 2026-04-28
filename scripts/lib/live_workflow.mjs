export const SUPPORTED_LIVE_MODELS = Object.freeze([
    'ChatGPT',
    'Grok',
    'Gemini',
    'Doubao',
    'DeepSeek'
]);

export const DEFAULT_LIVE_CORE_MODELS = Object.freeze([
    'Gemini',
    'Doubao',
    'Grok',
    'DeepSeek'
]);

export const DEFAULT_PROFILE_OPEN_MODELS = Object.freeze([
    ...DEFAULT_LIVE_CORE_MODELS,
    'ChatGPT'
]);

export const GPT_LIVE_MODELS = Object.freeze([
    'ChatGPT'
]);

export const LIVE_RESULT_STATUS = Object.freeze({
    ok: 'ok',
    blockedByVerification: 'blocked_by_verification',
    notLoggedIn: 'not_logged_in',
    uiNotReady: 'ui_not_ready',
    adapterFailed: 'adapter_failed',
    broadcastFailed: 'broadcast_failed'
});

const VERIFICATION_MARKERS = [
    'Enable JavaScript and cookies to continue',
    'Please verify you are human',
    'Request for the Private Access Token challenge',
    'Cloudflare',
    'cf-turnstile-response',
    'challenge-platform',
    'cdn-cgi/challenge-platform',
    'Turnstile'
];

const LOGIN_MARKERS = Object.freeze({
    ChatGPT: [
        'auth.openai.com',
        'auth_status":"logged_out"',
        'Continue with Google',
        'Continue with Apple',
        'Continue with email',
        'Log in',
        'Sign up'
    ],
    Grok: [
        'x.com/i/flow/login',
        'Sign in to X',
        'Phone, email, or username',
        'Forgot password?',
        'Create your account'
    ],
    Gemini: [
        'accounts.google.com',
        'Use your Google Account',
        'Forgot email?',
        'Sign in - Google Accounts'
    ],
    Doubao: [
        '/login',
        'from_logout=1',
        '手机号登录',
        '验证码登录',
        '抖音账号登录',
        '登录豆包'
    ],
    DeepSeek: [
        '/sign_in',
        '/login',
        'Log in',
        'Sign in',
        'Sign up',
        'Continue with Google'
    ]
});

export function normalizeLiveModels(models, fallbackModels = DEFAULT_LIVE_CORE_MODELS) {
    const fallback = sanitizeLiveModelList(fallbackModels);
    const normalized = sanitizeLiveModelList(models);
    return normalized.length > 0 ? normalized : fallback;
}

export function inspectPreflightState(snapshot = {}, model) {
    const normalized = normalizeSnapshot(snapshot);
    const verification = detectVerificationChallenge(normalized);
    if (verification.blocked) {
        return {
            status: LIVE_RESULT_STATUS.blockedByVerification,
            markers: verification.markers,
            reason: 'Site verification challenge is blocking the page.'
        };
    }

    const login = detectLoginRequirement(normalized, model);
    if (login.notLoggedIn) {
        return {
            status: LIVE_RESULT_STATUS.notLoggedIn,
            markers: login.markers,
            reason: 'The site appears to require login before live testing can continue.'
        };
    }

    return {
        status: LIVE_RESULT_STATUS.ok,
        markers: [],
        reason: ''
    };
}

export function classifyBroadcastDispatch(response, model) {
    const sentModels = Array.isArray(response?.sentModels) ? response.sentModels : [];
    if (response?.status === 'broadcast_done' && sentModels.includes(model)) {
        return {
            status: LIVE_RESULT_STATUS.ok,
            code: 'broadcast_sent',
            reason: 'Broadcast reached the requested model tab.'
        };
    }

    const failedEntry = findModelEntry(response?.failed, model);
    if (failedEntry) {
        const code = String(failedEntry.code || 'broadcast_failed');
        const reason = String(failedEntry.reason || 'Broadcast failed');
        return {
            status: classifyAdapterFailure(code, reason),
            code,
            reason
        };
    }

    const skippedEntry = findModelEntry(response?.skipped, model);
    if (skippedEntry) {
        return {
            status: LIVE_RESULT_STATUS.broadcastFailed,
            code: String(skippedEntry.code || 'broadcast_skipped'),
            reason: String(skippedEntry.reason || 'Broadcast was skipped for this model.')
        };
    }

    if (response?.status === 'error') {
        return {
            status: LIVE_RESULT_STATUS.broadcastFailed,
            code: String(response?.code || 'broadcast_failed'),
            reason: String(response?.message || 'Broadcast failed.')
        };
    }

    return {
        status: LIVE_RESULT_STATUS.broadcastFailed,
        code: 'broadcast_not_confirmed',
        reason: `Broadcast did not confirm delivery to ${model}.`
    };
}

export function classifyAdapterFailure(code = '', reason = '') {
    const haystack = `${String(code || '')} ${String(reason || '')}`.toLowerCase();
    const uiMarkers = [
        'input element not found',
        'input was not found',
        'failed to trigger send',
        'send button unavailable',
        'send button unavailable',
        'not interactable',
        'element is not visible'
    ];

    if (uiMarkers.some((marker) => haystack.includes(marker))) {
        return LIVE_RESULT_STATUS.uiNotReady;
    }

    return LIVE_RESULT_STATUS.adapterFailed;
}

export function buildLiveResult({
    model,
    status,
    url = '',
    title = '',
    markers = [],
    code = '',
    reason = ''
} = {}) {
    return {
        model: String(model || ''),
        status: String(status || LIVE_RESULT_STATUS.broadcastFailed),
        url: String(url || ''),
        title: String(title || ''),
        markers: Array.isArray(markers) ? markers.map((item) => String(item || '')).filter(Boolean) : [],
        code: String(code || ''),
        reason: String(reason || '')
    };
}

export function normalizeSnapshot(snapshot = {}) {
    return {
        url: String(snapshot.url || ''),
        title: String(snapshot.title || ''),
        bodyText: String(snapshot.bodyText || ''),
        html: String(snapshot.html || '')
    };
}

export function detectVerificationChallenge(snapshot = {}) {
    const normalized = normalizeSnapshot(snapshot);
    const haystacks = [
        normalized.url,
        normalized.title,
        normalized.bodyText,
        normalized.html
    ];

    const markers = VERIFICATION_MARKERS.filter((marker) => haystacks.some((value) => value.includes(marker)));
    return {
        blocked: markers.length > 0,
        markers
    };
}

export function detectLoginRequirement(snapshot = {}, model) {
    const normalized = normalizeSnapshot(snapshot);
    const markers = [];
    const modelMarkers = LOGIN_MARKERS[model] || [];
    const haystacks = [
        normalized.url,
        normalized.title,
        normalized.bodyText,
        normalized.html
    ];

    for (const marker of modelMarkers) {
        if (haystacks.some((value) => value.includes(marker))) {
            markers.push(marker);
        }
    }

    return {
        notLoggedIn: markers.length > 0,
        markers
    };
}

function sanitizeLiveModelList(models) {
    const seen = new Set();
    const values = Array.isArray(models) ? models : [];
    const normalized = [];

    for (const item of values) {
        const value = String(item || '').trim();
        if (!value || !SUPPORTED_LIVE_MODELS.includes(value) || seen.has(value)) {
            continue;
        }
        seen.add(value);
        normalized.push(value);
    }

    return normalized;
}

function findModelEntry(items, model) {
    if (!Array.isArray(items)) return null;
    return items.find((item) => String(item?.model || '') === model) || null;
}
