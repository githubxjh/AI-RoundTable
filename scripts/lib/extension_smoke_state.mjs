export const RT_SCHEMA_VERSION = 2;

export const RT_KEYS = {
    schemaVersion: 'rt_schema_version',
    roundIndex: 'rt_round_index',
    rounds: 'rt_rounds',
    candidates: 'rt_candidates',
    evaluations: 'rt_evaluations',
    modelState: 'rt_model_state',
    settings: 'rt_settings'
};

export function buildPanelSmokeState({ now = Date.now() } = {}) {
    const createdAt = Number(now) - 60_000;
    const updatedAt = Number(now) - 10_000;

    const round = {
        roundId: 'round_smoke',
        question: '如何把 AI RoundTable 打造成更高效的多模型协作插件？',
        status: 'completed',
        targetModels: ['ChatGPT', 'Claude', 'Grok'],
        candidateIds: ['candidate_gpt', 'candidate_claude'],
        evaluationIds: ['evaluation_gemini', 'evaluation_doubao'],
        ranking: [
            {
                candidateId: 'candidate_gpt',
                finalScore: 8.91,
                rawMean: 8.72,
                normalizedMean: 8.91,
                nonSelfMean: 8.95,
                variance: 0.08
            },
            {
                candidateId: 'candidate_claude',
                finalScore: 8.34,
                rawMean: 8.31,
                normalizedMean: 8.34,
                nonSelfMean: 8.29,
                variance: 0.12
            }
        ],
        config: {
            retentionDays: 30,
            selfReviewWeight: 0.2,
            nonSelfWeight: 1,
            semanticFallbackEnabled: true,
            semanticFallbackWeight: 0.3,
            semanticFallbackMinConfidence: 0.65,
            weights: {
                accuracy: 0.4,
                completeness: 0.25,
                actionability: 0.2,
                clarity: 0.15
            },
            scoringScale: '1-10',
            blindReview: true,
            isolationMode: 'reuse_current_chat',
            reviewMode: 'scoring',
            labelMode: 'blind'
        },
        createdAt,
        updatedAt
    };

    const candidates = {
        candidate_gpt: {
            candidateId: 'candidate_gpt',
            roundId: round.roundId,
            model: 'ChatGPT',
            answerText: '建议先把 Router 做成主任务 + 修饰器的中文组合，再围绕 smoke 自动化补回归。',
            capturedAt: createdAt + 1_000
        },
        candidate_claude: {
            candidateId: 'candidate_claude',
            roundId: round.roundId,
            model: 'Claude',
            answerText: '重点是把评审、路由和落地建议拆开，让界面更清晰，同时补稳定的自测脚本。',
            capturedAt: createdAt + 2_000
        }
    };

    const evaluations = {
        evaluation_gemini: {
            evaluationId: 'evaluation_gemini',
            roundId: round.roundId,
            judgeModel: 'Gemini',
            mode: 'scoring',
            labelMode: 'blind',
            blindMap: {
                A: 'candidate_gpt',
                B: 'candidate_claude'
            },
            status: 'done',
            parsedScores: [
                {
                    slot: 'A',
                    accuracy: 9,
                    completeness: 9,
                    actionability: 9,
                    clarity: 8,
                    overall: 8.8,
                    reason: '方案结构清晰，能直接指导下一步自测落地。',
                    evidence: ['把 Router 结构和 smoke 自动化同时纳入交付。']
                },
                {
                    slot: 'B',
                    accuracy: 8,
                    completeness: 8,
                    actionability: 8,
                    clarity: 9,
                    overall: 8.25,
                    reason: '更强调评审与界面分层，但执行抓手略少一点。',
                    evidence: ['建议方向正确，但可操作步骤稍弱。']
                }
            ],
            rawResponse: '',
            normalizedBy: null,
            rawSummaryChars: 0,
            normalizeError: null,
            createdAt: createdAt + 3_000,
            completedAt: updatedAt - 4_000
        },
        evaluation_doubao: {
            evaluationId: 'evaluation_doubao',
            roundId: round.roundId,
            judgeModel: 'Doubao',
            mode: 'scoring',
            labelMode: 'blind',
            blindMap: {
                A: 'candidate_gpt',
                B: 'candidate_claude'
            },
            status: 'done',
            parsedScores: [
                {
                    slot: 'A',
                    accuracy: 9,
                    completeness: 8,
                    actionability: 9,
                    clarity: 9,
                    overall: 8.75,
                    reason: '兼顾中文体验和自动化验证，优先级划分合理。',
                    evidence: ['先 smoke 后 live 的顺序能降低调试成本。']
                },
                {
                    slot: 'B',
                    accuracy: 8,
                    completeness: 8,
                    actionability: 8,
                    clarity: 8,
                    overall: 8.0,
                    reason: '思路稳妥，但对测试环境脚本的拆分还可以更细。',
                    evidence: ['对落地路径有帮助，但细节不足。']
                }
            ],
            rawResponse: '',
            normalizedBy: null,
            rawSummaryChars: 0,
            normalizeError: null,
            createdAt: createdAt + 4_000,
            completedAt: updatedAt - 2_000
        }
    };

    return {
        [RT_KEYS.schemaVersion]: RT_SCHEMA_VERSION,
        [RT_KEYS.roundIndex]: [round.roundId],
        [RT_KEYS.rounds]: {
            [round.roundId]: round
        },
        [RT_KEYS.candidates]: candidates,
        [RT_KEYS.evaluations]: evaluations,
        [RT_KEYS.modelState]: {
            ChatGPT: {
                status: 'idle',
                lastSummary: '建议先把中文 Router 和自测脚本一起搭起来。',
                updatedAt: updatedAt - 6_000
            },
            Claude: {
                status: 'idle',
                lastSummary: '先把评审链路和落地建议分层，再补自动化回归。',
                updatedAt: updatedAt - 5_000
            }
        },
        [RT_KEYS.settings]: {}
    };
}
