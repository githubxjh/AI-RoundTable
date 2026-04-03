import assert from 'node:assert/strict';

let liveBackendModule;

try {
    liveBackendModule = await import('../scripts/lib/live_backend.mjs');
} catch (error) {
    liveBackendModule = { __importError: error };
}

const {
    LIVE_BACKEND,
    getLiveArtifactFolder,
    normalizeLiveBackend
} = liveBackendModule;

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('live backend module is loadable', () => {
    assert.ok(!liveBackendModule.__importError, liveBackendModule.__importError?.message);
    assert.equal(typeof normalizeLiveBackend, 'function');
    assert.equal(typeof getLiveArtifactFolder, 'function');
});

runTest('normalizeLiveBackend prefers supported backends and falls back to attach', () => {
    assert.equal(normalizeLiveBackend('attach'), LIVE_BACKEND.attach);
    assert.equal(normalizeLiveBackend('chromium'), LIVE_BACKEND.chromium);
    assert.equal(normalizeLiveBackend('unknown'), LIVE_BACKEND.attach);
    assert.equal(normalizeLiveBackend(''), LIVE_BACKEND.attach);
});

runTest('getLiveArtifactFolder keeps attach as default live output and separates chromium fallback output', () => {
    assert.equal(getLiveArtifactFolder(LIVE_BACKEND.attach), 'live');
    assert.equal(getLiveArtifactFolder(LIVE_BACKEND.chromium), 'live-chromium');
    assert.equal(getLiveArtifactFolder('unknown'), 'live');
});

let passed = 0;

for (const { name, fn } of tests) {
    try {
        fn();
        passed += 1;
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        throw error;
    }
}

console.log(`Completed ${passed}/${tests.length} live backend checks.`);
