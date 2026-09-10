// ── The Kismet API origin every direct edge → API call targets ───────────

export const DEFAULT_KISMET_API_ORIGIN = 'https://api.ksmt.app';

/**
 * `KISMET_API_ORIGIN` lets a lab zone or a local harness point the identity
 * reconcile, quote-capture and booking-bridge posts somewhere else; unset (every
 * production deploy) means the API.
 * @param {{ KISMET_API_ORIGIN?: string } | null | undefined} env
 * @returns {string}
 */
export function apiOrigin(env) {
    return (env && env.KISMET_API_ORIGIN) || DEFAULT_KISMET_API_ORIGIN;
}
