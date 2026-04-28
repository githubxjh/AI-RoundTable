import assert from 'node:assert/strict';

let routerPresetsModule;

try {
    routerPresetsModule = await import('../src/sidepanel/router_presets.mjs');
} catch (error) {
    routerPresetsModule = { __importError: error };
}

const {
    MAX_ROUTER_MODIFIERS,
    FOLLOWUP_PRIMARY_PRESET_ID,
    ROUTER_PRESETS,
    createEmptyRouterPresetState,
    applyPresetSelection,
    buildRouterInstruction,
    buildFinalRouterPrompt,
    buildRouteReferenceBlock,
    getFollowupEligibleSources,
    validateFollowupRoute
} = routerPresetsModule;

function getMessage(key) {
    const messages = {
        routerGeneratedIntro: '基于上面的引用内容，请完成以下任务：',
        routerRespondReviewIntro: '请基于下面整理的材料完成以下任务：',
        routerRespondReviewStepRespond: '先回应其他 AI 提出的关键质疑、追问和补充，说明你接受、部分接受或不接受的内容及原因。',
        routerRespondReviewStepRevise: '在吸收有效反馈后，给出一版更新后的完整回答。',
        routerRespondReviewStepSummarize: '最后用简短总结说明你这次具体修正了什么、还保留哪些不确定点。',
        routerFollowupAnswerSection: '你的上一版回答',
        routerFollowupFeedbackSection: '其他 AI 的评价、追问与补充',
        routerSupplementPrefix: '补充要求：',
        routerPresetInstructionRedTeaming: '请站在最严格的审查者视角，指出最关键的漏洞与风险，并按影响大小排序。',
        routerPresetInstructionFactCheck: '请核查其中的事实性陈述，明确可信、存疑与过时内容。',
        routerPresetInstructionTradeOff: '请分析不同方案的收益、成本、约束与副作用。',
        routerPresetInstructionDecision: '请基于现有信息给出明确建议，并说明推荐与不推荐的原因。',
        routerPresetInstructionMergeDraft: '请吸收各方回答优点，合并成一个更完整可信的版本。',
        routerPresetInstructionBlindSpot: '请补充容易被忽视的盲区、边界条件、利益相关方和反例。',
        routerPresetInstructionKeyQuestions: '如果还不能下结论，请提出最值得追问的关键问题，并说明它们能澄清什么风险。',
        routerPresetInstructionExecution: '请把结论展开成可执行方案，拆成步骤、角色分工、前置依赖与下一步动作。'
    };

    return messages[key] || '';
}

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('router preset module is loadable', () => {
    assert.ok(!routerPresetsModule.__importError, routerPresetsModule.__importError?.message);
    assert.equal(typeof createEmptyRouterPresetState, 'function');
    assert.equal(typeof applyPresetSelection, 'function');
    assert.equal(typeof buildRouterInstruction, 'function');
    assert.equal(typeof buildFinalRouterPrompt, 'function');
    assert.equal(typeof buildRouteReferenceBlock, 'function');
    assert.equal(typeof getFollowupEligibleSources, 'function');
    assert.equal(typeof validateFollowupRoute, 'function');
});

runTest('preset catalog exposes 6 primary presets and 3 modifiers', () => {
    assert.equal(MAX_ROUTER_MODIFIERS, 2);
    assert.equal(Array.isArray(ROUTER_PRESETS), true);

    const primaryIds = ROUTER_PRESETS.filter((preset) => preset.role === 'primary').map((preset) => preset.id);
    const modifierIds = ROUTER_PRESETS.filter((preset) => preset.role === 'modifier').map((preset) => preset.id);

    assert.equal(FOLLOWUP_PRIMARY_PRESET_ID, 'respond-review');
    assert.deepEqual(primaryIds, ['red-teaming', 'fact-check', 'trade-off', 'decision', 'merge-draft', 'respond-review']);
    assert.deepEqual(modifierIds, ['blind-spot', 'key-questions', 'execution']);
});

runTest('modifier cannot be selected before a primary preset', () => {
    const result = applyPresetSelection(createEmptyRouterPresetState(), 'blind-spot');

    assert.equal(result.errorCode, 'primary_required');
    assert.deepEqual(result.nextState, {
        selectedPrimaryPresetId: null,
        selectedModifierPresetIds: [],
        selectedFollowupSource: null
    });
});

runTest('switching primary keeps selected modifiers', () => {
    let state = createEmptyRouterPresetState();
    state = applyPresetSelection(state, 'red-teaming').nextState;
    state = applyPresetSelection(state, 'blind-spot').nextState;
    state = applyPresetSelection(state, 'decision').nextState;

    assert.deepEqual(state, {
        selectedPrimaryPresetId: 'decision',
        selectedModifierPresetIds: ['blind-spot'],
        selectedFollowupSource: null
    });
});

runTest('clicking current primary again clears primary and modifiers', () => {
    let state = createEmptyRouterPresetState();
    state = applyPresetSelection(state, 'fact-check').nextState;
    state = applyPresetSelection(state, 'blind-spot').nextState;
    state = applyPresetSelection(state, 'key-questions').nextState;
    state = applyPresetSelection(state, 'fact-check').nextState;

    assert.deepEqual(state, {
        selectedPrimaryPresetId: null,
        selectedModifierPresetIds: [],
        selectedFollowupSource: null
    });
});

