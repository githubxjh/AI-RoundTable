import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_CHROME_EXECUTABLE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEFAULT_CDP_PORT = 9222;
const DEFAULT_CHROME_PROFILE_NAME = 'Default';
const DEFAULT_AUTOMATION_PROFILE_NAME = 'Default';
const PROFILE_CACHE_BLOCKLIST = [
    'cache',
    'cache_data',
    'code cache',
    'gpucache',
    'dawncache',
    'grshadercache',
    'graphitecache',
    path.join('service worker', 'cachestorage'),
    path.join('service worker', 'scriptcache'),
    'blob_storage',
    'shadercache',
    'crashpad',
    path.join('default', 'extensions'),
    path.join('default', 'extension state'),
    path.join('default', 'extension scripts'),
    path.join('default', 'extension rules'),
    path.join('default', 'local extension settings'),
    path.join('default', 'sync extension settings'),
    path.join('default', 'extension cookies')
];

export function buildTestingPaths({ repoRoot = process.cwd(), env = process.env } = {}) {
    const resolvedRepoRoot = path.resolve(repoRoot);
    const automationBrowserChannel = String(env.AI_RT_PLAYWRIGHT_CHANNEL || 'chromium').trim() || 'chromium';
    const chromeExecutable = resolvePathLike(
        env.AI_RT_CHROME_EXE,
        DEFAULT_CHROME_EXECUTABLE,
        resolvedRepoRoot
    );
    const chromeUserDataSource = resolvePathLike(
        env.AI_RT_CHROME_USER_DATA_SOURCE,
        path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
        resolvedRepoRoot
    );
    const chromeProfileName = String(env.AI_RT_CHROME_PROFILE_NAME || DEFAULT_CHROME_PROFILE_NAME).trim()
        || DEFAULT_CHROME_PROFILE_NAME;
    const chromeProfileDir = path.join(chromeUserDataSource, chromeProfileName);
    const automationUserDataDir = resolvePathLike(
        env.AI_RT_TEST_PROFILE_DIR,
        path.join(resolvedRepoRoot, 'tools', 'browser-profile', 'chrome-user-data'),
        resolvedRepoRoot
    );
    const automationProfileName = DEFAULT_AUTOMATION_PROFILE_NAME;
    const automationProfileDir = path.join(automationUserDataDir, automationProfileName);
    const artifactDir = path.join(resolvedRepoRoot, 'output', 'playwright');
    const cdpPort = normalizeCdpPort(env.AI_RT_CDP_PORT, DEFAULT_CDP_PORT);

    return {
        repoRoot: resolvedRepoRoot,
        extensionPath: resolvedRepoRoot,
        automationBrowserChannel,
        chromeExecutable,
        chromeUserDataSource,
        chromeProfileName,
        chromeProfileDir,
        profileSourceDir: chromeProfileDir,
        chromePreferencesPath: path.join(chromeProfileDir, 'Preferences'),
        chromeSecurePreferencesPath: path.join(chromeProfileDir, 'Secure Preferences'),
        automationUserDataDir,
        automationProfileName,
        automationProfileDir,
        automationPreferencesPath: path.join(automationProfileDir, 'Preferences'),
        automationSecurePreferencesPath: path.join(automationProfileDir, 'Secure Preferences'),
        smokeUserDataDir: path.join(artifactDir, 'smoke-user-data'),
        artifactDir,
        cdpPort,
        cdpEndpoint: `http://127.0.0.1:${cdpPort}`
    };
}

export function buildExtensionLaunchArgs(extensionPath) {
    const resolvedExtensionPath = path.resolve(extensionPath);
    return [
        `--disable-extensions-except=${resolvedExtensionPath}`,
        `--load-extension=${resolvedExtensionPath}`
    ];
}

export function shouldCopyProfileEntry(relativePath) {
    const normalized = normalizeProfileRelativePath(relativePath);
    if (!normalized) return false;

    return !PROFILE_CACHE_BLOCKLIST.some((fragment) => {
        const blocked = normalizeProfileRelativePath(fragment);
        return normalized === blocked
            || normalized.startsWith(`${blocked}/`)
            || normalized.includes(`/${blocked}/`);
    });
}

export function ensureDir(targetPath) {
    fs.mkdirSync(targetPath, { recursive: true });
}

export function resetDir(targetPath) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    fs.mkdirSync(targetPath, { recursive: true });
}

