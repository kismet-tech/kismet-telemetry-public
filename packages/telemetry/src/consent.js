// ── Consent (CONTRACT.md v1 §4) ────────────────────────────────────────────
//
// An adapter MUST NOT set a session cookie, mint, or resolve for a visitor in a
// cookie-consent jurisdiction unless the site has signalled consent. The DEFAULT
// decision is a country deny list read from the platform's country header. That
// default denies missing or unknown geography. The site consent hook can
// explicitly grant consent, including on Apache/Azure without country headers.

/** EU 27 + EEA (IS, LI, NO) + GB + CH: cookies need consent here. */
export const COOKIE_CONSENT_DENY = new Set([
    'AT',
    'BE',
    'BG',
    'HR',
    'CY',
    'CZ',
    'DK',
    'EE',
    'FI',
    'FR',
    'DE',
    'GR',
    'HU',
    'IE',
    'IT',
    'LV',
    'LT',
    'LU',
    'MT',
    'NL',
    'PL',
    'PT',
    'RO',
    'SK',
    'SI',
    'ES',
    'SE',
    'IS',
    'LI',
    'NO',
    'GB',
    'CH',
]);

/**
 * The default gate: unknown country (missing, invalid, XX, T1) is denied; a listed
 * country is denied.
 * @param {string | null | undefined} country ISO-3166 alpha-2, any case.
 * @returns {boolean}
 */
export function countryAllowsCookies(country) {
    const c = (country || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'ZZ') return false;
    return !COOKIE_CONSENT_DENY.has(c);
}

/**
 * Read the visitor's country from the platform headers adapters see:
 * Cloudflare `cf-ipcountry`, Vercel `x-vercel-ip-country`. Null when absent
 * (a bare Cloud Run / Apache / Azure hop), which the default gate treats as denied.
 * @param {{ get(name: string): string | null }} headers
 * @returns {string | null}
 */
export function readCountry(headers) {
    return headers.get('cf-ipcountry') || headers.get('x-vercel-ip-country') || null;
}

/**
 * @typedef {object} ConsentContext
 * @property {string | null} country
 * @property {{ get(name: string): string | null }} headers The visitor's request headers (read the CMP cookie off `cookie`).
 * @property {URL} url
 */

/**
 * @callback ConsentHook
 * @param {ConsentContext} ctx
 * @returns {boolean | Promise<boolean>} true when this visitor may carry a session.
 */

/**
 * Resolve whether this visitor may have a session. With a hook, the hook decides
 * (a throw or a non-boolean is treated as "no consent", fail-closed). Without one,
 * the country default applies.
 * @param {ConsentHook | null | undefined} hook
 * @param {ConsentContext} ctx
 * @returns {Promise<boolean>}
 */
export async function resolveConsent(hook, ctx) {
    if (!hook) return countryAllowsCookies(ctx.country);
    try {
        const v = await hook(ctx);
        return v === true;
    } catch {
        return false;
    }
}

/**
 * A ready-made hook for sites whose consent manager writes a cookie: consent is
 * granted when `cookieName` is present and (if given) matches `pattern`.
 * @param {string} cookieName e.g. 'CookieConsent', 'cmplz_statistics', 'cookieyes-consent'
 * @param {RegExp} [pattern] e.g. /statistics:true/ ; omitted means presence is enough
 * @returns {ConsentHook}
 */
export function consentFromCookie(cookieName, pattern) {
    const esc = cookieName.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&');
    const re = new RegExp('(?:^|;\\s*)' + esc + '=([^;]*)');
    return (ctx) => {
        const m = (ctx.headers.get('cookie') || '').match(re);
        if (!m) return false;
        if (!pattern) return true;
        try {
            return pattern.test(decodeURIComponent(m[1]));
        } catch {
            return pattern.test(m[1]);
        }
    };
}
