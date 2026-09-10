// ── Booking-engine intent + price-check listening (config-driven) ────────
// The profile (intentPath / priceCheckPath / param names) is written into
// vrm_config by kv-sync from Collection.metadata.bookingEngine — ICND covers
// every ICND site identically; a new partner inherits by declaring the
// type. Everything here is fail-safe: any miss/throw degrades to the normal
// proxy behavior, never to a broken response.

import { normalizePath } from './observe.js';
import { apiOrigin } from './api-origin.js';

/**
 * @typedef {object} BookingEngineProfile
 * @property {string} [type]
 * @property {string} [intentPath]
 * @property {string} [confirmPath]
 * @property {string} [priceCheckPath]
 * @property {string} [propertyParam]
 * @property {string} [propertyPathPrefix]
 * @property {string} [checkinParam]
 * @property {string} [checkoutParam]
 * @property {string} [guestsParam]
 * @property {string} [promoParam]
 */

/**
 * @typedef {object} EdgeKv
 * @property {(key: string, type?: 'json' | 'text') => Promise<any>} get
 */

/**
 * @typedef {object} BookingIntentEnv
 * @property {EdgeKv} [VRM_KV]
 * @property {string} [COLLECTION_KEY]
 * @property {string} [KISMET_API_ORIGIN]
 */

// ICND sends both MM/DD/YYYY and YYYY-MM-DD — normalize to ISO or null.
/**
 * @param {string | null | undefined} s
 * @returns {string | null}
 */
export function parseStayDate(s) {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (us) return us[3] + '-' + us[1].padStart(2, '0') + '-' + us[2].padStart(2, '0');
    return null;
}

// Party size from a ?guests-style param — bounded positive int or null.
/**
 * @param {string | null | undefined} s
 * @returns {number | null}
 */
