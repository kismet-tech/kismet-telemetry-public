// ── Content event tracking ──────────────────────────────────────────────
//
// The ONE server-side content-event payload builder in the estate. Every edge
// emitter (the injection worker in full and observe mode, kismet.travel middleware,
// Kismet-built sites' middleware) builds its POST body here. Ingest
// (POST /v1/content-events, content-event.service.ts) stays the classification and
// persistence authority; this module only decides what an emitter says.

import { detectBot } from './bot-detect.js';

/** The kismet.travel relay; ingest-direct emitters override with TRACKING_ENDPOINT. */
export const DEFAULT_TRACKING_ENDPOINT = 'https://kismet.travel/api/track';

/** The beacon rides ctx.waitUntil; 2s bounds a stuck relay so it can never pile up. */
export const CONTENT_EVENT_TIMEOUT_MS = 2000;

/**
 * Apex serving domain from a Host header or hostname: no `www.`, no port. Every
 * `tracking_mode='server'` row is keyed on this form (partner
 * rows are all apex today); kismet.travel's `'kismet'` rows keep the host they were
 * served on and pass `servingDomain` explicitly.
 * @param {string} hostHeaderOrHostname
 * @returns {string}
 */
export function normalizeServingDomain(hostHeaderOrHostname) {
    return hostHeaderOrHostname.replace(/^www\./, '').split(':')[0];
}

/**
 * @typedef {'server' | 'kismet'} ServerTrackingMode
 */

/**
 * @typedef {object} ContentEventInput
 * @property {ServerTrackingMode} [trackingMode] Default 'server' (the worker, Kismet-built sites); kismet.travel middleware passes 'kismet'.
 * @property {string} pageUrl
 * @property {string} domain The serving domain, already normalized by the caller (normalizeServingDomain for apex emitters).
 * @property {string | null | undefined} collectionSlug
 * @property {string | null | undefined} vrSlug Sets vacationRentalSlug and makes the event a content_vr property_view.
 * @property {boolean} [propertyPage] Route-table classifiers (kismet.travel WL routes) can mark a property page without a slug; the worker never sets this.
 * @property {string | null} [groupSlug] kismet.travel WL group pages; emitted only when provided.
 * @property {string | null | undefined} userAgent
 * @property {import('./bot-detect.js').BotDetection} [bot] Caller-computed bot verdict (kismet.travel's generic-substring fallback); default detectBot(userAgent).
 * @property {string | null} [clientIp] Raw visitor address (cf-connecting-ip). Emitted as `clientIp` when provided (worker call sites always pass it, null when absent).
 * @property {string | null} [metaClientIp] Public-gated visitor address for ingest-direct emitters (kismet.travel). Emitted when provided.
 * @property {string | null | undefined} country
 * @property {string | null} [city] Cloudflare edge geo; emitted when provided.
 * @property {string | null} [region]
 * @property {string | null | undefined} referrer
 * @property {string | null} [referrerSource] kismet.travel: the session's kid_src.
 * @property {string | null} [utmSource]
 * @property {string | null} [utmMedium]
 * @property {string | null} [utmCampaign]
 * @property {string | null} [utmContent]
 * @property {string} [exposureDepth]
 * @property {string | null | undefined} clientSessionId
 * @property {boolean} [agentFetch] Agent-surface serve (.md / llms.txt / observe .txt .xml .json .md): actionType 'fetch'.
 * @property {boolean} [ctaIntent] Booking-engine intent page: actionType 'cta_click'.
 * @property {string | null} [stayCheckIn] ISO date (parseStayDate); omitted when empty.
 * @property {string | null} [stayCheckOut]
 * @property {number | null} [guestCount]
 * @property {string | null} [promoCode]
 * @property {number | null} [responseStatus]
 * @property {number} [responseTimeMs]
 * @property {boolean} [verifiedBot]
 * @property {string | null} [externalListingId] The site's own PMS listing id; marks the page as a property page. Emitted only when provided (contract 1.1).
 */

/**
 * Build the content-event body. Key order is load-bearing: the injection worker's
 * payloads are byte-compared against a golden corpus
 * (api/hotels-api-ts/src/tests/edge-events-parity.test.ts), so worker fields keep
 * the order the worker has always emitted and every consumer-specific field is
 * conditional on the caller providing it.
 * @param {ContentEventInput} input
 * @returns {Record<string, unknown>}
 */
