#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, 'output');
const releaseRoot = path.join(outputRoot, 'public-release');
const publicRepoDir = path.join(releaseRoot, 'AI-RoundTable-public');
const userPackageDir = path.join(releaseRoot, 'AI-RoundTable-extension-test');

const publicEntries = [
    '.editorconfig',
    '.gitignore',
    '.npmrc',
    'manifest.json',
    'package.json',
    'package-lock.json',
    'TESTING.md',
    '_locales',
    'src',
    'tests',
    'scripts/init_browser_profile.mjs',
    'scripts/launch_real_chrome.mjs',
    'scripts/open_browser_profile.mjs',
    'scripts/test_live.mjs',
    'scripts/test_live_chromium.mjs',
    'scripts/test_smoke.mjs',
    'scripts/prepare_public_release.mjs',
    'scripts/lib'
];

const userPackageEntries = [
    'manifest.json',
    '_locales',
    'src/background',
    'src/content',
    'src/sidepanel',
    'src/utils/analysis_provider.mjs',
    'src/utils/attachment_capabilities.mjs',
    'src/utils/storage.js'
];

const excludedFromPublic = [
    '.git/',
    '.claude/',
    '.trae/',
    'node_modules/',
    '.npm-cache/',
    'output/',
    'reference/',
    'tools/browser-profile/',
    '*.html',
    '*_files/',
    '*.rar',
    '*.docx',
    'debug.log',
    'test-*.cmd',
    'scripts/test_attachment.mjs',
    'scripts/test_deepseek_direct.mjs',
    'PRD.md'
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
        throw new Error(`Missing required release entry: ${relativePath}`);
    }
    const target = path.join(targetRoot, relativePath);
    assertInside(targetRoot, target);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force: true });
}

async function listFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFiles(fullPath));
        } else if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
}

function hasForbiddenPath(relativePath) {
    const normalized = relativePath.split(path.sep).join('/');
    const parts = normalized.split('/');
    if (parts.includes('.git') || parts.includes('.trae') || parts.includes('node_modules')) return true;
    if (parts.includes('reference') || parts.includes('.npm-cache') || parts.includes('output')) return true;
    if (parts.includes('chrome-user-data')) return true;
    if (parts.some((part) => part.endsWith('_files'))) return true;
    if (/\.(rar|docx)$/i.test(normalized)) return true;
    if (/\.html$/i.test(normalized) && !normalized.startsWith('src/sidepanel/')) return true;
    if (/debug\.log$/i.test(normalized)) return true;
    return false;
}

async function scanReleaseTree(root) {
    const files = await listFiles(root);
    const pathFindings = [];
    const contentFindings = [];
    const secretPatterns = [
        { label: 'OpenAI-style secret key', regex: /sk-[A-Za-z0-9_-]{20,}/ },
        { label: 'personal Windows path', regex: /C:\\Users\\xiepro/i },
        { label: 'inline credential assignment', regex: /(?:api[_-]?key|token|cookie|password)\s*[:=]\s*["'][^"']{8,}["']/i }
    ];

    for (const file of files) {
        const relativePath = path.relative(root, file);
        if (hasForbiddenPath(relativePath)) {
            pathFindings.push(relativePath);
            continue;
        }
        const info = await stat(file);
        if (info.size > 2 * 1024 * 1024) {
            contentFindings.push(`${relativePath}: file is unexpectedly large`);
            continue;
        }
        const content = await readFile(file, 'utf8').catch(() => '');
        for (const pattern of secretPatterns) {
            if (pattern.regex.test(content)) {
                contentFindings.push(`${relativePath}: ${pattern.label}`);
            }
        }
    }

    return { pathFindings, contentFindings, fileCount: files.length };
}