export function parseGuestCount(s) {
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

// Promo/coupon code from a ?promocode-style param — trimmed, length-capped, or null.
/**
 * @param {string | null | undefined} s
 * @returns {string | null}
 */
export function parsePromoCode(s) {
    if (!s) return null;
    const t = String(s).trim().slice(0, 64);
    return t.length > 0 ? t : null;
}

/**
 * Checkout-intent read: on the engine's book-now page (GET w/ property+dates
 * params), resolve the engine's property id to OUR vrSlug via the property
 * page's own vrm_page entry ({prefix}{propertyID} IS the property path on
 * numeric-URL ICND sites), and parse the stay. Slug-URL ICND sites
 * never match that key — their property paths are slugs while
 * the engine id stays numeric — so fall back to the Referer: the guest reaches
 * book-now FROM the property page, whose vrm_page entry carries the vrSlug.
 *
 * Engines with NO propertyPathPrefix (HomeRunner: checkout carries ?rpid, a
 * RATE-PLAN id, and the site has no page at {prefix}{id} to key on) reach the
 * same fallback — without it they resolve nothing and every checkout lands as a
 * plain view, so the whole intent stage of the funnel is empty by construction.
 * There is no prefix to bound the referer by, so the KV entry decides: only
 * property pages carry a vrSlug, group and content pages do not.
 * The caller folds this into the page's content event as a cta_click —
 * escalating the journey option to 'clicked' (stage 'intent') WITH dates.
 * Null = not an intent navigation; fire as usual.
 * @param {BookingIntentEnv} env
 * @param {{ bookingEngine?: BookingEngineProfile }} config
 * @param {string} domain
 * @param {URL} url
 * @param {string} normalizedPath
 * @param {string} method
 * @param {string | null} referer
 * @returns {Promise<{ vrSlug: string, checkIn: string | null, checkOut: string | null } | null>}
 */
export async function resolveBookingIntent(
    env,
    config,
    domain,
    url,
    normalizedPath,
    method,
    referer
) {
    try {
        const be = config.bookingEngine;
        if (!be || !be.intentPath || method !== 'GET') return null;
        if (normalizedPath !== be.intentPath) return null;
        const propertyId = url.searchParams.get(be.propertyParam || 'propertyID');
        if (!propertyId || !/^[\w-]{1,40}$/.test(propertyId)) return null;
        const checkIn = parseStayDate(url.searchParams.get(be.checkinParam || 'checkin'));
        const checkOut = parseStayDate(url.searchParams.get(be.checkoutParam || 'checkout'));
        let vrSlug = null;
        if (be.propertyPathPrefix) {
            const mapping = await env.VRM_KV?.get(
                `vrm_page:${domain}${be.propertyPathPrefix}${propertyId}`,
                'json'
            );
            vrSlug = (mapping && mapping.vrSlug) || null;
        }
        if (!vrSlug && referer) {
            // Same-site referer under the property prefix (www-stripped like `domain`,
            // KV keys are apex-keyed). Excludes book-now self-referers (date edits).
            // Prefix-less engines skip the prefix test only — same-host and
            // not-the-intent-path still bound it, and a KV miss still degrades to
            // the plain view.
            try {
                const ref = new URL(referer);
                const refHost = ref.hostname.replace(/^www\./, '');
                const refPath = normalizePath(ref.pathname);
                const underPropertyPath = be.propertyPathPrefix
                    ? refPath.startsWith(be.propertyPathPrefix)
                    : true;
                if (refHost === domain && refPath !== be.intentPath && underPropertyPath) {
                    const mapping = await env.VRM_KV?.get(`vrm_page:${domain}${refPath}`, 'json');
                    vrSlug = (mapping && mapping.vrSlug) || null;
                }
            } catch (e) {
                /* malformed referer — fall through to the plain view */
            }
        }
        if (!vrSlug) return null; // unknown property — fire the plain view
        return { vrSlug, checkIn, checkOut };
    } catch (e) {
        return null;
    }
}

/**
 * Engine CONFIRMATION-page tee → deterministic booking bridge.
 *
 * The strongest reservation↔journey link platform-wide is the BookingBridge
 * (kid_sid ↔ confirmationCode, matched 1:1 by the PMS ingest). k.js only knows
 * the KISMET storefront's confirmation DOM, so on partner booking engines
 * (ICND book-now-confirm) no bridge ever fired and matching fell back to the
 * exact-date quote heuristic. The worker SERVES that confirmation page — so
 * read the code from the response it is already delivering and post the
 * bridge server-side.
 *
 * PRECISION OVER RECALL: extraction requires a labeled context
 * ("Confirmation/Reservation/Booking … <code>") — never bare numeric tokens.
 * A missed extraction just leaves the quote fallback (today's behavior); a
 * WRONG code would upsert a bridge that MIS-attributes someone else's
 * reservation. No match → console.log only (visible in lab + Workers Logs)
 * so the pattern can be tuned per engine without storing page content.
 *
 * PCI: reads the RESPONSE HTML the guest is already being served — never a
 * request body, never a form field (card-field-blind rule).
 * @param {{ waitUntil(promise: Promise<unknown>): void }} ctx
 * @param {BookingIntentEnv} env
 * @param {{ bookingEngine?: BookingEngineProfile }} config
 * @param {string} domain
 * @param {string} normalizedPath
 * @param {string} method
 * @param {string | null} kidSid
 * @param {Response} originResponse
 * @param {boolean} isBot
 * @returns {void}
 */
export function teeEngineConfirmation(
    ctx,
    env,
    config,
    domain,
    normalizedPath,
    method,
    kidSid,
    originResponse,
    isBot
) {
    try {
        const be = config.bookingEngine;
        if (!be || !kidSid || isBot || method !== 'GET') return;
        const confirmPath = be.confirmPath || (be.intentPath ? be.intentPath + '-confirm' : null);
        if (!confirmPath || normalizedPath !== confirmPath) return;
        if (originResponse.status !== 200) return;
        const ct = originResponse.headers.get('content-type') || '';
        if (!ct.includes('text/html')) return;
        // Clone SYNCHRONOUSLY, before the caller's HTMLRewriter consumes the body.
        const cloned = originResponse.clone();
        ctx.waitUntil(
            (async () => {
                try {
                    const html = await cloned.text();
                    const m = html.match(
                        /(?:confirmation|reservation|booking)(?:\s*(?:number|code|id|no\.?|#))?\s*(?::|#|\bis\b)?\s*(?:<[^>]{1,80}>\s*){0,4}([A-Z]{0,3}-?\d{5,12})\b/i
                    );
                    if (!m) {
                        console.log('[confirm-bridge] no labeled code on', domain + normalizedPath);
                        return;
                    }
                    /** @type {Record<string, string>} */
                    const headers = { 'Content-Type': 'application/json' };
                    if (env.COLLECTION_KEY) headers['X-Kismet-Tracking-Key'] = env.COLLECTION_KEY;
                    await fetch(`${apiOrigin(env)}/v1/booking-bridge`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            kidSid,
                            confirmationCode: m[1],
                            bookingEngine: be.type || null,
                            domain,
                        }),
                        signal: AbortSignal.timeout(2000),
                    });
                } catch (e) {
                    /* fire and forget */
                }
            })()
        );
    } catch (e) {
        /* never let the tee break the serve path */
    }
}

