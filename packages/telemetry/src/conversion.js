// ── Booking bridge and quote capture, server side (CONTRACT.md v1 §9, §10) ─
//
// The deterministic join between a session and a completed reservation. Call it
// once, from the server code path that knows the booking succeeded, never by
// scraping the confirmation page. Both clients are best-effort: bounded, never
// throw, return a small result the caller may log and must not block on.

import { apiOrigin } from './api-origin.js';

export const BOOKING_BRIDGE_PATH = '/v1/booking-bridge';
export const QUOTE_CAPTURE_PATH = '/v1/quote-capture';
export const CONVERSION_TIMEOUT_MS = 2000;

/**
 * A confirmation code the platform will match: 6 to 64 chars with at least one digit.
 * Plain words ("platform", "confirmation") are rejected.
 * @param {unknown} s
 * @returns {s is string}
 */
export function isValidConfirmationCode(s) {
    return typeof s === 'string' && s.length >= 6 && s.length <= 64 && /[0-9]/.test(s);
}

/**
 * @typedef {object} BookingBridgeBody
 * @property {string} kidSid
 * @property {string} domain The serving domain (no www, no port).
 * @property {string} [confirmationCode] The code the guest sees. Preferred.
 * @property {string} [reservationId] The PMS's own id (a 24-hex Guesty id, for example).
 * @property {string} [bookingEngine] 'icnd' | 'guesty' | 'homerunner' | 'kismet' | 'custom' | a label.
 */

/**
 * @typedef {object} ConversionResult
 * @property {boolean} ok
 * @property {number | null} status
 * @property {string | null} error
 */

/**
 * @param {string} endpoint
 * @param {import('./identity.js').EdgeEnv} env
 * @param {Record<string, unknown>} body
 * @param {number} timeoutMs
 * @returns {Promise<ConversionResult>}
 */
async function post(endpoint, env, body, timeoutMs) {
    try {
        /** @type {Record<string, string>} */
        const headers = { 'Content-Type': 'application/json' };
        if (env.COLLECTION_KEY) headers['X-Kismet-Tracking-Key'] = env.COLLECTION_KEY;
        if (env.API_KEY) headers['X-API-Key'] = env.API_KEY;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        return { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
    } catch (e) {
        return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * POST /v1/booking-bridge. Validates the body per the contract before sending.
 * @param {import('./identity.js').EdgeEnv} env
 * @param {BookingBridgeBody} body
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<ConversionResult>}
 */
export async function postBookingBridge(env, body, opts) {
    if (!body.kidSid || !body.domain)
        return { ok: false, status: null, error: 'kidSid and domain are required' };
    if (!body.confirmationCode && !body.reservationId) {
        return { ok: false, status: null, error: 'confirmationCode or reservationId is required' };
    }
    if (body.confirmationCode && !isValidConfirmationCode(body.confirmationCode)) {
        return {
            ok: false,
            status: null,
            error: 'confirmationCode must be 6 to 64 chars and contain a digit',
        };
    }
    const wire = {
        kidSid: body.kidSid,
        ...(body.confirmationCode ? { confirmationCode: body.confirmationCode } : {}),
        ...(body.reservationId ? { reservationId: body.reservationId } : {}),
        ...(body.bookingEngine ? { bookingEngine: body.bookingEngine } : {}),
        domain: body.domain,
    };
    return post(
        apiOrigin(env) + BOOKING_BRIDGE_PATH,
        env,
        wire,
        opts?.timeoutMs || CONVERSION_TIMEOUT_MS
    );
}

/**
 * @typedef {object} QuoteCaptureBody
 * @property {string} kidSid
 * @property {string} [bookingEngine]
 * @property {string | null} [listingId] The engine's own property id.
 * @property {string | null} [pageUrl] The property page the quote came from (lets the platform resolve the property).
 * @property {string | null} [vrSlug]
 * @property {string | null} [collectionSlug]
 * @property {string | null} [checkIn] YYYY-MM-DD
 * @property {string | null} [checkOut]
 * @property {string | null} [externalQuoteId]
 * @property {number | null} [totalAmountCents] Integer minor units.
 * @property {string | null} [currency]
 * @property {string | null} [domain]
 */

/**
 * POST /v1/quote-capture.
 * @param {import('./identity.js').EdgeEnv} env
 * @param {QuoteCaptureBody} body
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<ConversionResult>}
 */
export async function postQuoteCapture(env, body, opts) {
    if (!body.kidSid) return { ok: false, status: null, error: 'kidSid is required' };
    if (body.totalAmountCents != null && !Number.isInteger(body.totalAmountCents)) {
        return { ok: false, status: null, error: 'totalAmountCents must be an integer' };
    }
    return post(
        apiOrigin(env) + QUOTE_CAPTURE_PATH,
        env,
        { ...body },
        opts?.timeoutMs || CONVERSION_TIMEOUT_MS
    );
}
