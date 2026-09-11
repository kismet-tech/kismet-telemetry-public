import { apiOrigin } from './api-origin.js';

// ── Identity carrier (adopt-never-mint) ───────────────
// The apex anchor ADOPTS an inbound kid_sid and never mints. The email/apex link
// threads ?kid_sid=; a returning visitor carries the _kid_sid cookie. Strict
// validation (^kid_[A-Za-z0-9]{6,40}$) makes the value safe to inline into a <script>
// seed and a Set-Cookie header (no XSS / header injection).
export const KID_SID_RE = /^kid_[A-Za-z0-9]{6,40}$/;

/**
 * Adopt-only read of the identity carrier: ?kid_sid= first, then the _kid_sid cookie.
 * Never mints. Callers decide whether the requester may carry a session at all: a bot
 * echoing a shared ?kid_sid= link must not attach a human's session (the worker and
 * observe mode both gate on detectBot before calling this).
 * @param {{ searchParams: { get(name: string): string | null } }} url
 * @param {{ headers: { get(name: string): string | null } }} request
 * @returns {string | null}
 */
export function extractKidSid(url, request) {
    const fromUrl = url.searchParams.get('kid_sid');
    if (fromUrl && KID_SID_RE.test(fromUrl)) return fromUrl;
    const cookie = request.headers.get('cookie') || '';
    const m = cookie.match(/(?:^|;\s*)_kid_sid=([^;]+)/);
    if (m && KID_SID_RE.test(m[1])) return m[1];
    return null;
}

// Ad click identifiers off the landing request — forwarded to the authority
// (resolve-anchor) so the BookingSession spine stores first-touch acquisition. Google's
// offline-conversion upload is keyed on these (no PII fallback), so the apex MUST
// capture them or Google can't attribute apex bookings. Charset+length guarded like
// KID_SID_RE before they flow into a JSON body.
//
// `fbclid` (Meta) is captured for the same reason gclid is.
// An earlier comment here claimed Meta needed no durable session capture because
// "the injected k.js handles Meta browse matching client-side". That conflated two
// different jobs: k.js's `_fbc`/`_fbp` cookies serve Meta CAPI *match quality*, they
// do NOT tell Kismet which channel ACQUIRED the guest, and they depend on k.js
// actually firing on the landing hit. The edge sees the landing request either way,
// so capturing here gives acquisition a durable, structured record (session_touches)
// that does not depend on the tracker. Measured on real data: of 1,003 sessions
// whose landing URL carries an fbclid, 148 have no content_event at all — nothing
// downstream can recover the Meta click for those.
//
// fbclid shares the Google guard. An earlier revision gave Meta its own regex on the
// assumption its charset is broader (base64url-ish, `PAZXh0bgNhZW0…`) — measured on
// real data, that is false: across 5,475 real fbclids, 0 contain a character outside
// `[A-Za-z0-9._-]` and the longest is 212. One regex, one guard.
export const CLICK_ID_RE = /^[A-Za-z0-9._-]{1,512}$/;

/**
 * @typedef {object} ClickIds
 * @property {string | null} gclid
 * @property {string | null} gbraid
 * @property {string | null} wbraid
 * @property {string | null} gadCampaignId
 * @property {string | null} fbclid
 */

/**
 * @param {{ searchParams: { get(name: string): string | null } }} url
 * @returns {ClickIds}
 */
export function extractClickIds(url) {
    const q = (/** @type {string} */ name) => {
        const v = url.searchParams.get(name);
        return v && CLICK_ID_RE.test(v) ? v : null;
    };
    return {
        gclid: q('gclid'),
        gbraid: q('gbraid'),
        wbraid: q('wbraid'),
        gadCampaignId: q('gad_campaignid'),
        fbclid: q('fbclid'),
    };
}

// Persist the adopted kid_sid as a first-party cookie on the apex (shared www↔apex
// via Domain=.{domain}). NOT HttpOnly — k.js reads it via document.cookie. No-op when
// there's no carrier (k.js mints + sets its own cookie client-side).
export const KID_SID_COOKIE_MAX_AGE = 90 * 24 * 60 * 60;

