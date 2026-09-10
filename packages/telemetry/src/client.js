// ── Browser helpers (CONTRACT.md v1 §13a) ───────────────────────────────────
//
// `@kismet-tech/telemetry/client`. Runs in the browser only. Dispatches the
// `kismet:visitor:*` CustomEvents k.js bridges to /api/track (with the metaEventId
// dedup and the GA4 / Meta fan-out). NEVER calls window.Kismet.track(): it omits
// `resourceClass`, so /api/track rejects it, and it skips the fan-out.
//
// Event → spine mapping (k.js ELEMENT_EVENT_MAP):
//   search:view           view            content_vrm   (researching)
//   property-detail:view  property_view   content_vr    (viewed; planning when dates ride along)
//   property:save         add_to_wishlist content_vr    (shortlisting)
//   property-detail:book  cta_click       content_vr    (intent)
//   property-detail:share click           content_vr
// Purchase is never beaconed from the browser; the booking bridge is the conversion.

/**
 * @typedef {object} PropertyDetail
 * @property {string} [vacationRentalSlug] Kismet's slug when known.
 * @property {string} [externalListingId] The site's own listing id (contract 1.1; safe to send now).
 * @property {string} [propertyId] Kismet VacationRental.id, for Meta hotel_ids when known.
 * @property {string} [propertyName]
 * @property {'full' | 'quickview' | 'summary'} [exposureDepth]
 * @property {string} [checkIn] YYYY-MM-DD
 * @property {string} [checkOut]
 * @property {number} [guests]
 * @property {number} [stayTotalCents] Integer cents, before tax, fees included. Omit when unknown; never zero.
 * @property {string} [currency]
 * @property {number} [nightCount]
 */

/**
 * @param {string} name
 * @returns {string | null}
 */
function readCookie(name) {
    if (typeof document === 'undefined') return null;
    const esc = name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&');
    const m = document.cookie.match(new RegExp('(?:^|; )' + esc + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
}

/**
 * The session id the server seeded (or the cookie it set); null when suppressed
 * or not in a browser.
 * @returns {string | null}
 */
export function currentKidSid() {
    if (typeof window === 'undefined') return null;
    const w = /** @type {{ Kismet?: { _kidSid?: string, _sidSuppressed?: number } }} */ (
        /** @type {unknown} */ (window)
    );
    if (w.Kismet && w.Kismet._sidSuppressed) return null;
    return (w.Kismet && w.Kismet._kidSid) || readCookie('_kid_sid');
}

/**
 * Dispatch one visitor event. Enriches with collectionSlug, servingDomain, kidSid
 * and timestamp, mirrors vacationRentalSlug → vrSlug (k.js reads either). Returns
 * false when telemetry is suppressed or we are not in a browser.
 * @param {string} name e.g. 'property-detail:view'
 * @param {Record<string, unknown>} detail
 * @param {{ collectionSlug: string }} opts
 * @returns {boolean}
 */
export function emitVisitorEvent(name, detail, opts) {
    if (typeof window === 'undefined') return false;
    const kidSid = currentKidSid();
    if (!kidSid) return false;
    /** @type {Record<string, unknown>} */
    const d = {
        collectionSlug: opts.collectionSlug,
        servingDomain: window.location.hostname,
        kidSid,
        timestamp: new Date().toISOString(),
        ...detail,
    };
    if (typeof d.vacationRentalSlug === 'string') d.vrSlug = d.vacationRentalSlug;
    window.dispatchEvent(new CustomEvent(`kismet:visitor:${name}`, { detail: d }));
    return true;
}

/**
 * Typed helpers bound to a collection.
 * @param {{ collectionSlug: string }} opts
 */
export function createTracker(opts) {
    return {
        /** A results page rendered (researching). @param {Record<string, unknown>} [detail] */
        searchView: (detail) => emitVisitorEvent('search:view', detail || {}, opts),
        /** A property opened (viewed; planning when checkIn/checkOut ride along). @param {PropertyDetail} detail */
        propertyView: (detail) =>
            emitVisitorEvent('property-detail:view', { exposureDepth: 'full', ...detail }, opts),
        /** A save / heart (shortlisting). @param {PropertyDetail} detail */
        save: (detail) => emitVisitorEvent('property:save', { ...detail }, opts),
        /** The book-now / checkout CTA (intent). @param {PropertyDetail} detail */
        bookIntent: (detail) => emitVisitorEvent('property-detail:book', { ...detail }, opts),
        /** A share (generic engagement). @param {PropertyDetail} detail */
        share: (detail) => emitVisitorEvent('property-detail:share', { ...detail }, opts),
    };
}

/**
 * Browser-side booking bridge through the kismet.travel relay, for sites whose
 * confirmation is only known in the browser. Prefer the server-side client in the
 * core (`postBookingBridge`) whenever the server knows the booking succeeded.
 * text/plain on purpose: a cross-origin application/json POST stalls on CORS preflight.
 * @param {{ confirmationCode?: string, reservationId?: string, bookingEngine?: string, relayOrigin?: string }} input
 * @returns {Promise<boolean>}
 */
export async function postBookingBridgeFromBrowser(input) {
    const kidSid = currentKidSid();
    if (!kidSid || typeof fetch === 'undefined' || typeof window === 'undefined') return false;
    const code = input.confirmationCode;
    if (code && !(code.length >= 6 && code.length <= 64 && /\d/.test(code))) return false;
    if (!code && !input.reservationId) return false;
    const body = JSON.stringify({
        kidSid,
        ...(code ? { confirmationCode: code } : {}),
        ...(input.reservationId ? { reservationId: input.reservationId } : {}),
        bookingEngine: input.bookingEngine || 'custom',
        domain: window.location.hostname,
    });
    try {
        const res = await fetch(
            `${input.relayOrigin || 'https://kismet.travel'}/api/k/booking-bridge`,
            {
                method: 'POST',
                headers: { 'content-type': 'text/plain' },
                body,
                keepalive: true,
            }
        );
        return res.ok;
    } catch {
        return false;
    }
}
