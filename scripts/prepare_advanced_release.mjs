#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, 'output');
const releaseRoot = path.join(outputRoot, 'advanced-release');
const advancedPackageDir = path.join(releaseRoot, 'AI-RoundTable-advanced');

const packageEntries = [
    '_locales',
    'src/background',
    'src/content',
    'src/sidepanel',
    'src/utils'
];

function assertInside(parent, target) {
    const relative = path.relative(parent, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Refusing to write outside ${parent}: ${target}`);
    }
}

async function copyEntry(relativePath, targetRoot) {
    const source = path.join(repoRoot, relativePath);
    if (!existsSync(source)) {
        throw new Error(`Missing required advanced release entry: ${relativePath}`);
    }
    const target = path.join(targetRoot, relativePath);
    assertInside(targetRoot, target);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force: true });
}

function advancedReadme() {
    return `# AI RoundTable Advanced

This is the local unpacked Advanced build for attachment upload experiments.

It declares Chrome debugger and downloads permissions so it can stage selected
files under Downloads/AI-RoundTable-temp and inject them through CDP
DOM.setFileInputFiles. Load this folder only through chrome://extensions
developer mode. The Chrome Web Store Lite build remains manifest.json.

Temporary files are scheduled for cleanup after each success or failure.
`;
}

await mkdir(outputRoot, { recursive: true });
assertInside(outputRoot, releaseRoot);
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(advancedPackageDir, { recursive: true });

await cp(
    path.join(repoRoot, 'manifest.advanced.json'),
    path.join(advancedPackageDir, 'manifest.json'),
    { force: true }
);

for (const entry of packageEntries) {
    await copyEntry(entry, advancedPackageDir);
}

await writeFile(path.join(advancedPackageDir, 'README.md'), advancedReadme(), 'utf8');
await writeFile(
    path.join(releaseRoot, 'release-report.json'),
    `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        advancedPackageDir,
        notes: [
            'Advanced is for local unpacked/developer-mode use.',
            'The package manifest is copied from manifest.advanced.json.',
            'The Lite Chrome Web Store manifest remains manifest.json.'
        ]
    }, null, 2)}\n`,
    'utf8'
);

console.log(`Advanced extension package folder: ${advancedPackageDir}`);
console.log(`Release report: ${path.join(releaseRoot, 'release-report.json')}`);