// Signed-stateless local mint: the apex worker mints a
// kid_sid at the EDGE — 0-latency, never null — for the seed/cookie/server-events,
// then reconciles it with the authority async (reconcileColdKidSid). Format MUST
// match the resolver's `kid_`+8 (KID_SID_RE) so the authority can adopt it.
// crypto.getRandomValues is available in the Cloudflare Workers runtime, Node 20+
// and every edge runtime this module targets.
const KID_SID_MINT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** @returns {string} */
export function mintLocalKidSid() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    let s = 'kid_';
    for (let i = 0; i < 8; i++) s += KID_SID_MINT_ALPHABET[bytes[i] % KID_SID_MINT_ALPHABET.length];
    return s;
}

/**
 * @param {{ headers: { append(name: string, value: string): void } }} response
 * @param {string | null | undefined} kidSid
 * @param {string | null | undefined} domain
 */
export function setKidSidCookie(response, kidSid, domain) {
    if (!kidSid || !domain) return;
    response.headers.append(
        'Set-Cookie',
        `_kid_sid=${kidSid}; Domain=.${domain}; Path=/; Max-Age=${KID_SID_COOKIE_MAX_AGE}; Secure; SameSite=Lax`
    );
}

// ── Resolve-anchor (the ONE identity authority) ─────────────────────────

export const RESOLVE_ANCHOR_PATH = '/v1/identity/resolve-anchor';

/**
 * @typedef {object} EdgeEnv
 * @property {string} [TRACKING_ENDPOINT] Where content events are POSTed. Default: the kismet.travel /api/track relay.
 * @property {string} [COLLECTION_KEY] The collection's `ctk_` tracking key → X-Kismet-Tracking-Key.
 * @property {string} [API_KEY] Service key → X-API-Key (kismet.travel middleware posting straight to the API).
 * @property {string} [RESOLVE_ANCHOR_ENDPOINT] Override for the identity authority URL (default: KISMET_API_ORIGIN + RESOLVE_ANCHOR_PATH).
 * @property {string} [KISMET_API_ORIGIN] Override for every direct edge → API call (default https://api.ksmt.app).
 * @property {string} [COLLECTION_SLUG]
 */

/**
 * @param {EdgeEnv | null | undefined} env
 * @returns {string}
 */
export function resolveAnchorEndpoint(env) {
    return (env && env.RESOLVE_ANCHOR_ENDPOINT) || apiOrigin(env) + RESOLVE_ANCHOR_PATH;
}

/**
 * The resolve-anchor request body. Field set == RESOLVE_BODY_SCHEMA_PROPS on the
 * route (api/hotels-api-ts/src/routes/identity/resolve-body-schema.ts) — Fastify
 * SILENTLY STRIPS anything not declared there, so `src/tests/meta-click-capture.test.ts`
 * parses THIS function's return literal as the drift gate. Keep it a literal.
 *
 * `undefined` values are dropped by JSON.stringify, so the worker's cold-mint
 * reconcile (no threaded/cookie ids) serializes exactly as it always has.
 *
 * @param {{
 *   collectionSlug: string | null,
 *   vrSlug?: string | null,
 *   origin: string,
 *   proposedKidSid?: string | null,
 *   threadedKidSid?: string | null,
 *   cookieKidSid?: string | null,
 *   cookieKidVid?: string | null,
 *   visitorConsent?: boolean,
 *   ip?: string | null,
 *   userAgent?: string | null,
 *   acceptLanguage?: string | null,
 *   referrer?: string | null,
 *   clickIds?: Partial<ClickIds> | null,
 *   landingUrl?: string | null,
 * }} signals
 * @returns {Record<string, unknown>}
 */
export function buildResolveAnchorBody(signals) {
    const clickIds = signals.clickIds;
    return {
        collectionSlug: signals.collectionSlug,
        vrSlug: signals.vrSlug || null,
        origin: signals.origin,
        // The edge-minted id for the authority to adopt as canonical.
        proposedKidSid: signals.proposedKidSid,
        // A threaded ?kid_sid= (link) and the cookie it may back-stitch to (Kismet-built
        // sites' anchor); the worker's cold-mint reconcile never sets these.
        threadedKidSid: signals.threadedKidSid,
        cookieKidSid: signals.cookieKidSid,
        cookieKidVid: signals.cookieKidVid,
        visitorConsent: signals.visitorConsent,
        // L1 fingerprint signals — the VISITOR's values (this request's headers ARE
        // the visitor's at the edge). Let the authority dedupe/merge server-side.
        ip: signals.ip || null,
        userAgent: signals.userAgent || null,
        acceptLanguage: signals.acceptLanguage || null,
        referrer: signals.referrer || null,
        // Google click attribution → first-touch on the BookingSession, so Google's
        // offline-conversion upload can attribute apex bookings. (The apex's sessions
        // previously got NO click IDs — resolveIdentity dropped them on mint.)
        gclid: clickIds?.gclid || null,
        gbraid: clickIds?.gbraid || null,
        wbraid: clickIds?.wbraid || null,
        gadCampaignId: clickIds?.gadCampaignId || null,
        // Meta click attribution → recorded as the session's Meta touch
        // (session_touches.fbclid), giving acquisition a durable record of the
        // Meta landing that does not depend on k.js having fired on it.
        fbclid: clickIds?.fbclid || null,
        landingUrl: signals.landingUrl,
    };
}

