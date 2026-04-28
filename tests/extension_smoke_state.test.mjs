import assert from 'node:assert/strict';

let stateModule;

try {
    stateModule = await import('../scripts/lib/extension_smoke_state.mjs');
} catch (error) {
    stateModule = { __importError: error };
}

const {
    RT_KEYS,
    RT_SCHEMA_VERSION,
    buildPanelSmokeState
} = stateModule;

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('extension smoke state module is loadable', () => {
    assert.ok(!stateModule.__importError, stateModule.__importError?.message);
    assert.equal(typeof buildPanelSmokeState, 'function');
    assert.equal(typeof RT_KEYS, 'object');
    assert.equal(typeof RT_SCHEMA_VERSION, 'number');
});

runTest('smoke fixture seeds one active round with candidates, evaluations, and ranking', () => {
    const fixture = buildPanelSmokeState({ now: 1710000000000 });

    assert.equal(fixture[RT_KEYS.schemaVersion], RT_SCHEMA_VERSION);
    assert.deepEqual(fixture[RT_KEYS.roundIndex], ['round_smoke']);

    const round = fixture[RT_KEYS.rounds].round_smoke;
    assert.equal(round.question, '如何把 AI RoundTable 打造成更高效的多模型协作插件？');
    assert.equal(round.status, 'completed');
    assert.deepEqual(round.candidateIds, ['candidate_gpt', 'candidate_deepseek']);
    assert.deepEqual(round.evaluationIds, ['evaluation_gemini', 'evaluation_doubao']);
    assert.equal(round.config.reviewMode, 'scoring');
    assert.equal(round.config.labelMode, 'blind');
    assert.equal(round.ranking.length, 2);

    const candidateGpt = fixture[RT_KEYS.candidates].candidate_gpt;
    const candidateDeepSeek = fixture[RT_KEYS.candidates].candidate_deepseek;
    assert.match(candidateGpt.answerText, /Router/);
    assert.match(candidateDeepSeek.answerText, /评审/);

    const evaluationGemini = fixture[RT_KEYS.evaluations].evaluation_gemini;
    assert.equal(evaluationGemini.status, 'done');
    assert.deepEqual(Object.keys(evaluationGemini.blindMap), ['A', 'B']);
    assert.equal(evaluationGemini.parsedScores.length, 2);
});

runTest('smoke fixture also seeds model summaries for quote and candidate actions', () => {
    const fixture = buildPanelSmokeState();
    const modelState = fixture[RT_KEYS.modelState];

    assert.equal(modelState.ChatGPT.status, 'idle');
    assert.match(modelState.ChatGPT.lastSummary, /中文/);
    assert.equal(modelState.Claude, undefined);
    assert.equal(modelState.DeepSeek.status, 'idle');
    assert.match(modelState.DeepSeek.lastSummary, /落地/);
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

console.log(`Completed ${passed}/${tests.length} extension smoke state checks.`);
