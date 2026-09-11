// ── Visitor resolution (CONTRACT.md v1 §5, §6) ─────────────────────────────
//
// For every page request, in order, stopping at the first match:
//   1. threaded  ?kid_sid=  → adopt verbatim; Set-Cookie if it differs; non-blocking
//                             resolve-anchor with threadedKidSid so the authority back-stitches.
//   2. cookie    _kid_sid   → adopt. No network.
//   3. suppressed           → bot UA, missing UA, or no consent: no id, no cookie, no network.
//   4. cold human           → DEFAULT: mint locally (kid_ + 8), set cookie, seed, and
//                             reconcile with proposedKidSid AFTER the response (3 s cap).
//                             OPT-IN authorityFirst: ask first (1.5 s cap, no proposed id) so
//                             the fingerprint tier can recover a session; fall back to the mint.
// Fail-open means "never null for a human", not "no id".

import { detectBot } from './bot-detect.js';
import { resolveConsent, readCountry } from './consent.js';
import { readCookie, SID_COOKIE, VID_COOKIE } from './cookies.js';
import {
    KID_SID_RE,
    buildResolveAnchorBody,
    extractClickIds,
    mintLocalKidSid,
    postResolveAnchor,
} from './identity.js';

/** What the authority adopts when WE propose: exactly eight. */
export const KID_SID_MINT_RE = /^kid_[A-Za-z0-9]{8}$/;
export const KID_VID_RE = /^(?:vid_[a-f0-9]{64}|[A-Za-z0-9_]{6,64})$/;

export const RESOLVE_TIMEOUT_MS = 1500;
export const RECONCILE_TIMEOUT_MS = 3000;

/**
 * Generic clients that are not guests either (curl, headless browsers, link
 * previews, monitors). A site suppression policy on top of the shared bot
 * vocabulary; on by default, switch off with `suppressGenericClients: false`.
 */
export const GENERIC_CLIENT_UA_RE =
    /bot|crawl|spider|slurp|fetch|scrape|curl|wget|python-requests|headless|lighthouse|pagespeed|preview|monitor|embedly|quora link preview|showyoubot|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegrambot|discordbot|anthropic-ai|yandex|semrush|ahrefs|mj12bot|dotbot|petalbot/i;

/**
 * @param {string | null | undefined} ua
 * @param {boolean} [generic] include the generic-client policy (default true)
 * @returns {boolean}
 */
export function isBotUserAgent(ua, generic = true) {
    if (!ua) return true;
    if (detectBot(ua).isBot) return true;
    return generic ? GENERIC_CLIENT_UA_RE.test(ua) : false;
}

/**
 * @param {string | null | undefined} v
 * @returns {string | null}
 */
export function validKidSid(v) {
    return typeof v === 'string' && KID_SID_RE.test(v) ? v : null;
}
/**
 * @param {string | null | undefined} v
 * @returns {string | null}
 */
export function validKidVid(v) {
    return typeof v === 'string' && KID_VID_RE.test(v) ? v : null;
}

/**
 * First hop of the visitor's address: cf-connecting-ip, x-forwarded-for, x-real-ip.
 * @param {{ get(name: string): string | null }} headers
 * @returns {string | null}
 */
export function visitorIp(headers) {
    const cf = headers.get('cf-connecting-ip');
    if (cf) return cf.trim();
    const xff = headers.get('x-forwarded-for');
    if (xff) return xff.split(',')[0]?.trim() || null;
    return headers.get('x-real-ip') || null;
}

/** @typedef {'threaded' | 'cookie' | 'authority' | 'minted' | 'suppressed'} AnchorTier */

/**
 * @typedef {object} ResolveInput
 * @property {URL} url The request URL (public form preferred; see cookies.publicUrl).
 * @property {{ get(name: string): string | null }} headers
 * @property {string} collectionSlug
 * @property {string} trackingKey The `ctk_` key. '' means resolve locally and never call the authority.
 * @property {import('./consent.js').ConsentHook | null} [consent] The site's consent hook; null means the country default.
 * @property {string | null} [country] Override for the country header read.
 * @property {boolean} [authorityFirst] Opt-in: ask the authority before responding on a cold visit (1.5 s cap).
 * @property {boolean} [suppressGenericClients] Default true.
 * @property {string | null} [resolveEndpoint] Override the authority URL.
 * @property {string | null} [apiOrigin]
 * @property {{ resolve?: number, reconcile?: number }} [timeouts]
 * @property {(p: Promise<unknown>) => void} [waitUntil] Post-response scheduler; without one the reconcile is a detached promise you can also await via `reconcile`.
 */

/**
 * @typedef {object} ResolveResult
 * @property {string | null} kidSid
 * @property {string | null} kidVid
 * @property {AnchorTier} tier
 * @property {boolean} setSid Set-Cookie `_kid_sid` on this response.
 * @property {boolean} setVid Set-Cookie `_kid_vid` on this response.
 * @property {boolean} suppressed
 * @property {boolean} isBot
 * @property {boolean} consented
 * @property {Promise<void> | null} reconcile The background authority call, if any (already scheduled on waitUntil when given).
 * @property {Record<string, unknown> | null} resolveBody The body sent (or that would be sent) to the authority, for tests and logs.
 */

/**
 * Resolve the visitor for one request. Never throws.
 * @param {ResolveInput} input
 * @returns {Promise<ResolveResult>}
 */
