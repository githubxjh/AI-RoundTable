export function collectGeminiUploadDiagnosticsFromPage() {
    const now = new Date().toISOString();
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (node) => Boolean(node && node.getClientRects && node.getClientRects().length > 0);
    const labelFor = (node) => normalizeText([
        node?.getAttribute?.('aria-label'),
        node?.getAttribute?.('title'),
        node?.innerText,
        node?.textContent
    ].join(' '));
    const describeNode = (node) => ({
        tag: node?.tagName || '',
        role: node?.getAttribute?.('role') || '',
        ariaLabel: node?.getAttribute?.('aria-label') || '',
        title: node?.getAttribute?.('title') || '',
        iconName: node?.getAttribute?.('data-mat-icon-name') || node?.querySelector?.('mat-icon')?.getAttribute?.('data-mat-icon-name') || '',
        className: String(node?.className || '').slice(0, 160),
        text: normalizeText(node?.innerText || node?.textContent).slice(0, 200),
        visible: visible(node)
    });
    const isLocalFileLabel = (label) => {
        if (/Drive|Google Drive|\u4e91\u7aef\u786c\u76d8/.test(label)) return false;
        return /Upload files?|Upload from computer|Local files?|\u4e0a\u4f20\u6587\u4ef6|\u672c\u5730\u6587\u4ef6|\u4ece\u8bbe\u5907\u4e0a\u4f20/i.test(label);
    };
    const isHistoryActionMenu = (node, label, iconName) => {
        const className = String(node?.className || '');
        return iconName === 'more_vert'
            || /gem-conversation-actions-menu-button/.test(className)
            || /\u66f4\u591a\u9009\u9879|more options/i.test(label);
    };
    const isUploadMenuLabel = (label, iconName) => {
        if (/\u4e0a\u4f20\u548c\u5de5\u5177|upload and tools|add files?|attach files?/i.test(label)) return true;
        return ['add', 'plus', 'attach_file'].includes(iconName);
    };
    const selectors = [
        'input[type="file"]',
        'button[data-test-id="local-images-files-uploader-button"]',
        'button[aria-label*="Upload"]',
        'button[aria-label*="upload"]',
        'button[aria-label*="\u4e0a\u4f20"]',
        'button[aria-label*="\u9644\u4ef6"]',
        'button[aria-label*="Attach"]',
        '[role="menuitem"]',
        '.mat-mdc-menu-item',
        '.hidden-local-file-upload-button',
        '.hidden-local-upload-button',
        '.hidden-local-file-image-selector-button',
        '[xapfileselectortrigger]',
        'mat-icon[data-mat-icon-name="add"]',
        'mat-icon[data-mat-icon-name="plus"]',
        'mat-icon[data-mat-icon-name="attach_file"]'
    ];
    const seen = new Set();
    const candidates = [];

    Array.from(document.querySelectorAll(selectors.join(','))).forEach((node) => {
        const target = node.closest?.('input[type="file"], button, [role="button"], [role="menuitem"], .mat-mdc-menu-item, [xapfileselectortrigger]')
            || node;
        if (seen.has(target)) return;
        seen.add(target);

        const label = normalizeText([labelFor(target), labelFor(node)].join(' '));
        const special = node.matches?.('.hidden-local-file-upload-button, .hidden-local-upload-button, .hidden-local-file-image-selector-button, [xapfileselectortrigger]')
            || target.matches?.('.hidden-local-file-upload-button, .hidden-local-upload-button, .hidden-local-file-image-selector-button, [xapfileselectortrigger]');
        const fileInput = target.matches?.('input[type="file"]');
        const iconName = String(node.getAttribute?.('data-mat-icon-name') || target.querySelector?.('mat-icon')?.getAttribute?.('data-mat-icon-name') || '');
        const historyAction = isHistoryActionMenu(target, label, iconName);
        const uploadMenuCandidate = !historyAction && isUploadMenuLabel(label, iconName);
        const uploadRelated = Boolean(
            !historyAction
            && (
                fileInput
                || special
                || uploadMenuCandidate
                || /Upload|upload|Attach|attachment|file|image|Drive|\u4e0a\u4f20|\u9644\u4ef6|\u6587\u4ef6|\u56fe\u7247|\u4e91\u7aef|\u672c\u5730|\u8bbe\u5907/i.test(label)
            )
        );
        if (!uploadRelated) return;

        candidates.push({
            ...describeNode(target),
            label: label.slice(0, 220),
            special: Boolean(special),
            fileInput: Boolean(fileInput),
            uploadMenuCandidate: Boolean(uploadMenuCandidate),
            localFileCandidate: Boolean(!historyAction && (isLocalFileLabel(label) || fileInput || special)),
            accept: fileInput ? String(target.getAttribute?.('accept') || '') : '',
            multiple: fileInput ? Boolean(target.multiple) : false
        });
    });

    const visibleLocalCandidates = candidates.filter((item) => item.visible && item.localFileCandidate);
    const uploadMenuCandidates = candidates.filter((item) => item.visible && item.uploadMenuCandidate);
    const hiddenTriggers = candidates.filter((item) => item.special);
    const fileInputs = candidates.filter((item) => item.fileInput);

    return {
        status: 'ok',
        kind: 'gemini_attachment_upload_dom',
        collectedAt: now,
        url: String(location.href || ''),
        title: String(document.title || '').slice(0, 160),
        counts: {
            candidates: candidates.length,
            visibleLocalCandidates: visibleLocalCandidates.length,
            uploadMenuCandidates: uploadMenuCandidates.length,
            hiddenTriggers: hiddenTriggers.length,
            fileInputs: fileInputs.length
        },
        candidates: candidates.slice(0, 30)
    };
}

export function summarizeGeminiUploadDiagnostics(diagnostics = {}) {
    const counts = diagnostics?.counts || {};
    const visibleLocal = Number(counts.visibleLocalCandidates || 0);
    const hiddenTriggers = Number(counts.hiddenTriggers || 0);
    const fileInputs = Number(counts.fileInputs || 0);
    const total = Number(counts.candidates || 0);

    if (visibleLocal > 0) {
        return `found_visible_local_upload:${visibleLocal}`;
    }
    if (hiddenTriggers > 0) {
        return `found_hidden_upload_trigger:${hiddenTriggers}`;
    }
    if (fileInputs > 0) {
        return `found_file_input:${fileInputs}`;
    }
    return `no_upload_candidate:${total}`;
}
