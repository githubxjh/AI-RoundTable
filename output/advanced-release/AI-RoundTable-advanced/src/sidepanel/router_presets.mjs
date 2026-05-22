export const MAX_ROUTER_MODIFIERS = 2;
export const FOLLOWUP_PRIMARY_PRESET_ID = 'respond-review';

export const ROUTER_QUOTE_KIND = Object.freeze({
    answer: 'answer',
    feedback: 'feedback',
    generic: 'generic'
});

export const ROUTER_PRESETS = [
    {
        id: 'red-teaming',
        role: 'primary',
        labelMessageKey: 'routerPresetLabelRedTeaming',
        instructionMessageKey: 'routerPresetInstructionRedTeaming'
    },
    {
        id: 'fact-check',
        role: 'primary',
        labelMessageKey: 'routerPresetLabelFactCheck',
        instructionMessageKey: 'routerPresetInstructionFactCheck'
    },
    {
        id: 'trade-off',
        role: 'primary',
        labelMessageKey: 'routerPresetLabelTradeOff',
        instructionMessageKey: 'routerPresetInstructionTradeOff'
    },
    {
        id: 'decision',
        role: 'primary',
        labelMessageKey: 'routerPresetLabelDecision',
        instructionMessageKey: 'routerPresetInstructionDecision'
    },
    {
        id: 'merge-draft',
        role: 'primary',
        labelMessageKey: 'routerPresetLabelMergeDraft',
        instructionMessageKey: 'routerPresetInstructionMergeDraft'
    },
    {
        id: FOLLOWUP_PRIMARY_PRESET_ID,
        role: 'primary',
        labelMessageKey: 'routerPresetLabelRespondReview',
        instructionMessageKey: null
    },
    {
        id: 'blind-spot',
        role: 'modifier',
        labelMessageKey: 'routerPresetLabelBlindSpot',
        instructionMessageKey: 'routerPresetInstructionBlindSpot'
    },
    {
        id: 'key-questions',
        role: 'modifier',
        labelMessageKey: 'routerPresetLabelKeyQuestions',
        instructionMessageKey: 'routerPresetInstructionKeyQuestions'
    },
    {
        id: 'execution',
        role: 'modifier',
        labelMessageKey: 'routerPresetLabelExecution',
        instructionMessageKey: 'routerPresetInstructionExecution'
    }
];

const PRESET_MAP = new Map(ROUTER_PRESETS.map((preset) => [preset.id, preset]));

export function createEmptyRouterPresetState() {
    return {
        selectedPrimaryPresetId: null,
        selectedModifierPresetIds: [],
        selectedFollowupSource: null
    };
}

export function applyPresetSelection(currentState, presetId) {
    const preset = PRESET_MAP.get(presetId);
    const baseState = normalizePresetState(currentState);

    if (!preset) {
        return { nextState: baseState, errorCode: 'preset_not_found' };
    }

    if (preset.role === 'primary') {
        if (baseState.selectedPrimaryPresetId === presetId) {
            return {
                nextState: createEmptyRouterPresetState(),
                errorCode: null
            };
        }

        return {
            nextState: {
                selectedPrimaryPresetId: presetId,
                selectedModifierPresetIds: presetId === FOLLOWUP_PRIMARY_PRESET_ID
                    ? []
                    : [...baseState.selectedModifierPresetIds],
                selectedFollowupSource: null
            },
            errorCode: null
        };
    }

    if (!baseState.selectedPrimaryPresetId) {
        return { nextState: baseState, errorCode: 'primary_required' };
    }

    if (baseState.selectedPrimaryPresetId === FOLLOWUP_PRIMARY_PRESET_ID) {
        return { nextState: baseState, errorCode: 'followup_no_modifiers' };
    }

    if (baseState.selectedModifierPresetIds.includes(presetId)) {
        return {
            nextState: {
                selectedPrimaryPresetId: baseState.selectedPrimaryPresetId,
                selectedModifierPresetIds: baseState.selectedModifierPresetIds.filter((id) => id !== presetId),
                selectedFollowupSource: null
            },
            errorCode: null
        };
    }

    if (baseState.selectedModifierPresetIds.length >= MAX_ROUTER_MODIFIERS) {
        return { nextState: baseState, errorCode: 'modifier_limit_reached' };
    }

    return {
        nextState: {
            selectedPrimaryPresetId: baseState.selectedPrimaryPresetId,
            selectedModifierPresetIds: [...baseState.selectedModifierPresetIds, presetId],
            selectedFollowupSource: null
        },
        errorCode: null
    };
}

