export const LIVE_BACKEND = Object.freeze({
    attach: 'attach',
    chromium: 'chromium'
});

export function normalizeLiveBackend(value, fallback = LIVE_BACKEND.attach) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === LIVE_BACKEND.attach || normalized === LIVE_BACKEND.chromium) {
        return normalized;
    }
    return fallback;
}

export function getLiveArtifactFolder(backend) {
    return normalizeLiveBackend(backend) === LIVE_BACKEND.chromium
        ? 'live-chromium'
        : 'live';
}
