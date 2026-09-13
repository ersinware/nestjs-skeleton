/**
 * @file html-escape.util.ts
 * @description Encodes dynamic email values for HTML text and quoted attributes.
 */

/**
 * Escapes raw values at HTML interpolation boundaries; URLs still require trusted schemes
 * and URL component encoding before HTML escaping. Never pass a complete HTML body.
 *
 * @param value The raw text or completed URL to embed in HTML.
 * @returns HTML-safe text for element content or quoted attributes, not scripts or styles.
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
