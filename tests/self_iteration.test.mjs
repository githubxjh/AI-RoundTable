import assert from 'node:assert/strict';

import {
    buildIterationSteps,
    formatIterationSummary,
    parseIterationArgs
} from '../scripts/lib/self_iteration.mjs';

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('defaults to local helper and smoke steps', () => {
    const options = parseIterationArgs([]);
    assert.equal(options.runHelpers, true);
    assert.equal(options.runSmoke, true);
    assert.equal(options.runLive, false);

    assert.deepEqual(
        buildIterationSteps(options).map((step) => step.script),
        ['test:helpers', 'test:smoke:headless']
    );
});

runTest('live model arguments select attach-mode live script', () => {
    const options = parseIterationArgs(['--live', '--models=Gemini,Doubao']);
    assert.equal(options.runLive, true);
    assert.deepEqual(options.models, ['Gemini', 'Doubao']);

    const scripts = buildIterationSteps(options);
    assert.deepEqual(scripts.at(-1), {
        label: 'live attach (Gemini, Doubao)',
        script: 'test:live',
        args: ['Gemini', 'Doubao']
    });
});

runTest('launch chrome implies live core after optional local steps', () => {
    const options = parseIterationArgs(['--launch-chrome', '--skip-smoke']);
    assert.equal(options.launchChrome, true);
    assert.equal(options.runLive, true);

    assert.deepEqual(
        buildIterationSteps(options).map((step) => step.script),
        ['test:helpers', 'test:chrome:launch', 'test:live:core']
    );
});

runTest('summary markdown records status and artifacts', () => {
    const markdown = formatIterationSummary({
        startedAt: '2026-05-22T00:00:00.000Z',
        finishedAt: '2026-05-22T00:00:01.000Z',
        status: 'passed',
        exitCode: 0,
        steps: [{
            label: 'helper tests',
            command: 'cmd /c npm.cmd run test:helpers',
            status: 'passed',
            exitCode: 0
        }],
        artifacts: ['output/playwright/iteration/last-run.json']
    });

    assert.match(markdown, /Status: passed/);
    assert.match(markdown, /helper tests/);
    assert.match(markdown, /output\/playwright\/iteration\/last-run\.json/);
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

console.log(`Completed ${passed}/${tests.length} self-iteration checks.`);