function publicReadme() {
    return `# AI RoundTable

AI RoundTable 是一个 Chrome 扩展测试版，用来把同一个问题发送给多个 AI 页面，并在侧边栏中整理候选回答、评审和路由提示。

## 当前状态

- 当前版本仍处于小范围测试阶段，可能会遇到页面适配失效、发送状态不准或评审解析失败等问题。
- 附件上传功能还没有完全做好：部分模型可能无法带附件发送，系统会尝试降级为纯文本。
- 公开版不内置任何私有 API Key。远程评分归一化能力暂时关闭，后续会改成用户自己配置 Key 的方式。

## 支持范围

- 主要适配 Chrome / Chromium 浏览器的解压版扩展安装。
- 当前模型页面包括 ChatGPT、Grok、Gemini、Doubao、DeepSeek；Claude 入口暂未默认启用。
- 公开仓库只包含扩展源码、自动化测试和必要文档，不包含私有仓库历史、保存网页、个人文档或调试产物。

## 本地开发

\`\`\`powershell
npm.cmd install
cmd /c npm.cmd run test:helpers
cmd /c npm.cmd run test:smoke:headless
\`\`\`

如果 PowerShell 拦截 npm shim，请优先使用 \`npm.cmd\`。

## 安装测试版

1. 打开 \`chrome://extensions\`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择发布包里的 \`AI-RoundTable-extension-test\` 文件夹，或选择本仓库根目录。

## 反馈

这是第一批用户体验版。遇到问题时，请尽量说明：浏览器版本、使用的模型、问题是否带附件、页面上看到的提示。
`;
}

function userReadme() {
    return `# AI RoundTable 测试版安装说明

这是给第一批用户体验的 Chrome 解压版扩展包。

## 安装

1. 解压这个文件夹。
2. 打开 Chrome，进入 \`chrome://extensions\`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压后的 \`AI-RoundTable-extension-test\` 文件夹。

## 使用前请注意

- 当前版本仍处于小范围测试阶段，可能会遇到不稳定、页面适配失效或发送状态不准等问题。
- 附件上传功能还在测试中：部分模型可能无法带附件发送，系统会尝试降级为纯文本。
- 重要内容建议直接粘贴到问题里。
- 使用前请确认对应 AI 网站已经登录。
`;
}

function restrictedLicense() {
    return `AI RoundTable Testing Preview License

Copyright (c) 2026.

This repository is shared publicly for early testing and review only.
No permission is granted to copy, redistribute, sublicense, or sell this project
without explicit written permission from the copyright holder.
`;
}

function publicGitignore() {
    return `node_modules/
.npm-cache/
output/
tools/browser-profile/chrome-user-data/
.claude/
.trae/
.env
.env.*
*.rar
*.docx
*.html
!src/sidepanel/*.html
*_files/
debug.log
`;
}

async function writeReleaseReport(scan) {
    const report = {
        generatedAt: new Date().toISOString(),
        publicRepoDir,
        userPackageDir,
        fileCount: scan.fileCount,
        excludedFromPublic,
        notes: [
            'Git history is intentionally not copied.',
            'The generated user package excludes tests, scripts, docs, package files, cached browser profiles, and local artifacts.',
            'Run Compress-Archive on AI-RoundTable-extension-test to create the distributable zip.'
        ]
    };
    await writeFile(
        path.join(releaseRoot, 'release-report.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8'
    );
}

await mkdir(outputRoot, { recursive: true });
assertInside(outputRoot, releaseRoot);
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(publicRepoDir, { recursive: true });
await mkdir(userPackageDir, { recursive: true });

for (const entry of publicEntries) {
    await copyEntry(entry, publicRepoDir);
}

await writeFile(path.join(publicRepoDir, 'README.md'), publicReadme(), 'utf8');
await writeFile(path.join(publicRepoDir, 'LICENSE'), restrictedLicense(), 'utf8');
await writeFile(path.join(publicRepoDir, '.gitignore'), publicGitignore(), 'utf8');

for (const entry of userPackageEntries) {
    await copyEntry(entry, userPackageDir);
}
await writeFile(path.join(userPackageDir, 'README.md'), userReadme(), 'utf8');

const publicScan = await scanReleaseTree(publicRepoDir);
const userScan = await scanReleaseTree(userPackageDir);
const pathFindings = [...publicScan.pathFindings, ...userScan.pathFindings];
const contentFindings = [...publicScan.contentFindings, ...userScan.contentFindings];
if (pathFindings.length || contentFindings.length) {
    const findings = [...pathFindings, ...contentFindings].map((item) => `- ${item}`).join('\n');
    throw new Error(`Public release scan failed:\n${findings}`);
}

await writeReleaseReport({ fileCount: publicScan.fileCount + userScan.fileCount });

console.log(`Public source snapshot: ${publicRepoDir}`);
console.log(`User extension package folder: ${userPackageDir}`);
console.log(`Release report: ${path.join(releaseRoot, 'release-report.json')}`);
