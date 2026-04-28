import { ROUTER_QUOTE_KIND } from './router_presets.mjs';

export function buildReviewImportBundle(round, candidateId) {
    const candidate = (Array.isArray(round?.candidates) ? round.candidates : [])
        .find((item) => item?.candidateId === candidateId);

    if (!candidate) {
        return {
            errorCode: 'candidate_not_found',
            followupSource: null,
            quoteList: []
        };
    }

    const answerText = extractCandidateText(candidate);
    if (!answerText) {
        return {
            errorCode: 'candidate_answer_missing',
            followupSource: null,
            quoteList: []
        };
    }

    const followupSource = String(candidate.model || '').trim();
    if (!followupSource) {
        return {
            errorCode: 'candidate_model_missing',
            followupSource: null,
            quoteList: []
        };
    }

    const answerQuote = {
        source: followupSource,
        text: answerText,
        kind: ROUTER_QUOTE_KIND.answer,
        targetSource: null,
        meta: {
            candidateId,
            roundId: round?.roundId || null
        }
    };

    const reviewMode = normalizeReviewMode(round?.config?.reviewMode);
    const feedbackQuotes = reviewMode === 'discussion'
        ? collectDiscussionFeedback(round, candidate)
        : collectScoringFeedback(round, candidate);

    if (feedbackQuotes.length === 0) {
        return {
            errorCode: 'followup_feedback_missing',
            followupSource,
            quoteList: [answerQuote]
        };
    }

    return {
        errorCode: null,
        followupSource,
        quoteList: [answerQuote, ...feedbackQuotes]
    };
}

function collectScoringFeedback(round, candidate) {
    const evaluations = Array.isArray(round?.evaluations) ? round.evaluations : [];
    const feedbackQuotes = [];

    evaluations.forEach((evaluation) => {
        if (String(evaluation?.status || '').trim() !== 'done') return;
        if (String(evaluation?.judgeModel || '').trim() === String(candidate?.model || '').trim()) return;

        const row = findParsedScoreForCandidate(evaluation, candidate?.candidateId);
        if (!row) return;

        const metrics = [
            `overall ${formatMetric(row.overall)}`,
            `accuracy ${formatMetric(row.accuracy)}`,
            `completeness ${formatMetric(row.completeness)}`,
            `actionability ${formatMetric(row.actionability)}`,
            `clarity ${formatMetric(row.clarity)}`
        ].join(' | ');
        const evidence = Array.isArray(row?.evidence)
            ? row.evidence.map((item) => String(item || '').trim()).filter(Boolean)
            : [];

        const lines = [
            `来自 ${evaluation.judgeModel} 的评审意见`,
            `评分摘要：${metrics}`
        ];

        if (String(row?.reason || '').trim()) {
            lines.push(`理由：${String(row.reason).trim()}`);
        }
        if (evidence.length > 0) {
            lines.push('证据：');
            evidence.forEach((item) => {
                lines.push(`- ${item}`);
            });
        }

        feedbackQuotes.push({
            source: String(evaluation.judgeModel || '').trim(),
            text: lines.join('\n').trim(),
            kind: ROUTER_QUOTE_KIND.feedback,
            targetSource: String(candidate?.model || '').trim(),
            meta: {
                evaluationId: evaluation?.evaluationId || null,
                mode: 'scoring',
                candidateId: candidate?.candidateId || null
            }
        });
    });

    return feedbackQuotes;
}

function collectDiscussionFeedback(round, candidate) {
    const evaluations = Array.isArray(round?.evaluations) ? round.evaluations : [];
    const feedbackQuotes = [];

    evaluations.forEach((evaluation) => {
        if (String(evaluation?.status || '').trim() !== 'done') return;
        if (String(evaluation?.judgeModel || '').trim() === String(candidate?.model || '').trim()) return;

        const rawResponse = String(evaluation?.rawResponse || '').trim();
        if (!rawResponse) return;

        feedbackQuotes.push({
            source: String(evaluation.judgeModel || '').trim(),
            text: `来自 ${evaluation.judgeModel} 的讨论回复\n${rawResponse}`,
            kind: ROUTER_QUOTE_KIND.feedback,
            targetSource: String(candidate?.model || '').trim(),
            meta: {
                evaluationId: evaluation?.evaluationId || null,
                mode: 'discussion',
                candidateId: candidate?.candidateId || null
            }
        });
    });

    return feedbackQuotes;
}

function findParsedScoreForCandidate(evaluation, candidateId) {
    const rows = Array.isArray(evaluation?.parsedScores) ? evaluation.parsedScores : [];
    return rows.find((row) => {
        const slot = String(row?.slot || '').trim().toUpperCase();
        return (evaluation?.blindMap || {})[slot] === candidateId;
    }) || null;
}

function extractCandidateText(candidate) {
    const keys = ['answerText', 'answer', 'summary', 'text'];
    for (const key of keys) {
        const value = String(candidate?.[key] || '').trim();
        if (value) return value;
    }
    return '';
}

function normalizeReviewMode(mode) {
    return String(mode || '').trim().toLowerCase() === 'discussion' ? 'discussion' : 'scoring';
}

function formatMetric(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(2) : 'n/a';
}
