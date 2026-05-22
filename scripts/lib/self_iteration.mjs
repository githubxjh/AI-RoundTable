export const DEFAULT_ITERATION_MODELS = Object.freeze(['Gemini', 'Doubao', 'Grok', 'DeepSeek']);
export const KNOWN_MODELS = Object.freeze(['ChatGPT', 'Grok', 'Gemini', 'Doubao', 'DeepSeek', 'Claude']);

export function parseIterationArgs(argv = []) {
    const options = {
        help: false,
        runHelpers: true,
        runSmoke: true,
        runLive: false,
        launchChrome: false,
        models: []
    };

    for (const rawArg of argv) {
        const arg = String(rawArg || '').trim();
        if (!arg) continue;

        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--live') {
            options.runLive = true;
            continue;
        }
        if (arg === '--local-only') {
            options.runLive = false;
            options.launchChrome = false;
            continue;
        }
        if (arg === '--launch-chrome') {
            options.launchChrome = true;
            options.runLive = true;
            continue;
        }
        if (arg === '--skip-helpers') {
            options.runHelpers = false;
            continue;
        }
        if (arg === '--skip-smoke') {
            options.runSmoke = false;
            continue;
        }
        if (arg.startsWith('--models=')) {
            options.models.push(...splitModels(arg.slice('--models='.length)));
            options.runLive = true;
            continue;
        }
        if (arg.startsWith('--')) {
            throw new Error(`Unknown iterate option: ${arg}`);
        }

        options.models.push(arg);
        options.runLive = true;
    }

    options.models = normalizeModels(options.models);
    return options;
}

export function buildIterationSteps(options) {
    const steps = [];

    if (options.runHelpers) {
        steps.push({
            label: 'helper tests',
            script: 'test:helpers',
            args: []
        });
    }

    if (options.runSmoke) {
        steps.push({
            label: 'headless smoke',
            script: 'test:smoke:headless',
            args: []
        });
    }

    if (options.launchChrome) {
        steps.push({
            label: 'launch real Chrome attach session',
            script: 'test:chrome:launch',
            args: []
        });
    }

    if (options.runLive) {
        if (options.models.length > 0) {
            steps.push({
                label: `live attach (${options.models.join(', ')})`,
                script: 'test:live',
                args: options.models
            });
        } else {
            steps.push({
                label: `live attach (${DEFAULT_ITERATION_MODELS.join(', ')})`,
                script: 'test:live:core',
                args: []
            });
        }
    }

    return steps;
}

export function buildIterationHelp() {
    return [
        'AI-RoundTable self-iteration runner',
        '',
        'Usage:',
        '  npm.cmd run iterate',
        '  npm.cmd run iterate -- --live',
        '  npm.cmd run iterate -- --live --models=Gemini,Doubao',
        '  npm.cmd run iterate -- --launch-chrome',
        '',
        'Options:',
        '  --live            Include real Chrome attach-mode live tests.',
        '  --launch-chrome   Start the dedicated attach Chrome session before live tests.',
        '  --models=A,B      Limit live tests to specific models.',
        '  --skip-helpers    Skip Node helper tests.',
        '  --skip-smoke      Skip headless smoke test.',
        '  --local-only      Disable live tests even if earlier flags enabled them.',
        '  --help            Show this help.'
    ].join('\n');
}

export function formatIterationSummary(summary) {
    const lines = [
        '# AI-RoundTable Iteration Run',
        '',
        `- Started: ${summary.startedAt}`,
        `- Finished: ${summary.finishedAt}`,
        `- Status: ${summary.status}`,
        `- Exit code: ${summary.exitCode}`,
        ''
    ];

    lines.push('## Steps', '');
    for (const step of summary.steps) {
        lines.push(`- ${step.status}: ${step.label} (${step.command})`);
        if (typeof step.exitCode === 'number') {
            lines.push(`  - exitCode: ${step.exitCode}`);
        }
    }

    lines.push('', '## Evidence', '');
    for (const artifact of summary.artifacts) {
        lines.push(`- ${artifact}`);
    }

    return `${lines.join('\n')}\n`;
}

export function splitModels(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

export function normalizeModels(models) {
    const requested = new Set(
        models
            .map((model) => String(model || '').trim())
            .filter(Boolean)
    );

    return KNOWN_MODELS.filter((model) => requested.has(model));
}