/**
 * Price-check tee: the engine's quote XHR (e.g. ICND POST /ajax/pricesummary)
 * carries property+dates in the REQUEST body and the quoted price in the
 * RESPONSE (an HTML fragment — Fees/Subtotal/Tax/Total). Proxy it untouched,
 * but clone both sides and persist a BookingEngineQuote keyed to the kid_sid
 * with the ACTUAL quoted total — the journey's price-check signal AND the
 * (vrSlug, dates) conversion-fallback row. Returns the origin response, or
 * null on any setup failure (caller falls back to the plain bypass fetch).
 *
 * `fetchOrigin` is the caller's origin fetch (the worker's compose-aware,
 * redirect-following one): the tee never decides where the request goes.
 * @param {{ waitUntil(promise: Promise<unknown>): void }} ctx
 * @param {BookingIntentEnv} env
 * @param {Request} request
 * @param {{ bookingEngine?: BookingEngineProfile, origin?: string | null, collectionSlug?: string | null, injectKjs?: boolean, injectSchema?: boolean }} config
 * @param {string} domain
 * @param {URL} url
 * @param {string} kidSid
 * @param {(request: Request, origin: string | null | undefined, url: URL, env: any) => Promise<Response>} fetchOrigin
 * @returns {Promise<Response | null>}
 */
export async function teePriceCheck(ctx, env, request, config, domain, url, kidSid, fetchOrigin) {
    try {
        const be = config.bookingEngine || {};
        // Respect the kill switch — paused means NO side effects, pure proxy.
        if (config.injectKjs === false && config.injectSchema === false) return null;
        const bodyText = await request.clone().text();
        const params = new URLSearchParams(bodyText);
        const propertyId = params.get(be.propertyParam || 'propertyID');
        const checkIn = parseStayDate(params.get(be.checkinParam || 'checkin'));
        const checkOut = parseStayDate(params.get(be.checkoutParam || 'checkout'));

        const res = await fetchOrigin(request, config.origin, url, env);

        let totalAmountCents = null;
        try {
            const fragment = await res.clone().text();
            // The grand total is the LAST currency amount in the fragment
            // (Fees → Subtotal → Tax → Total render in order).
            const amounts = fragment.match(/\$\s*([\d,]+(?:\.\d{2})?)/g);
            if (amounts && amounts.length) {
                const last = parseFloat(amounts[amounts.length - 1].replace(/[^0-9.]/g, ''));
                if (isFinite(last) && last > 0) totalAmountCents = Math.round(last * 100);
            }
        } catch (e) {
            /* price parse is best-effort */
        }

        let vrSlug = null;
        if (propertyId && be.propertyPathPrefix && /^[\w-]{1,40}$/.test(propertyId)) {
            const mapping = await env.VRM_KV?.get(
                `vrm_page:${domain}${be.propertyPathPrefix}${propertyId}`,
                'json'
            );
            vrSlug = (mapping && mapping.vrSlug) || null;
        }

        if (checkIn && checkOut) {
            /** @type {Record<string, string>} */
            const headers = { 'Content-Type': 'application/json' };
            if (env.COLLECTION_KEY) headers['X-Kismet-Tracking-Key'] = env.COLLECTION_KEY;
            ctx.waitUntil(
                fetch(`${apiOrigin(env)}/v1/quote-capture`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        kidSid,
                        bookingEngine: be.type || null,
                        // Raw engine id + the originating property page (Referer): the
                        // backend resolves OUR slug from pageUrl when the KV lookup above
                        // missed (engine id != page key, e.g. ICND numeric propertyID on a
                        // slug-URL site).
                        listingId: propertyId || null,
                        pageUrl: request.headers.get('referer') || null,
                        vrSlug,
                        collectionSlug: config.collectionSlug || null,
                        checkIn,
                        checkOut,
                        totalAmountCents,
                        domain,
                    }),
                    signal: AbortSignal.timeout(2000),
                }).catch(() => {
                    /* fire and forget */
                })
            );
        }

        return res;
    } catch (e) {
        return null;
    }
}