export function buildRouterInstruction(currentState, getMessage) {
    const state = normalizePresetState(currentState);
    if (!state.selectedPrimaryPresetId) {
        return '';
    }

    if (state.selectedPrimaryPresetId === FOLLOWUP_PRIMARY_PRESET_ID) {
        return buildRespondReviewInstruction(getMessage);
    }

    const lines = [];
    const intro = safeMessage(getMessage, 'routerGeneratedIntro');
    if (intro) {
        lines.push(intro);
    }

    const orderedPresetIds = [state.selectedPrimaryPresetId, ...state.selectedModifierPresetIds];
    orderedPresetIds.forEach((presetId, index) => {
        const preset = PRESET_MAP.get(presetId);
        if (!preset) {
            return;
        }
        const instruction = safeMessage(getMessage, preset.instructionMessageKey);
        if (instruction) {
            lines.push(`${index + 1}. ${instruction}`);
        }
    });

    return lines.join('\n').trim();
}

export function buildFinalRouterPrompt(generatedInstruction, supplement, getMessage) {
    const generated = String(generatedInstruction || '').trim();
    const cleanedSupplement = String(supplement || '').trim();

    if (!cleanedSupplement) {
        return generated;
    }

    const prefix = safeMessage(getMessage, 'routerSupplementPrefix') || '补充要求：';
    if (!generated) {
        return `${prefix}${cleanedSupplement}`;
    }

    return `${generated}\n\n${prefix}${cleanedSupplement}`;
}

export function buildRouteReferenceBlock(quoteList, currentState, getMessage) {
    const state = normalizePresetState(currentState);
    const quotes = normalizeRouterQuoteList(quoteList);

    if (state.selectedPrimaryPresetId === FOLLOWUP_PRIMARY_PRESET_ID) {
        const validation = validateFollowupRoute({
            selectedFollowupSource: state.selectedFollowupSource,
            quoteList: quotes
        });
        if (validation.errorCode) {
            return '';
        }

        const answerSection = safeMessage(getMessage, 'routerFollowupAnswerSection') || '你的上一版回答';
        const feedbackSection = safeMessage(getMessage, 'routerFollowupFeedbackSection') || '其他 AI 的评价、追问与补充';
        const lines = [];

        lines.push(`[${answerSection}]`);
        validation.answerQuotes.forEach((quote, index) => {
            if (index > 0) {
                lines.push('');
            }
            lines.push(`模型：${quote.source}`);
            lines.push(quote.text);
        });

        lines.push('');
        lines.push(`[${feedbackSection}]`);
        validation.feedbackQuotes.forEach((quote, index) => {
            if (index > 0) {
                lines.push('');
            }
            lines.push(`模型：${quote.source}`);
            lines.push(quote.text);
        });

        return lines.join('\n').trim();
    }

    return quotes
        .map((item, index) => {
            const prefix = safeMessage(getMessage, 'routeReferencePrefix')
                .replace('{0}', item.source)
                .replace('{1}', String(index + 1))
                || `参考 ${item.source} / ${index + 1}`;
            return `${prefix}\n${item.text}`;
        })
        .join('\n\n');
}

export function getFollowupEligibleSources(quoteList) {
    const quotes = normalizeRouterQuoteList(quoteList);
    const seen = new Set();
    const sources = [];

    quotes.forEach((quote) => {
        if (quote.kind === ROUTER_QUOTE_KIND.feedback) return;
        if (!quote.source || seen.has(quote.source)) return;
        seen.add(quote.source);
        sources.push(quote.source);
    });

    return sources;
}