export async function resolveVisitor(input) {
    const { url, headers } = input;
    const ua = headers.get('user-agent');
    const cookieHeader = headers.get('cookie');
    const country = input.country !== undefined ? input.country : readCountry(headers);
    const isBot = isBotUserAgent(ua, input.suppressGenericClients !== false);
    const timeouts = {
        resolve: input.timeouts?.resolve ?? RESOLVE_TIMEOUT_MS,
        reconcile: input.timeouts?.reconcile ?? RECONCILE_TIMEOUT_MS,
    };
    const env = {
        COLLECTION_KEY: input.trackingKey || '',
        ...(input.resolveEndpoint ? { RESOLVE_ANCHOR_ENDPOINT: input.resolveEndpoint } : {}),
        ...(input.apiOrigin ? { KISMET_API_ORIGIN: input.apiOrigin } : {}),
    };

    const threaded = validKidSid(url.searchParams.get('kid_sid'));
    const cookieSid = validKidSid(readCookie(cookieHeader, SID_COOKIE));
    const cookieVid = validKidVid(readCookie(cookieHeader, VID_COOKIE));

    const signals = {
        collectionSlug: input.collectionSlug,
        origin: url.origin,
        ip: visitorIp(headers),
        userAgent: ua || null,
        acceptLanguage: headers.get('accept-language'),
        referrer: headers.get('referer'),
        clickIds: extractClickIds(url),
        landingUrl: url.toString(),
    };

    /** @type {(p: Promise<unknown>) => Promise<void>} */
    const schedule = (p) => {
        const quiet = p.then(
            () => undefined,
            () => undefined
        );
        if (typeof input.waitUntil === 'function') input.waitUntil(quiet);
        return quiet;
    };

    // Current consent is checked before any existing identity is adopted.
    const consented = isBot
        ? false
        : await resolveConsent(input.consent, { country, headers, url });
    if (isBot || !consented) {
        return {
            kidSid: null,
            kidVid: null,
            tier: 'suppressed',
            setSid: false,
            setVid: false,
            suppressed: true,
            isBot,
            consented,
            reconcile: null,
            resolveBody: null,
        };
    }

    // 1. threaded
    if (threaded && !isBot) {
        const body = buildResolveAnchorBody({
            ...signals,
            threadedKidSid: threaded,
            cookieKidSid: cookieSid,
            cookieKidVid: cookieVid,
        });
        const reconcile = env.COLLECTION_KEY
            ? schedule(postResolveAnchor(env, body, { timeoutMs: timeouts.reconcile }))
            : null;
        return {
            kidSid: threaded,
            kidVid: cookieVid,
            tier: 'threaded',
            setSid: threaded !== cookieSid,
            setVid: false,
            suppressed: false,
            isBot: false,
            consented: true,
            reconcile,
            resolveBody: body,
        };
    }

    // 2. cookie
    if (cookieSid && !isBot) {
        return {
            kidSid: cookieSid,
            kidVid: cookieVid,
            tier: 'cookie',
            setSid: false,
            setVid: false,
            suppressed: false,
            isBot: false,
            consented: true,
            reconcile: null,
            resolveBody: null,
        };
    }

    // 4. cold human
    if (input.authorityFirst && env.COLLECTION_KEY) {
        const body = buildResolveAnchorBody({ ...signals, cookieKidVid: cookieVid });
        const r = await postResolveAnchor(env, body, { timeoutMs: timeouts.resolve });
        if (r) {
            const vid = validKidVid(r.kidVid);
            return {
                kidSid: r.kidSid,
                kidVid: vid || cookieVid,
                tier: 'authority',
                setSid: true,
                setVid: !!vid && vid !== cookieVid,
                suppressed: false,
                isBot: false,
                consented: true,
                reconcile: null,
                resolveBody: body,
            };
        }
    }
    const minted = mintLocalKidSid();
    const body = buildResolveAnchorBody({
        ...signals,
        proposedKidSid: minted,
        cookieKidVid: cookieVid,
    });
    const reconcile = env.COLLECTION_KEY
        ? schedule(postResolveAnchor(env, body, { timeoutMs: timeouts.reconcile }))
        : null;
    return {
        kidSid: minted,
        kidVid: cookieVid,
        tier: 'minted',
        setSid: true,
        setVid: false,
        suppressed: false,
        isBot: false,
        consented: true,
        reconcile,
        resolveBody: body,
    };
}

/**
 * Same-origin browser follow-up only. Page middleware must not await this call.
 * Requires an explicit consent hook; geography alone does not enable recognition.
 * @param {ResolveInput} input
 * @returns {Promise<ResolveResult>}
 */
export async function resolveVisitorCookie(input) {
    const local = await resolveVisitor({
        ...input,
        trackingKey: '',
        authorityFirst: false,
        consent: input.consent || (() => false),
    });
    if (local.suppressed || !local.kidSid || !input.trackingKey) return local;
    const body = buildResolveAnchorBody({
        collectionSlug: input.collectionSlug,
        origin: input.url.origin,
        proposedKidSid: local.kidSid,
        cookieKidVid: local.kidVid,
        visitorConsent: true,
        landingUrl: input.url.toString(),
        userAgent: input.headers.get('user-agent'),
    });
    const result = await postResolveAnchor(
        {
            COLLECTION_KEY: input.trackingKey,
            ...(input.resolveEndpoint ? { RESOLVE_ANCHOR_ENDPOINT: input.resolveEndpoint } : {}),
            ...(input.apiOrigin ? { KISMET_API_ORIGIN: input.apiOrigin } : {}),
        },
        body,
        { timeoutMs: input.timeouts?.resolve ?? 1000 }
    );
    // Never change the session already used for page events.
    const vid = result?.kidSid === local.kidSid ? validKidVid(result.kidVid) : null;
    return { ...local, kidVid: vid, setVid: !!vid, resolveBody: body };
}
