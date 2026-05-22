import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
    buildIterationHelp,
    buildIterationSteps,
    formatIterationSummary,
    parseIterationArgs
} from './lib/self_iteration.mjs';

const repoRoot = process.cwd();
const artifactDir = path.join(repoRoot, 'output', 'playwright', 'iteration');
const startedAt = new Date().toISOString();

let options;

try {
    options = parseIterationArgs(process.argv.slice(2));
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('');
    console.error(buildIterationHelp());
    process.exit(2);
}

if (options.help) {
    console.log(buildIterationHelp());
    process.exit(0);
}

const steps = buildIterationSteps(options);
const completedSteps = [];
let exitCode = 0;

for (const step of steps) {
    const result = runNpmScript(step.script, step.args);
    completedSteps.push({
        ...step,
        command: result.command,
        status: result.exitCode === 0 ? 'passed' : 'failed',
        exitCode: result.exitCode
    });

    if (result.exitCode !== 0) {
        exitCode = result.exitCode;
        break;
    }
}

const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    options,
    steps: completedSteps,
    artifacts: buildArtifactList(options)
};

fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, 'last-run.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(artifactDir, 'last-run.md'), formatIterationSummary(summary));

if (exitCode === 0) {
    console.log(`Iteration completed. Summary: ${path.join(artifactDir, 'last-run.md')}`);
} else {
    console.error(`Iteration stopped at first failing step. Summary: ${path.join(artifactDir, 'last-run.md')}`);
}

process.exit(exitCode);

function runNpmScript(scriptName, args = []) {
    const isWindows = process.platform === 'win32';
    const npmBin = isWindows ? 'npm.cmd' : 'npm';
    const command = isWindows ? 'cmd' : npmBin;
    const commandArgs = isWindows
        ? ['/c', npmBin, 'run', scriptName, ...buildNpmForwardArgs(args)]
        : ['run', scriptName, ...buildNpmForwardArgs(args)];
    const printable = [command, ...commandArgs].join(' ');

    console.log('');
    console.log(`==> ${printable}`);

    const result = spawnSync(command, commandArgs, {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit',
        shell: false
    });

    if (result.error) {
        console.error(result.error);
        return {
            command: printable,
            exitCode: 1
        };
    }

    return {
        command: printable,
        exitCode: typeof result.status === 'number' ? result.status : 1
    };
}

function buildNpmForwardArgs(args) {
    return args.length > 0 ? ['--', ...args] : [];
}

function buildArtifactList(currentOptions) {
    const artifacts = [
        'output/playwright/iteration/last-run.json',
        'output/playwright/iteration/last-run.md'
    ];

    if (currentOptions.runSmoke) {
        artifacts.push('output/playwright/smoke/smoke.log');
        artifacts.push('output/playwright/smoke/panel-smoke.png');
        artifacts.push('output/playwright/smoke/panel-smoke.html');
    }

    if (currentOptions.runLive) {
        artifacts.push('output/playwright/live/live.log');
        artifacts.push('output/playwright/live/results.json');
    }

    return artifacts;
}