export function copyChromeProfile({
    sourceRoot,
    sourceProfileName = DEFAULT_CHROME_PROFILE_NAME,
    destinationRoot,
    destinationProfileName = DEFAULT_AUTOMATION_PROFILE_NAME,
    force = false
} = {}) {
    if (!sourceRoot || !destinationRoot) {
        throw new Error('sourceRoot and destinationRoot are required');
    }

    if (force) {
        fs.rmSync(destinationRoot, { recursive: true, force: true });
    }
    ensureDir(destinationRoot);

    const rootEntriesToCopy = ['Local State', 'Last Version', 'First Run'];
    for (const entry of rootEntriesToCopy) {
        const sourcePath = path.join(sourceRoot, entry);
        if (fs.existsSync(sourcePath)) {
            const destinationPath = path.join(destinationRoot, entry);
            copyFileOrDirectory(sourcePath, destinationPath, entry);
        }
    }

    const sourceProfileDir = path.join(sourceRoot, sourceProfileName);
    const destinationProfileDir = path.join(destinationRoot, destinationProfileName);
    ensureDir(destinationProfileDir);

    copyDirectoryFiltered(sourceProfileDir, destinationProfileDir, destinationProfileName);
}

export function assertChromePaths(paths) {
    const missing = [];
    if (!fs.existsSync(paths.chromeExecutable)) {
        missing.push(`Chrome executable not found: ${paths.chromeExecutable}`);
    }
    if (!fs.existsSync(paths.chromeUserDataSource)) {
        missing.push(`Chrome user data root not found: ${paths.chromeUserDataSource}`);
    }
    if (!fs.existsSync(paths.chromeProfileDir)) {
        missing.push(`Chrome profile directory not found: ${paths.chromeProfileDir}`);
    }
    return missing;
}

export function isChromeRunning() {
    try {
        const output = execFileSync(
            'tasklist',
            ['/FI', 'IMAGENAME eq chrome.exe', '/FO', 'CSV', '/NH'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        );
        return output.toLowerCase().includes('chrome.exe');
    } catch {
        return false;
    }
}

export function getLockedProfileSourceFiles(profileDir) {
    const probePaths = [
        path.join(profileDir, 'Network', 'Cookies'),
        path.join(profileDir, 'Cookies'),
        path.join(profileDir, 'Web Data'),
        path.join(profileDir, 'History'),
        path.join(profileDir, 'Login Data')
    ];

    return probePaths.filter((probePath) => {
        if (!fs.existsSync(probePath)) {
            return false;
        }
        try {
            const descriptor = fs.openSync(probePath, 'r');
            fs.closeSync(descriptor);
            return false;
        } catch (error) {
            return error?.code === 'EBUSY' || error?.code === 'EPERM';
        }
    });
}

export function isProfileCopyReady(profileRoot, profileName = DEFAULT_AUTOMATION_PROFILE_NAME) {
    const profileDir = path.join(profileRoot, profileName);
    const expected = [
        path.join(profileRoot, 'Local State'),
        profileDir,
        path.join(profileDir, 'Preferences')
    ];

    const criticalUserData = [
        path.join(profileDir, 'Network', 'Cookies'),
        path.join(profileDir, 'Cookies'),
        path.join(profileDir, 'Login Data')
    ];

    return expected.every((targetPath) => fs.existsSync(targetPath))
        && criticalUserData.some((targetPath) => fs.existsSync(targetPath));
}

export function getExtensionPageUrl(extensionId, relativePath = 'src/sidepanel/panel.html') {
    return `chrome-extension://${extensionId}/${relativePath}`;
}

export function normalizeProfileRelativePath(relativePath) {
    return String(relativePath || '')
        .replaceAll('\\', '/')
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase();
}

export function normalizeWindowsPath(targetPath) {
    return path.resolve(String(targetPath || ''))
        .replaceAll('\\', '/')
        .toLowerCase();
}

export function normalizeCdpPort(explicitValue, fallbackValue = DEFAULT_CDP_PORT) {
    const raw = String(explicitValue ?? fallbackValue).trim();
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        return fallbackValue;
    }
    return parsed;
}

function resolvePathLike(explicitValue, fallbackValue, repoRoot) {
    const chosen = String(explicitValue || fallbackValue || '').trim();
    if (!chosen) return '';
    if (path.isAbsolute(chosen)) {
        return path.normalize(chosen);
    }
    return path.resolve(repoRoot, chosen);
}

function copyFileOrDirectory(sourcePath, destinationPath, relativePath) {
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
        ensureDir(destinationPath);
        copyDirectoryFiltered(sourcePath, destinationPath, relativePath);
        return;
    }
    ensureDir(path.dirname(destinationPath));
    fs.copyFileSync(sourcePath, destinationPath);
}

function copyDirectoryFiltered(sourceDir, destinationDir, relativeBase) {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
        const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
        if (!shouldCopyProfileEntry(relativePath)) {
            continue;
        }

        const sourcePath = path.join(sourceDir, entry.name);
        const destinationPath = path.join(destinationDir, entry.name);
        if (entry.isDirectory()) {
            ensureDir(destinationPath);
            copyDirectoryFiltered(sourcePath, destinationPath, relativePath);
            continue;
        }

        ensureDir(path.dirname(destinationPath));
        fs.copyFileSync(sourcePath, destinationPath);
    }
}
