import assert from 'node:assert/strict';

import {
    DEFAULT_ANALYSIS_PROVIDER,
    buildAnalysisProviderEndpoint,
    buildAnalysisProviderOriginPattern,
    buildOpenAICompatibleAnalysisRequest,
    normalizeAnalysisProviderConfig,
    parseOpenAICompatibleAnalysisContent
} from '../src/utils/analysis_provider.mjs';
import { mergeSettings } from '../src/utils/storage.js';

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('storage settings merge adds default analysis provider without clobbering old settings', () => {
    const merged = mergeSettings({
        reviewMode: 'discussion'
    });

    assert.equal(merged.reviewMode, 'discussion');
    assert.deepEqual(merged.analysisProvider, DEFAULT_ANALYSIS_PROVIDER);
});

runTest('storage settings merge preserves existing analysis provider configuration', () => {
    const apiKey = ['keep', 'local'].join('-');
    const merged = mergeSettings({
        analysisProvider: {
            enabled: true,
            name: 'Custom',
            baseUrl: 'https://example.com/v1/',
            apiKey,
            model: 'custom-json-model',
            thinkingMode: 'omit',
            reasoningEffort: 'medium',
            timeoutMs: 30000,
            responseFormatJson: false
        }
    });

    assert.equal(merged.analysisProvider.enabled, true);
    assert.equal(merged.analysisProvider.baseUrl, 'https://example.com/v1');
    assert.equal(merged.analysisProvider.apiKey, apiKey);
    assert.equal(merged.analysisProvider.model, 'custom-json-model');
    assert.equal(merged.analysisProvider.thinkingMode, 'omit');
    assert.equal(merged.analysisProvider.reasoningEffort, 'medium');
    assert.equal(merged.analysisProvider.timeoutMs, 30000);
    assert.equal(merged.analysisProvider.responseFormatJson, false);
});

runTest('DeepSeek default request uses the current V4 flash model and JSON response mode', () => {
    const apiKey = ['unit', 'local'].join('-');
    const provider = normalizeAnalysisProviderConfig({
        enabled: true,
        apiKey
    });
    const request = buildOpenAICompatibleAnalysisRequest(provider, [
        { role: 'user', content: 'Return JSON.' }
    ]);

    assert.equal(request.ok, true);
    assert.equal(buildAnalysisProviderEndpoint(provider), 'https://api.deepseek.com/chat/completions');
    assert.equal(buildAnalysisProviderOriginPattern(provider), 'https://api.deepseek.com/*');
    assert.equal(request.body.model, 'deepseek-v4-flash');
    assert.deepEqual(request.body.response_format, { type: 'json_object' });
    assert.deepEqual(request.body.thinking, { type: 'disabled' });
    assert.equal(request.body.reasoning_effort, undefined);
    assert.equal(request.requestInit.headers.Authorization, `Bearer ${apiKey}`);
});

runTest('thinking mode can be enabled with reasoning effort for compatible providers', () => {
    const provider = normalizeAnalysisProviderConfig({
        enabled: true,
        apiKey: ['unit', 'local'].join('-'),
        thinkingMode: 'enabled',
        reasoningEffort: 'high'
    });
    const request = buildOpenAICompatibleAnalysisRequest(provider, [
        { role: 'user', content: 'Return JSON.' }
    ]);

    assert.equal(request.ok, true);
    assert.deepEqual(request.body.thinking, { type: 'enabled' });
    assert.equal(request.body.reasoning_effort, 'high');
});

runTest('OpenAI-compatible response parser extracts choices[0].message.content', () => {
    const parsed = parseOpenAICompatibleAnalysisContent({
        choices: [
            { message: { content: '{"ok":true}' } }
        ]
    });

    assert.deepEqual(parsed, { ok: true, content: '{"ok":true}' });
});

runTest('OpenAI-compatible response parser returns a Chinese-facing error code for missing content', () => {
    const parsed = parseOpenAICompatibleAnalysisContent({ choices: [] });

    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, 'analysis_provider_missing_content');
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

console.log(`Completed ${passed}/${tests.length} analysis provider checks.`);