export function validateFollowupRoute({
    selectedFollowupSource,
    quoteList
} = {}) {
    const quotes = normalizeRouterQuoteList(quoteList);
    const source = String(selectedFollowupSource || '').trim();

    if (!source) {
        return {
            errorCode: 'followup_source_required',
            answerQuotes: [],
            feedbackQuotes: []
        };
    }

    const answerQuotes = quotes.filter((quote) => (
        quote.source === source
        && quote.kind !== ROUTER_QUOTE_KIND.feedback
    ));

    if (answerQuotes.length === 0) {
        return {
            errorCode: 'followup_original_answer_required',
            answerQuotes: [],
            feedbackQuotes: []
        };
    }

    const feedbackQuotes = quotes.filter((quote) => isFollowupFeedbackQuote(quote, source));
    if (feedbackQuotes.length === 0) {
        return {
            errorCode: 'followup_feedback_required',
            answerQuotes,
            feedbackQuotes: []
        };
    }

    return {
        errorCode: null,
        answerQuotes,
        feedbackQuotes
    };
}

export function getPresetById(presetId) {
    return PRESET_MAP.get(presetId) || null;
}

export function isRespondReviewMode(state) {
    return normalizePresetState(state).selectedPrimaryPresetId === FOLLOWUP_PRIMARY_PRESET_ID;
}

export function normalizePresetState(state) {
    const primaryPresetId = PRESET_MAP.get(state?.selectedPrimaryPresetId)?.role === 'primary'
        ? state.selectedPrimaryPresetId
        : null;

    if (!primaryPresetId) {
        return createEmptyRouterPresetState();
    }

    const modifierIds = primaryPresetId === FOLLOWUP_PRIMARY_PRESET_ID
        ? []
        : Array.isArray(state?.selectedModifierPresetIds)
            ? state.selectedModifierPresetIds.filter((presetId, index, list) => (
                PRESET_MAP.get(presetId)?.role === 'modifier'
                && list.indexOf(presetId) === index
            )).slice(0, MAX_ROUTER_MODIFIERS)
            : [];

    return {
        selectedPrimaryPresetId: primaryPresetId,
        selectedModifierPresetIds: modifierIds,
        selectedFollowupSource: primaryPresetId === FOLLOWUP_PRIMARY_PRESET_ID
            ? normalizeSource(state?.selectedFollowupSource)
            : null
    };
}

export function normalizeRouterQuoteList(quoteList) {
    if (!Array.isArray(quoteList)) return [];

    return quoteList
        .map((item) => ({
            source: normalizeSource(item?.source),
            text: String(item?.text || '').trim(),
            kind: normalizeQuoteKind(item?.kind),
            targetSource: normalizeSource(item?.targetSource),
            meta: item?.meta && typeof item.meta === 'object' ? { ...item.meta } : null
        }))
        .filter((item) => item.source && item.text);
}

function buildRespondReviewInstruction(getMessage) {
    const lines = [];
    const intro = safeMessage(getMessage, 'routerRespondReviewIntro')
        || '请基于下面整理的材料完成以下任务：';
    const steps = [
        safeMessage(getMessage, 'routerRespondReviewStepRespond'),
        safeMessage(getMessage, 'routerRespondReviewStepRevise'),
        safeMessage(getMessage, 'routerRespondReviewStepSummarize')
    ].filter(Boolean);

    lines.push(intro);
    steps.forEach((step, index) => {
        lines.push(`${index + 1}. ${step}`);
    });
    return lines.join('\n').trim();
}

function isFollowupFeedbackQuote(quote, source) {
    if (!quote || !source) return false;
    if (quote.kind === ROUTER_QUOTE_KIND.feedback) {
        if (!quote.targetSource) return quote.source !== source;
        return quote.targetSource === source;
    }
    return quote.source !== source;
}

function normalizeQuoteKind(kind) {
    return Object.values(ROUTER_QUOTE_KIND).includes(kind)
        ? kind
        : ROUTER_QUOTE_KIND.generic;
}

function normalizeSource(source) {
    return String(source || '').trim();
}

function safeMessage(getMessage, key) {
    if (typeof getMessage !== 'function' || !key) {
        return '';
    }
    return String(getMessage(key) || '').trim();
}
