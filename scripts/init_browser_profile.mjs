import fs from 'node:fs';
import path from 'node:path';

import {
    assertChromePaths,
    buildTestingPaths,
    copyChromeProfile,
    getLockedProfileSourceFiles,
    isProfileCopyReady
} from './lib/playwright_env.mjs';

const force = process.argv.includes('--force');
const paths = buildTestingPaths();
const missing = assertChromePaths(paths);

if (missing.length > 0) {
    console.error(missing.join('\n'));
    process.exit(1);
}

const destinationDefaultDir = paths.automationProfileDir;
if (fs.existsSync(destinationDefaultDir) && !force) {
    if (isProfileCopyReady(paths.automationUserDataDir, paths.automationProfileName)) {
        console.log(`Persistent test profile already exists: ${paths.automationUserDataDir}`);
        console.log('Reuse it for live runs. Pass --force only when you want to rebuild it.');
        process.exit(0);
    }

    fs.rmSync(paths.automationUserDataDir, { recursive: true, force: true });
}

const lockedFiles = getLockedProfileSourceFiles(paths.profileSourceDir);
if (lockedFiles.length > 0) {
    console.error('Chrome profile source files are locked. Fully close Chrome before initializing the persistent test profile.');
    lockedFiles.forEach((filePath) => console.error(`LOCKED ${filePath}`));
    process.exit(1);
}

copyChromeProfile({
    sourceRoot: paths.chromeUserDataSource,
    sourceProfileName: paths.chromeProfileName,
    destinationRoot: paths.automationUserDataDir,
    destinationProfileName: paths.automationProfileName,
    force
});

console.log(`Initialized persistent test profile: ${paths.automationUserDataDir}`);
console.log(`Copied from Chrome profile: ${paths.profileSourceDir}`);
console.log(`Prepared automation profile directory: ${paths.automationProfileDir}`);
