import assert from 'node:assert/strict';

let liveWorkflowModule;

try {
    liveWorkflowModule = await import('../scripts/lib/live_workflow.mjs');
} catch (error) {
    liveWorkflowModule = { __importError: error };
}

const {
    DEFAULT_LIVE_CORE_MODELS,
    DEFAULT_PROFILE_OPEN_MODELS,
    GPT_LIVE_MODELS,
    LIVE_RESULT_STATUS,
    buildLiveResult,
    classifyBroadcastDispatch,
    classifyAdapterFailure,
    inspectPreflightState,
    normalizeLiveModels
} = liveWorkflowModule;

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('live workflow module is loadable', () => {
    assert.ok(!liveWorkflowModule.__importError, liveWorkflowModule.__importError?.message);
    assert.equal(typeof normalizeLiveModels, 'function');
    assert.equal(typeof inspectPreflightState, 'function');
    assert.equal(typeof classifyBroadcastDispatch, 'function');
});

runTest('default model groups match the planned live workflow', () => {
    assert.deepEqual(DEFAULT_LIVE_CORE_MODELS, ['Gemini', 'Doubao', 'Grok']);
    assert.deepEqual(DEFAULT_PROFILE_OPEN_MODELS, ['Gemini', 'Doubao', 'Grok', 'ChatGPT']);
    assert.deepEqual(GPT_LIVE_MODELS, ['ChatGPT']);
});

runTest('normalizeLiveModels falls back to core models and removes duplicates', () => {
    assert.deepEqual(normalizeLiveModels([]), ['Gemini', 'Doubao', 'Grok']);
    assert.deepEqual(
        normalizeLiveModels(['ChatGPT', 'ChatGPT', 'Unknown', 'Gemini']),
        ['ChatGPT', 'Gemini']
    );
});

runTest('preflight detects verification pages before login checks', () => {
    const result = inspectPreflightState({
        url: 'https://chatgpt.com/',
        title: 'ChatGPT',
        bodyText: 'Please verify you are human',
        html: '<input name="cf-turnstile-response">'
    }, 'ChatGPT');

    assert.equal(result.status, LIVE_RESULT_STATUS.blockedByVerification);
    assert.match(result.reason, /verification/i);
    assert.ok(result.markers.includes('Please verify you are human'));
});

runTest('preflight detects not-logged-in pages for supported models', () => {
    const result = inspectPreflightState({
        url: 'https://accounts.google.com/signin/v2',
        title: 'Sign in - Google Accounts',
        bodyText: 'Use your Google Account',
        html: '<body>Forgot email?</body>'
    }, 'Gemini');

    assert.equal(result.status, LIVE_RESULT_STATUS.notLoggedIn);
    assert.ok(result.markers.includes('accounts.google.com'));
});

runTest('preflight detects Doubao logout redirects as not logged in', () => {
    const result = inspectPreflightState({
        url: 'https://www.doubao.com/chat/?from_logout=1',
        title: '豆包',
        bodyText: '',
        html: ''
    }, 'Doubao');

    assert.equal(result.status, LIVE_RESULT_STATUS.notLoggedIn);
    assert.ok(result.markers.includes('from_logout=1'));
});

runTest('broadcast dispatch classification distinguishes ui and adapter failures', () => {
    const uiResult = classifyBroadcastDispatch({
        status: 'broadcast_done',
        sentModels: [],
        failed: [{
            model: 'Grok',
            code: 'input_failed',
            reason: 'Input element not found: textarea'
        }]
    }, 'Grok');

    const adapterResult = classifyBroadcastDispatch({
        status: 'broadcast_done',
        sentModels: [],
        failed: [{
            model: 'Gemini',
            code: 'input_failed',
            reason: 'Unexpected DOM mutation'
        }]
    }, 'Gemini');

    assert.equal(uiResult.status, LIVE_RESULT_STATUS.uiNotReady);
    assert.equal(adapterResult.status, LIVE_RESULT_STATUS.adapterFailed);
    assert.equal(classifyAdapterFailure('input_failed', 'Failed to trigger send'), LIVE_RESULT_STATUS.uiNotReady);
});

runTest('buildLiveResult normalizes optional fields', () => {
    const result = buildLiveResult({
        model: 'Doubao',
        status: LIVE_RESULT_STATUS.ok,
        markers: ['ready']
    });

    assert.deepEqual(result, {
        model: 'Doubao',
        status: 'ok',
        url: '',
        title: '',
        markers: ['ready'],
        code: '',
        reason: ''
    });
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

console.log(`Completed ${passed}/${tests.length} live workflow checks.`);
