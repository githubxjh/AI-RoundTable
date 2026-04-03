import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
    normalizeWindowsPath
} from './playwright_env.mjs';

export const DEFAULT_CHROME_START_URLS = Object.freeze([
    'chrome://extensions/'
]);

export function buildChromeLaunchArgs({
    cdpPort,
    userDataDir,
    profileName,
    startupUrls = DEFAULT_CHROME_START_URLS
} = {}) {
    if (!cdpPort || !userDataDir || !profileName) {
        throw new Error('cdpPort, userDataDir, and profileName are required');
    }

    return [
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${userDataDir}`,
        `--profile-directory=${profileName}`,
        '--new-window',
        '--no-first-run',
        '--no-default-browser-check',
        ...startupUrls.map((item) => String(item || '').trim()).filter(Boolean)
    ];
}

export function launchChromeProcess(chromeExecutable, args) {
    const child = spawn(chromeExecutable, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
    });
    child.unref();
    return child.pid;
}

export async function waitForCdpEndpoint(endpoint, {
    timeoutMs = 15000,
    intervalMs = 500
} = {}) {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(`${trimTrailingSlash(endpoint)}/json/version`);
            if (response.ok) {
                return await response.json();
            }
            lastError = new Error(`CDP endpoint responded with HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }

        await delay(intervalMs);
    }

    throw new Error(
        `Chrome debugging endpoint is not ready at ${endpoint}. ${lastError?.message || 'No response from browser.'}`
    );
}

export function findRepoExtensionIdFromProfileData(profileData, repoRoot) {
    const settings = profileData?.extensions?.settings;
    if (!settings || typeof settings !== 'object') return null;

    const expectedPath = normalizeWindowsPath(repoRoot);
    for (const [extensionId, details] of Object.entries(settings)) {
        const extensionPath = String(details?.path || '').trim();
        if (!extensionPath) continue;
        if (normalizeWindowsPath(extensionPath) !== expectedPath) continue;

        return {
            extensionId,
            source: 'profile-settings',
            extensionPath
        };
    }

    return null;
}

export function findRepoExtensionIdInProfile({
    preferencesPath,
    securePreferencesPath,
    repoRoot
} = {}) {
    const candidates = [securePreferencesPath, preferencesPath].filter(Boolean);

    for (const filePath of candidates) {
        if (!fs.existsSync(filePath)) continue;
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const match = findRepoExtensionIdFromProfileData(parsed, repoRoot);
            if (match) {
                return {
                    ...match,
                    filePath
                };
            }
        } catch {
            // Keep looking in the next file.
        }
    }

    return null;
}

export function buildMissingExtensionMessage({
    profileName,
    repoRoot
} = {}) {
    return [
        `AI RoundTable is not loaded in Chrome profile "${profileName}".`,
        'Open chrome://extensions in that profile, enable Developer mode, and click "Load unpacked".',
        `Select: ${repoRoot}`
    ].join(' ');
}

export function buildMissingCdpMessage(endpoint) {
    return [
        `Chrome debugging endpoint is not available at ${endpoint}.`,
        'Close any running Chrome windows and start the test session with `test:chrome:launch` first.'
    ].join(' ');
}

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function delay(timeoutMs) {
    return new Promise((resolve) => {
        setTimeout(resolve, timeoutMs);
    });
}