runTest('third modifier is rejected and selection stays unchanged', () => {
    let state = createEmptyRouterPresetState();
    state = applyPresetSelection(state, 'merge-draft').nextState;
    state = applyPresetSelection(state, 'blind-spot').nextState;
    state = applyPresetSelection(state, 'key-questions').nextState;

    const result = applyPresetSelection(state, 'execution');

    assert.equal(result.errorCode, 'modifier_limit_reached');
    assert.deepEqual(result.nextState, {
        selectedPrimaryPresetId: 'merge-draft',
        selectedModifierPresetIds: ['blind-spot', 'key-questions'],
        selectedFollowupSource: null
    });
});

runTest('respond-review selection clears modifiers and resets followup source', () => {
    let state = createEmptyRouterPresetState();
    state = applyPresetSelection(state, 'merge-draft').nextState;
    state = applyPresetSelection(state, 'blind-spot').nextState;
    state = {
        ...state,
        selectedFollowupSource: 'ChatGPT'
    };

    state = applyPresetSelection(state, 'respond-review').nextState;

    assert.deepEqual(state, {
        selectedPrimaryPresetId: 'respond-review',
        selectedModifierPresetIds: [],
        selectedFollowupSource: null
    });
});

runTest('generated instruction is a numbered Chinese task list', () => {
    const state = {
        selectedPrimaryPresetId: 'trade-off',
        selectedModifierPresetIds: ['blind-spot', 'execution'],
        selectedFollowupSource: null
    };

    const instruction = buildRouterInstruction(state, getMessage);

    assert.equal(
        instruction,
        [
            '基于上面的引用内容，请完成以下任务：',
            '1. 请分析不同方案的收益、成本、约束与副作用。',
            '2. 请补充容易被忽视的盲区、边界条件、利益相关方和反例。',
            '3. 请把结论展开成可执行方案，拆成步骤、角色分工、前置依赖与下一步动作。'
        ].join('\n')
    );
});

runTest('respond-review instruction uses dedicated three-step template', () => {
    const state = {
        selectedPrimaryPresetId: 'respond-review',
        selectedModifierPresetIds: [],
        selectedFollowupSource: 'ChatGPT'
    };

    const instruction = buildRouterInstruction(state, getMessage);

    assert.equal(
        instruction,
        [
            '请基于下面整理的材料完成以下任务：',
            '1. 先回应其他 AI 提出的关键质疑、追问和补充，说明你接受、部分接受或不接受的内容及原因。',
            '2. 在吸收有效反馈后，给出一版更新后的完整回答。',
            '3. 最后用简短总结说明你这次具体修正了什么、还保留哪些不确定点。'
        ].join('\n')
    );
});

runTest('final route prompt appends supplement after generated instruction', () => {
    const prompt = buildFinalRouterPrompt(
        '基于上面的引用内容，请完成以下任务：\n1. 请核查其中的事实性陈述，明确可信、存疑与过时内容。',
        '请优先关注面向中国市场的影响。',
        getMessage
    );

    assert.equal(
        prompt,
        [
            '基于上面的引用内容，请完成以下任务：',
            '1. 请核查其中的事实性陈述，明确可信、存疑与过时内容。',
            '',
            '补充要求：请优先关注面向中国市场的影响。'
        ].join('\n')
    );
});

runTest('followup eligible sources come from answer-like quotes only', () => {
    const sources = getFollowupEligibleSources([
        { source: 'ChatGPT', text: 'A1', kind: 'answer' },
        { source: 'Gemini', text: 'A2', kind: 'answer' },
        { source: 'Gemini', text: 'A3', kind: 'answer' },
        { source: 'Doubao', text: 'F1', kind: 'feedback', targetSource: 'ChatGPT' }
    ]);

    assert.deepEqual(sources, ['ChatGPT', 'Gemini']);
});

runTest('followup validation requires original answer and external feedback', () => {
    const result = validateFollowupRoute({
        selectedFollowupSource: 'ChatGPT',
        quoteList: [
            { source: 'ChatGPT', text: '原答案', kind: 'answer' }
        ]
    });

    assert.equal(result.errorCode, 'followup_feedback_required');
});

runTest('followup reference block separates original answer and external feedback', () => {
    const block = buildRouteReferenceBlock([
        { source: 'ChatGPT', text: '这是我原来的答案。', kind: 'answer' },
        { source: 'Gemini', text: '这里有一个事实问题。', kind: 'answer' },
        { source: 'Doubao', text: '理由：你漏掉了边界条件。', kind: 'feedback', targetSource: 'ChatGPT' }
    ], {
        selectedPrimaryPresetId: 'respond-review',
        selectedModifierPresetIds: [],
        selectedFollowupSource: 'ChatGPT'
    }, getMessage);

    assert.equal(
        block,
        [
            '[你的上一版回答]',
            '模型：ChatGPT',
            '这是我原来的答案。',
            '',
            '[其他 AI 的评价、追问与补充]',
            '模型：Gemini',
            '这里有一个事实问题。',
            '',
            '模型：Doubao',
            '理由：你漏掉了边界条件。'
        ].join('\n')
    );
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

console.log(`Completed ${passed}/${tests.length} router preset checks.`);
