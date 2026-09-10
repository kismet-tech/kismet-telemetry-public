/**
 * @kismet-tech/telemetry
 *
 * Kismet Telemetry core: the tracking contract (docs/developer-platform/tracking/
 * CONTRACT.md v1.0) as code. Everything a framework adapter needs and nothing
 * framework-specific:
 *   - resolveVisitor: threaded → cookie → suppressed → cold, local mint + async reconcile
 *   - consent: the country fallback and the site's consent hook
 *   - cookies: names, ages, the dotted-domain rule, Set-Cookie building
 *   - seed: the page seed and the k.js tag
 *   - route profile: funnel mapping (property / search / intent / agent surfaces)
 *   - content events: the ONE server-plane payload builder + bot vocabulary
 *   - conversion: booking-bridge and quote-capture clients
 *   - (subpath ./client) browser helpers; (subpath ./conformance) the suite
 *
 * Lineage: @kismet-tech/edge-events 0.1.x, whose surface is re-exported unchanged so
 * the Cloudflare injection worker and kismet.travel middleware build from the same
 * source. Web-platform APIs only in the core (fetch, URL, crypto, AbortSignal): runs on
 * Cloudflare Workers, Next.js Edge middleware, and Node 20+ alike. The conformance
 * subpath is Node-only (it starts stub HTTP servers).
 *
 * Ingest (POST /v1/content-events) stays the classification authority.
 */
export const CONTRACT_VERSION = '1.0';

export {
    COOKIE_CONSENT_DENY,
    countryAllowsCookies,
    readCountry,
    resolveConsent,
    consentFromCookie,
} from './consent.js';
export {
    SID_COOKIE,
    VID_COOKIE,
    SID_MAX_AGE,
    VID_MAX_AGE,
    cookieDomainFor,
    buildCookie,
    readCookie,
    isHttps,
    publicUrl,
} from './cookies.js';
export {
    DEFAULT_KJS_URL,
    RESERVED_GLOBALS,
    SEED_HEADERS,
    renderSeedScript,
    renderKjsTag,
    renderSeed,
} from './seed.js';
export { ASSET_EXTENSION_RE, prefersMarkdown, classifyRequest } from './route-profile.js';
export {
    KID_SID_MINT_RE,
    KID_VID_RE,
    RESOLVE_TIMEOUT_MS,
    RECONCILE_TIMEOUT_MS,
    GENERIC_CLIENT_UA_RE,
    isBotUserAgent,
    validKidSid,
    validKidVid,
    visitorIp,
    resolveVisitor,
} from './resolve.js';
export {
    BOOKING_BRIDGE_PATH,
    QUOTE_CAPTURE_PATH,
    CONVERSION_TIMEOUT_MS,
    isValidConfirmationCode,
    postBookingBridge,
    postQuoteCapture,
} from './conversion.js';

// ── The edge-events surface, unchanged ──────────────────────────────────────
export { BOT_PATTERN_ROWS, BOT_CATEGORIES } from './bot-patterns.generated.js';
export { BOT_NAMES, detectBot } from './bot-detect.js';
export {
    normalizePath,
    pathSuffix,
    OBSERVE_SKIP_EXTENSIONS,
    OBSERVE_AGENT_SUFFIXES,
    OBSERVE_SKIP_PATH_PREFIXES,
    OBSERVE_SKIP_PATHS,
    observeShouldTrack,
} from './observe.js';
export { DEFAULT_KISMET_API_ORIGIN, apiOrigin } from './api-origin.js';
export {
    KID_SID_RE,
    extractKidSid,
    CLICK_ID_RE,
    extractClickIds,
    KID_SID_COOKIE_MAX_AGE,
    mintLocalKidSid,
    setKidSidCookie,
    RESOLVE_ANCHOR_PATH,
    resolveAnchorEndpoint,
    buildResolveAnchorBody,
    parseResolveAnchorResponse,
    postResolveAnchor,
    reconcileColdKidSid,
} from './identity.js';
export {
    DEFAULT_TRACKING_ENDPOINT,
    CONTENT_EVENT_TIMEOUT_MS,
    normalizeServingDomain,
    buildContentEvent,
    postContentEvent,
    fireContentEvent,
} from './content-event.js';
export {
    parseStayDate,
    parseGuestCount,
    parsePromoCode,
    resolveBookingIntent,
    teeEngineConfirmation,
    teePriceCheck,
} from './booking-intent.js';

/**
 * @typedef {import('./bot-detect.js').BotDetection} BotDetection
 * @typedef {import('./bot-patterns.generated.js').BotPatternRow} BotPatternRow
 * @typedef {import('./identity.js').ClickIds} ClickIds
 * @typedef {import('./identity.js').EdgeEnv} EdgeEnv
 * @typedef {import('./identity.js').ResolveAnchorResult} ResolveAnchorResult
 * @typedef {import('./content-event.js').ContentEventInput} ContentEventInput
 * @typedef {import('./content-event.js').ServerTrackingMode} ServerTrackingMode
 * @typedef {import('./booking-intent.js').BookingEngineProfile} BookingEngineProfile
 * @typedef {import('./consent.js').ConsentHook} ConsentHook
 * @typedef {import('./consent.js').ConsentContext} ConsentContext
 * @typedef {import('./route-profile.js').RouteProfile} RouteProfile
 * @typedef {import('./route-profile.js').Classification} Classification
 * @typedef {import('./resolve.js').ResolveInput} ResolveInput
 * @typedef {import('./resolve.js').ResolveResult} ResolveResult
 * @typedef {import('./resolve.js').AnchorTier} AnchorTier
 * @typedef {import('./conversion.js').BookingBridgeBody} BookingBridgeBody
 * @typedef {import('./conversion.js').QuoteCaptureBody} QuoteCaptureBody
 * @typedef {import('./conversion.js').ConversionResult} ConversionResult
 */
