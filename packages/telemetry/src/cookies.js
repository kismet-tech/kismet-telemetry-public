// ── Cookies (CONTRACT.md v1 §4) ────────────────────────────────────────────
//
// `_kid_sid` 90 days, `_kid_vid` about 400 days. Path=/; SameSite=Lax; Secure on
// HTTPS; NOT HttpOnly (k.js reads them through document.cookie). Domain rule: the
// dotted serving domain (host minus a leading `www.` and any port) so a session
// survives www ↔ apex and a WordPress root ↔ a Next.js app on the same host.
// Host-only (no Domain attribute) only for single-label hosts and IPs, which
// browsers reject a Domain= on.

export const SID_COOKIE = '_kid_sid';
export const VID_COOKIE = '_kid_vid';
/** 90 days, the session cookie. */
export const SID_MAX_AGE = 90 * 24 * 60 * 60;
/** About 400 days, the visitor cookie (only ever echoed by the authority). */
export const VID_MAX_AGE = 400 * 24 * 60 * 60;

/**
 * The cookie Domain attribute value for a request host: `.example.com`, or ''
 * (host-only) for single-label hosts and IP addresses. `override` wins when given
 * (a site whose registrable domain is deeper than its serving host).
 * @param {string} host Request host, may carry a port.
 * @param {string | null} [override] e.g. '.example.com'
 * @returns {string} '' means "omit the Domain attribute".
 */
export function cookieDomainFor(host, override) {
    if (override) return override.startsWith('.') ? override : '.' + override;
    let h = (host || '').toLowerCase().replace(/^www\./, '');
    // Strip a port, but not the colons of an IPv6 literal.
    if (!h.startsWith('[')) h = h.replace(/:\d+$/, '');
    if (!h || !h.includes('.') || h.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return '';
    return '.' + h;
}

/**
 * Build one Set-Cookie header value per the contract. Never HttpOnly.
 * @param {string} name
 * @param {string} value
 * @param {{ maxAge: number, domain: string, secure: boolean }} attrs `domain` '' omits the attribute.
 * @returns {string}
 */
export function buildCookie(name, value, attrs) {
    const parts = [`${name}=${value}`];
    if (attrs.domain) parts.push(`Domain=${attrs.domain}`);
    parts.push('Path=/', `Max-Age=${attrs.maxAge}`, 'SameSite=Lax');
    if (attrs.secure) parts.push('Secure');
    return parts.join('; ');
}

/**
 * Read one cookie off a raw Cookie header.
 * @param {string | null | undefined} cookieHeader
 * @param {string} name
 * @returns {string | null}
 */
export function readCookie(cookieHeader, name) {
    if (!cookieHeader) return null;
    const esc = name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&');
    const m = cookieHeader.match(new RegExp('(?:^|;\\s*)' + esc + '=([^;]+)'));
    return m ? m[1] : null;
}

/**
 * Whether the request arrived over HTTPS, honouring a proxy's forwarded proto.
 * @param {{ get(name: string): string | null }} headers
 * @param {URL} url
 * @returns {boolean}
 */
export function isHttps(headers, url) {
    const fwd = headers.get('x-forwarded-proto');
    const proto = (fwd ? fwd.split(',')[0] : url.protocol.replace(':', '')).trim();
    return proto === 'https';
}

/**
 * The public request URL as the visitor saw it: scheme and host rebuilt from the
 * forwarded headers when the server sits behind a proxy (Cloud Run, a load
 * balancer, WP Engine's edge), else the URL as given.
 * @param {{ get(name: string): string | null }} headers
 * @param {URL} url
 * @returns {URL}
 */
export function publicUrl(headers, url) {
    const host = (headers.get('x-forwarded-host') || headers.get('host') || url.host)
        .split(',')[0]
        .trim();
    const proto = (headers.get('x-forwarded-proto') || url.protocol.replace(':', ''))
        .split(',')[0]
        .trim();
    return new URL(`${proto}://${host}${url.pathname}${url.search}`);
}