/**
 * @typedef {object} ResolveAnchorResult
 * @property {string} kidSid
 * @property {string | null} kidVid
 * @property {boolean} [isNew]
 * @property {string} [tier]
 */

/**
 * The resolve-anchor response as the public route shapes it: `{ ok, kid_sid, kid_vid,
 * isNew, tier }`. Anything else, or a kid_sid outside KID_SID_RE, is null.
 * @param {unknown} json
 * @returns {ResolveAnchorResult | null}
 */
export function parseResolveAnchorResponse(json) {
    if (!json || typeof json !== 'object') return null;
    const j = /** @type {Record<string, unknown>} */ (json);
    if (j.ok !== true || typeof j.kid_sid !== 'string' || !KID_SID_RE.test(j.kid_sid)) return null;
    return {
        kidSid: j.kid_sid,
        kidVid: typeof j.kid_vid === 'string' && j.kid_vid.length ? j.kid_vid : null,
        ...(typeof j.isNew === 'boolean' ? { isNew: j.isNew } : {}),
        ...(typeof j.tier === 'string' ? { tier: j.tier } : {}),
    };
}

/**
 * POST a resolve-anchor body to the authority and parse the reply. Best-effort:
 * every failure mode (network, timeout, non-2xx, malformed body) is `null`, never a
 * throw — callers are anchors on the page-serving path.
 * @param {EdgeEnv} env
 * @param {Record<string, unknown>} body
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<ResolveAnchorResult | null>}
 */
export async function postResolveAnchor(env, body, opts) {
    try {
        /** @type {Record<string, string>} */
        const headers = { 'Content-Type': 'application/json' };
        if (env.COLLECTION_KEY) headers['X-Kismet-Tracking-Key'] = env.COLLECTION_KEY;
        const res = await fetch(resolveAnchorEndpoint(env), {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout((opts && opts.timeoutMs) || 3000),
        });
        if (!res.ok) return null;
        return parseResolveAnchorResponse(await res.json());
    } catch {
        return null;
    }
}

/**
 * Reconcile an EDGE-MINTED kid_sid with the ONE authority:
 * POST /v1/identity/resolve-anchor with `proposedKidSid` so the authority ADOPTS it
 * and creates the BookingSession acquisition spine UNDER that id (server-side, the
 * fingerprint tier yields to the proposed id). Runs in ctx.waitUntil (post-response)
 * — never on the critical path: the page already shipped with the local id, and the
 * `_kid_sid` cookie keeps it stable for the visitor's next request. Return ignored;
 * best-effort — a failure just defers server-side spine creation, never page delivery.
 * @param {EdgeEnv} env
 * @param {string} domain
 * @param {string | null} collectionSlug
 * @param {string | null | undefined} vrSlug
 * @param {{ url: string; headers: { get(name: string): string | null } }} request
 * @param {string} proposedKidSid
 * @param {Partial<ClickIds> | null | undefined} clickIds
 * @returns {Promise<void>}
 */
export async function reconcileColdKidSid(
    env,
    domain,
    collectionSlug,
    vrSlug,
    request,
    proposedKidSid,
    clickIds
) {
    await postResolveAnchor(
        env,
        buildResolveAnchorBody({
            collectionSlug,
            vrSlug,
            origin: domain,
            proposedKidSid,
            ip: request.headers.get('cf-connecting-ip') || null,
            userAgent: request.headers.get('user-agent') || null,
            acceptLanguage: request.headers.get('accept-language') || null,
            referrer: request.headers.get('referer') || null,
            clickIds,
            landingUrl: request.url,
        }),
        // Post-response (waitUntil): a generous safety cap, not on the TTFB path.
        { timeoutMs: 3000 }
    );
}