export function buildContentEvent(input) {
    const {
        pageUrl,
        domain,
        collectionSlug,
        vrSlug,
        userAgent,
        country,
        referrer,
        clientSessionId,
        agentFetch,
        ctaIntent,
        stayCheckIn,
        stayCheckOut,
        guestCount,
        promoCode,
        responseStatus,
        responseTimeMs,
        verifiedBot,
    } = input;
    const bot = input.bot || detectBot(userAgent);
    const propertyPage = !!vrSlug || !!input.externalListingId || input.propertyPage === true;

    return {
        trackingMode: input.trackingMode || 'server',
        pageUrl,
        // Server result (bot health): the HTTP status the worker actually served or
        // passed for this request — 200 on a KV agent-md serve, finalResponse.status
        // on injection, 404 on an agent-surface miss. The ingest already persists
        // content_events.response_status; this is the missing emitter side. Omitted
        // where the status isn't knowable at fire time (the booking-intent fire).
        ...(responseStatus != null ? { responseStatus } : {}),
        // Origin round-trip ms — observe mode only (the pass-through sensor times its
        // single origin fetch; the injection paths have no comparable one fetch).
        ...(typeof responseTimeMs === 'number' ? { responseTimeMs } : {}),
        // The adopted kid_sid (from ?kid_sid / _kid_sid cookie) — anchors this server-side
        // event to the spine so get_journey can stitch the SSR/bot leg. null when no
        // carrier is present (the edge participates; a permanent session_id:null is the defect).
        clientSessionId: clientSessionId || null,
        resourceClass: propertyPage ? 'content_vr' : 'content_vrm',
        // Property pages fire 'property_view' (not 'view') so the GuestItinerary
        // escalation in /api/track opens a kid_sid-keyed storefront journey — the
        // server-authoritative path that works even if k.js client events are blocked.
        // Agent-surface serves (.md / llms.txt) fire 'fetch' instead: agents never run
        // k.js, so this is the ONLY signal for agent traffic — and 'fetch' keeps it
        // distinguishable from human pageviews (pageUrl also keeps the .md suffix).
        // Booking-engine intent pages (config.bookingEngine.intentPath w/ a resolved
        // property) fire 'cta_click' — the escalation takes the option to 'clicked'
        // and the journey to stage 'intent', WITH the stay dates below.
        actionType: agentFetch
            ? 'fetch'
            : ctaIntent
              ? 'cta_click'
              : propertyPage
                ? 'property_view'
                : 'view',
        collectionSlug,
        vacationRentalSlug: vrSlug || null,
        // The site's own PMS listing id (contract 1.1: resolved at ingest against
        // VacationRental.pmsCode). Conditional so the worker's golden corpus stays
        // byte-identical; ingest drops the field until it reads it.
        ...(input.externalListingId !== undefined
            ? { externalListingId: input.externalListingId || null }
            : {}),
        ...(input.groupSlug !== undefined ? { groupSlug: input.groupSlug } : {}),
        ...(stayCheckIn ? { stayCheckIn } : {}),
        ...(stayCheckOut ? { stayCheckOut } : {}),
        // Party size + promo code parsed off the property/booking URL (?guests, ?promocode).
        // guestCount → the option pricingSnapshot; promoCode → journey metadata (captured now,
        // surfaced later). Both omitted when absent so they never overwrite a richer signal.
        ...(guestCount ? { guestCount } : {}),
        ...(promoCode ? { promoCode } : {}),
        servingDomain: domain,
        isBot: bot.isBot,
        botName: bot.botName,
        botCategory: bot.botCategory,
        // CF's verified-bot signal, when the caller has request.cf in hand (observe
        // mode passes it; the injection call sites predate the field and stay false).
        // A coarse hint either way — ingest re-verifies from the raw signals.
        verifiedBot: verifiedBot === true,
        userAgent,
        // Raw visitor address (cf-connecting-ip at the call sites) — this worker
        // is the only hop on the apex path that sees it; the /api/track relay
        // receives this beacon from the worker's egress. The relay public-gates
        // it and forwards it upstream as metaClientIp; INGEST computes the
        // salted ip_hash (tracking v1.2) — no hashing at the edge, so the salt
        // never leaves the backend. Never persisted anywhere.
        ...(input.clientIp !== undefined ? { clientIp: input.clientIp || null } : {}),
        // Ingest-direct emitters (kismet.travel middleware) public-gate the address
        // themselves and send it as metaClientIp, the field ingest consumes.
        ...(input.metaClientIp !== undefined ? { metaClientIp: input.metaClientIp } : {}),
        country,
        // Cloudflare edge geo (request.cf at the call sites) — city/region for city-level
        // Guests-location parity with native; content-events writes metadata.location from these.
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.region !== undefined ? { region: input.region } : {}),
        referrer,
        ...(input.referrerSource !== undefined ? { referrerSource: input.referrerSource } : {}),
        ...(input.utmSource !== undefined ? { utmSource: input.utmSource } : {}),
        ...(input.utmMedium !== undefined ? { utmMedium: input.utmMedium } : {}),
        ...(input.utmCampaign !== undefined ? { utmCampaign: input.utmCampaign } : {}),
        ...(input.utmContent !== undefined ? { utmContent: input.utmContent } : {}),
        ...(input.exposureDepth !== undefined ? { exposureDepth: input.exposureDepth } : {}),
    };
}

/**
 * Transport for a built event: POST to `env.TRACKING_ENDPOINT` (default: the
 * kismet.travel /api/track relay) with the collection tracking key and, for
 * ingest-direct emitters, the service key; 2s cap; scheduled on `ctx.waitUntil` so it
 * never delays the response and never throws into the page path.
 * @param {{ waitUntil(promise: Promise<unknown>): void } | null | undefined} ctx
 *   The runtime's post-response scheduler (Cloudflare `ctx`, Next `NextFetchEvent`).
 *   Without one the fetch is a detached promise (a one-arg Next middleware).
 * @param {import('./identity.js').EdgeEnv} env
 * @param {Record<string, unknown>} event
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {void}
 */
export function postContentEvent(ctx, env, event, opts) {
    const endpoint = env.TRACKING_ENDPOINT || DEFAULT_TRACKING_ENDPOINT;

    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json' };
    if (env.API_KEY) headers['X-API-Key'] = env.API_KEY;
    if (env.COLLECTION_KEY) headers['X-Kismet-Tracking-Key'] = env.COLLECTION_KEY;

    const sent = fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(event),
        signal: AbortSignal.timeout((opts && opts.timeoutMs) || CONTENT_EVENT_TIMEOUT_MS),
    }).catch(() => {
        // Fire and forget — don't let tracking failures affect page delivery
    });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(sent);
}

/**
 * Build + post in one call: the shape every worker call site has always used.
 * @param {{ waitUntil(promise: Promise<unknown>): void } | null | undefined} ctx
 * @param {import('./identity.js').EdgeEnv} env
 * @param {ContentEventInput} input
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {void}
 */
export function fireContentEvent(ctx, env, input, opts) {
    postContentEvent(ctx, env, buildContentEvent(input), opts);
}
