import assert from 'node:assert/strict';

let importModule;

try {
    importModule = await import('../src/sidepanel/router_review_import.mjs');
} catch (error) {
    importModule = { __importError: error };
}

const {
    buildReviewImportBundle
} = importModule;

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('router review import module is loadable', () => {
    assert.ok(!importModule.__importError, importModule.__importError?.message);
    assert.equal(typeof buildReviewImportBundle, 'function');
});

runTest('scoring review import builds answer quote plus non-self feedback quotes', () => {
    const round = {
        roundId: 'round_1',
        config: {
            reviewMode: 'scoring'
        },
        candidates: [
            {
                candidateId: 'candidate_chatgpt',
                model: 'ChatGPT',
                answerText: '原答案：先做 A，再做 B。'
            }
        ],
        evaluations: [
            {
                evaluationId: 'eval_gemini',
                judgeModel: 'Gemini',
                status: 'done',
                mode: 'scoring',
                blindMap: {
                    A: 'candidate_chatgpt'
                },
                parsedScores: [
                    {
                        slot: 'A',
                        accuracy: 8,
                        completeness: 7,
                        actionability: 8,
                        clarity: 9,
                        overall: 8,
                        reason: '步骤清楚，但风险分析不足。',
                        evidence: ['没有覆盖失败回滚。', '缺少边界条件。']
                    }
                ]
            },
            {
                evaluationId: 'eval_chatgpt_self',
                judgeModel: 'ChatGPT',
                status: 'done',
                mode: 'scoring',
                blindMap: {
                    A: 'candidate_chatgpt'
                },
                parsedScores: [
                    {
                        slot: 'A',
                        accuracy: 10,
                        completeness: 10,
                        actionability: 10,
                        clarity: 10,
                        overall: 10,
                        reason: '自评内容不应被导入。',
                        evidence: ['self']
                    }
                ]
            }
        ]
    };

    const bundle = buildReviewImportBundle(round, 'candidate_chatgpt');

    assert.equal(bundle.errorCode, null);
    assert.equal(bundle.followupSource, 'ChatGPT');
    assert.equal(bundle.quoteList.length, 2);
    assert.deepEqual(bundle.quoteList.map((item) => item.kind), ['answer', 'feedback']);
    assert.equal(bundle.quoteList[0].source, 'ChatGPT');
    assert.match(bundle.quoteList[1].text, /Gemini/);
    assert.match(bundle.quoteList[1].text, /步骤清楚/);
    assert.equal(bundle.quoteList[1].targetSource, 'ChatGPT');
});

runTest('discussion review import uses raw discussion responses as feedback', () => {
    const round = {
        roundId: 'round_2',
        config: {
            reviewMode: 'discussion'
        },
        candidates: [
            {
                candidateId: 'candidate_grok',
                model: 'Grok',
                answerText: '原答案：建议拆成两阶段推进。'
            }
        ],
        evaluations: [
            {
                evaluationId: 'eval_gemini_discussion',
                judgeModel: 'Gemini',
                status: 'done',
                mode: 'discussion',
                rawResponse: '我会追问风险边界，并建议补一个更明确的结论。'
            }
        ]
    };

    const bundle = buildReviewImportBundle(round, 'candidate_grok');

    assert.equal(bundle.errorCode, null);
    assert.equal(bundle.followupSource, 'Grok');
    assert.equal(bundle.quoteList.length, 2);
    assert.equal(bundle.quoteList[1].kind, 'feedback');
    assert.equal(bundle.quoteList[1].targetSource, 'Grok');
    assert.match(bundle.quoteList[1].text, /更明确的结论/);
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

console.log(`Completed ${passed}/${tests.length} router review import checks.`);
