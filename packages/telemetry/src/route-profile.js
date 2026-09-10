// ── Route profile: funnel mapping (CONTRACT.md v1 §13a) ────────────────────
//
// The funnel stages are lit by events that carry a property: property_view
// (viewed), the same with stay dates (planning), cta_click with the stay (intent).
// A site that emits only collection-level `view` never leaves `researching`. The
// route profile is what a site fills in once so the server plane maps
// automatically; it is the same shape the edge worker reads from
// `vrm_config.bookingEngine`, moved into the package.

import { parseGuestCount, parsePromoCode, parseStayDate } from './booking-intent.js';

/**
 * @typedef {object} PropertyMatch
 * @property {string | null} [vrSlug] Kismet's slug, when the site knows it.
 * @property {string | null} [externalListingId] The site's own PMS listing id (resolved at ingest, contract 1.1).
 */

/**
 * @callback PropertyMatcher
 * @param {URL} url
 * @returns {PropertyMatch | string | null} A string is taken as `externalListingId`.
 */

/**
 * @typedef {object} PatternMatcher
 * @property {RegExp} pattern Tested against `url.pathname`; the first capture group (or named group `id`) is the identifier.
 * @property {'vrSlug' | 'externalListingId'} [as] What the captured identifier is. Default 'externalListingId'.
 */

/**
 * @typedef {object} IntentProfile
 * @property {string | RegExp} path The book-now / checkout path.
 * @property {string} [checkinParam] Default 'checkin' (also reads 'in', 'checkIn').
 * @property {string} [checkoutParam] Default 'checkout' (also reads 'out', 'checkOut').
 * @property {string} [guestsParam] Default 'guests' (also reads 'party').
 * @property {string} [propertyParam] Query name carrying the property identifier on the intent page.
 * @property {'vrSlug' | 'externalListingId'} [propertyAs] Default 'externalListingId'.
 * @property {string} [promoParam] Default 'promocode'.
 */

/**
 * @typedef {object} RouteProfile
 * @property {PropertyMatcher | PatternMatcher} [property] Which URLs are one property, and its identifier.
 * @property {(string | RegExp)[]} [searchPaths] Results pages (collection-level `view`).
 * @property {IntentProfile} [intent]
 * @property {(string | RegExp)[]} [agentSurfaces] Extra agent-surface paths; `.md`, `/llms.txt` and `/.well-known/llm-index.json` are always agent surfaces.
 * @property {(string | RegExp)[]} [exclude] Paths that are not pages at all (the adapter's own API, health checks).
 */

/**
 * @typedef {object} Classification
 * @property {'excluded' | 'agent' | 'intent' | 'property' | 'search' | 'page'} kind
 * @property {string | null} vrSlug
 * @property {string | null} externalListingId
 * @property {string | null} stayCheckIn
 * @property {string | null} stayCheckOut
 * @property {number | null} guestCount
 * @property {string | null} promoCode
 */

/** Asset extensions the server plane never records. */
export const ASSET_EXTENSION_RE =
    /\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|woff2?|ttf|otf|eot|txt|xml|json|pdf|zip|mp4|webm|mp3)$/i;

const AGENT_DEFAULTS = ['/llms.txt', '/.well-known/llm-index.json'];

/**
 * @param {string} pathname
 * @param {string | RegExp} m
 */
function pathMatches(pathname, m) {
    if (m instanceof RegExp) return m.test(pathname);
    if (m.endsWith('*')) return pathname.startsWith(m.slice(0, -1));
    return pathname === m || pathname === m.replace(/\/$/, '') || pathname.replace(/\/$/, '') === m;
}

/**
 * True when `text/markdown` is listed and outranks `text/html` (browsers never match).
 * @param {string | null | undefined} accept
 * @returns {boolean}
 */
export function prefersMarkdown(accept) {
    if (!accept || !/text\/markdown/i.test(accept)) return false;
    const q = (/** @type {string} */ type) => {
        const part = accept
            .split(',')
            .map((x) => x.trim())
            .find((x) => x.toLowerCase().startsWith(type));
        if (!part) return type === '*/*' ? 0 : -1;
        const qm = /;\s*q=([0-9.]+)/.exec(part);
        return qm ? parseFloat(qm[1]) : 1;
    };
    const md = q('text/markdown');
    const html = Math.max(q('text/html'), q('*/*'));
    return md > 0 && md > html;
}

