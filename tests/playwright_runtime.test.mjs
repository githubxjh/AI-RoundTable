import assert from 'node:assert/strict';

let runtimeModule;

try {
    runtimeModule = await import('../scripts/lib/playwright_runtime.mjs');
} catch (error) {
    runtimeModule = { __importError: error };
}

const {
    resolveAttachedExtensionId
} = runtimeModule;

const tests = [];

function runTest(name, fn) {
    tests.push({ name, fn });
}

runTest('playwright runtime module is loadable', () => {
    assert.ok(!runtimeModule.__importError, runtimeModule.__importError?.message);
    assert.equal(typeof resolveAttachedExtensionId, 'function');
});

runTest('resolveAttachedExtensionId falls back to an existing sidepanel page', async () => {
    const extensionId = await resolveAttachedExtensionId({
        context: {
            serviceWorkers() {
                return [];
            },
            pages() {
                return [
                    {
                        url() {
                            return 'https://chatgpt.com/';
                        }
                    },
                    {
                        url() {
                            return 'chrome-extension://pdhkkaaejmcmmjclmhmldhghlfohpjii/src/sidepanel/panel.html';
                        }
                    }
                ];
            }
        },
        repoRoot: 'C:\\Users\\xiepro\\Desktop\\AI-RoundTable',
        profileName: 'Default',
        preferencesPath: 'Z:\\missing\\Preferences',
        securePreferencesPath: 'Z:\\missing\\Secure Preferences'
    });

    assert.equal(extensionId, 'pdhkkaaejmcmmjclmhmldhghlfohpjii');
});

let passed = 0;

for (const { name, fn } of tests) {
    try {
        await fn();
        passed += 1;
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        throw error;
    }
}

console.log(`Completed ${passed}/${tests.length} Playwright runtime checks.`);
