import assert from 'node:assert/strict';

let routerPresetsModule;

try {
    routerPresetsModule = await import('../src/sidepanel/router_presets.mjs');
} catch (error) {
    routerPresetsModule = { __importError: error };
}

const {
    MAX_ROUTER_MODIFIERS,
    ROUTER_PRESETS,
    createEmptyRouterPresetState,
    applyPresetSelection,
    buildRouterInstruction,
    buildFinalRouterPrompt
} = routerPresetsModule;

function getMessage(key) {
    const messages = {
        routerGeneratedIntro: '基于上面的引用内容，请完成以下任务：',
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
});

runTest('preset catalog exposes 5 primary presets and 3 modifiers', () => {
    assert.equal(MAX_ROUTER_MODIFIERS, 2);
    assert.equal(Array.isArray(ROUTER_PRESETS), true);

    const primaryIds = ROUTER_PRESETS.filter((preset) => preset.role === 'primary').map((preset) => preset.id);
    const modifierIds = ROUTER_PRESETS.filter((preset) => preset.role === 'modifier').map((preset) => preset.id);

    assert.deepEqual(primaryIds, ['red-teaming', 'fact-check', 'trade-off', 'decision', 'merge-draft']);
    assert.deepEqual(modifierIds, ['blind-spot', 'key-questions', 'execution']);
});

runTest('modifier cannot be selected before a primary preset', () => {
    const result = applyPresetSelection(createEmptyRouterPresetState(), 'blind-spot');

    assert.equal(result.errorCode, 'primary_required');
    assert.deepEqual(result.nextState, {
        selectedPrimaryPresetId: null,
        selectedModifierPresetIds: []
    });
});

runTest('switching primary keeps selected modifiers', () => {
    let state = createEmptyRouterPresetState();
    state = applyPresetSelection(state, 'red-teaming').nextState;
    state = applyPresetSelection(state, 'blind-spot').nextState;
    state = applyPresetSelection(state, 'decision').nextState;

    assert.deepEqual(state, {
        selectedPrimaryPresetId: 'decision',
        selectedModifierPresetIds: ['blind-spot']
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
        selectedModifierPresetIds: []
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
        selectedModifierPresetIds: ['blind-spot', 'key-questions']
    });
});

runTest('generated instruction is a numbered Chinese task list', () => {
    const state = {
        selectedPrimaryPresetId: 'trade-off',
        selectedModifierPresetIds: ['blind-spot', 'execution']
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

runTest('final route prompt appends supplement after generated instruction', () => {
    const prompt = buildFinalRouterPrompt(
        '基于上面的引用内容，请完成以下任务：\n1. 请核查其中的事实性陈述，明确可信、存疑与过时内容。',
        '请优先关注面向中国市场的影响。 ',
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