/**
 * Read the stay off a URL under the conventional names.
 * @param {URLSearchParams} p
 * @param {IntentProfile | undefined} intent
 */
function readStay(p, intent) {
    const ci = p.get(intent?.checkinParam || 'checkin') ?? p.get('in') ?? p.get('checkIn');
    const co = p.get(intent?.checkoutParam || 'checkout') ?? p.get('out') ?? p.get('checkOut');
    const g = p.get(intent?.guestsParam || 'guests') ?? p.get('party');
    return {
        stayCheckIn: parseStayDate(ci),
        stayCheckOut: parseStayDate(co),
        guestCount: parseGuestCount(g),
        promoCode: parsePromoCode(p.get(intent?.promoParam || 'promocode')),
    };
}

/**
 * @param {PropertyMatcher | PatternMatcher | undefined} matcher
 * @param {URL} url
 * @returns {{ vrSlug: string | null, externalListingId: string | null } | null}
 */
function matchProperty(matcher, url) {
    if (!matcher) return null;
    if (typeof matcher === 'function') {
        const r = matcher(url);
        if (!r) return null;
        if (typeof r === 'string') return { vrSlug: null, externalListingId: r };
        return { vrSlug: r.vrSlug || null, externalListingId: r.externalListingId || null };
    }
    const m = matcher.pattern.exec(url.pathname);
    if (!m) return null;
    const id = (m.groups && m.groups.id) || m[1] || null;
    if (!id) return { vrSlug: null, externalListingId: null };
    return matcher.as === 'vrSlug'
        ? { vrSlug: id, externalListingId: null }
        : { vrSlug: null, externalListingId: id };
}

/**
 * Classify one request against the profile. Pure; no network.
 * @param {URL} url
 * @param {RouteProfile | null | undefined} profile
 * @param {{ accept?: string | null, method?: string }} [req]
 * @returns {Classification}
 */
export function classifyRequest(url, profile, req) {
    const p = profile || {};
    const path = url.pathname;
    /** @type {Classification} */
    const base = {
        kind: 'page',
        vrSlug: null,
        externalListingId: null,
        stayCheckIn: null,
        stayCheckOut: null,
        guestCount: null,
        promoCode: null,
    };
    if ((req?.method || 'GET').toUpperCase() !== 'GET') return { ...base, kind: 'excluded' };
    if (
        path.startsWith('/_next/') ||
        path.startsWith('/api/') ||
        path.startsWith('/wp-admin/') ||
        path.startsWith('/wp-json/')
    ) {
        return { ...base, kind: 'excluded' };
    }
    if ((p.exclude || []).some((m) => pathMatches(path, m))) return { ...base, kind: 'excluded' };

    const isAgent =
        /\.md$/i.test(path) ||
        AGENT_DEFAULTS.includes(path) ||
        (p.agentSurfaces || []).some((m) => pathMatches(path, m)) ||
        prefersMarkdown(req?.accept);
    if (isAgent) return { ...base, kind: 'agent' };

    if (ASSET_EXTENSION_RE.test(path)) return { ...base, kind: 'excluded' };

    const stay = readStay(url.searchParams, p.intent);

    if (p.intent && pathMatches(path, p.intent.path)) {
        let vrSlug = null;
        let externalListingId = null;
        if (p.intent.propertyParam) {
            const v = url.searchParams.get(p.intent.propertyParam);
            if (v && /^[\w-]{1,64}$/.test(v)) {
                if (p.intent.propertyAs === 'vrSlug') vrSlug = v;
                else externalListingId = v;
            }
        }
        return { ...base, ...stay, kind: 'intent', vrSlug, externalListingId };
    }

    // Search before property: a results path such as /stays/in/<town> can
    // collide with a loose property pattern, and the explicit list wins.
    if ((p.searchPaths || []).some((m) => pathMatches(path, m)))
        return { ...base, ...stay, kind: 'search' };

    const prop = matchProperty(p.property, url);
    if (prop) return { ...base, ...stay, kind: 'property', ...prop };

    return { ...base, ...stay };
}
