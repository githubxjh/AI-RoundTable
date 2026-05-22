export function t(key, fallback = '', substitutions = []) {
    const resolvedFallback = String(fallback || key || '').trim();
    const raw = globalThis.chrome?.i18n?.getMessage?.(key);
    const template = String(raw || resolvedFallback);

    return formatTemplate(template, substitutions);
}

export function applyI18n(root = document) {
    if (!root?.querySelectorAll) return;

    root.querySelectorAll('[data-i18n]').forEach((node) => {
        const key = node.getAttribute('data-i18n');
        if (!key) return;
        node.textContent = t(key, node.textContent || '');
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
        const key = node.getAttribute('data-i18n-placeholder');
        if (!key) return;
        node.setAttribute('placeholder', t(key, node.getAttribute('placeholder') || ''));
    });

    root.querySelectorAll('[data-i18n-title]').forEach((node) => {
        const key = node.getAttribute('data-i18n-title');
        if (!key) return;
        node.setAttribute('title', t(key, node.getAttribute('title') || ''));
    });
}

function formatTemplate(template, substitutions) {
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    return values.reduce(
        (result, value, index) => result.replaceAll(`{${index}}`, String(value ?? '')),
        template
    );
}
