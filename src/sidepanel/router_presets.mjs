export const MAX_ROUTER_MODIFIERS = 2;

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
        selectedModifierPresetIds: []
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
                selectedModifierPresetIds: [...baseState.selectedModifierPresetIds]
            },
            errorCode: null
        };
    }

    if (!baseState.selectedPrimaryPresetId) {
        return { nextState: baseState, errorCode: 'primary_required' };
    }

    if (baseState.selectedModifierPresetIds.includes(presetId)) {
        return {
            nextState: {
                selectedPrimaryPresetId: baseState.selectedPrimaryPresetId,
                selectedModifierPresetIds: baseState.selectedModifierPresetIds.filter((id) => id !== presetId)
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
            selectedModifierPresetIds: [...baseState.selectedModifierPresetIds, presetId]
        },
        errorCode: null
    };
}

export function buildRouterInstruction(currentState, getMessage) {
    const state = normalizePresetState(currentState);
    if (!state.selectedPrimaryPresetId) {
        return '';
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

export function getPresetById(presetId) {
    return PRESET_MAP.get(presetId) || null;
}

export function normalizePresetState(state) {
    const primaryPresetId = PRESET_MAP.get(state?.selectedPrimaryPresetId)?.role === 'primary'
        ? state.selectedPrimaryPresetId
        : null;

    const modifierIds = Array.isArray(state?.selectedModifierPresetIds)
        ? state.selectedModifierPresetIds.filter((presetId, index, list) => (
            PRESET_MAP.get(presetId)?.role === 'modifier'
            && list.indexOf(presetId) === index
        )).slice(0, MAX_ROUTER_MODIFIERS)
        : [];

    if (!primaryPresetId) {
        return createEmptyRouterPresetState();
    }

    return {
        selectedPrimaryPresetId: primaryPresetId,
        selectedModifierPresetIds: modifierIds
    };
}

function safeMessage(getMessage, key) {
    if (typeof getMessage !== 'function') {
        return '';
    }
    return String(getMessage(key) || '').trim();
}
