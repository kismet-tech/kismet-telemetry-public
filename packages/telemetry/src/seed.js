// ── The page seed and the k.js tag (CONTRACT.md v1 §7) ─────────────────────
//
// A page served to a human carries, in <head>, in this order: the seed (the
// resolved id, or the suppression flag for bots and declined visitors) and then
// the k.js tag. k.js adopts window.Kismet._kidSid over its own cookie read; a page
// with neither seed nor flag makes k.js mint its own id, which forks the visitor.

import { KID_SID_RE } from './identity.js';

export const DEFAULT_KJS_URL = 'https://kismet.travel/k.js';

/** Globals k.js owns. Adapters never set or read them (a production outage once came from reusing one). */
export const RESERVED_GLOBALS = [
    '__kismetKjs',
    '__kismetKjsEval',
    '__kismetKjsTag',
    '__kismetAnalyticsAdapterMounted',
];

/**
 * The seed script alone. Returns '' when there is neither an id nor a suppression,
 * which callers should treat as "do not render a k.js tag either".
 * The id is grammar-checked before it is inlined, so no escaping is needed.
 * @param {{ kidSid?: string | null, suppressed?: boolean }} input
 * @returns {string}
 */
export function renderSeedScript(input) {
    if (input.suppressed) {
        return '<script>window.Kismet=window.Kismet||{};window.Kismet._sidSuppressed=1;delete window.Kismet._kidSid;</script>';
    }
    if (input.kidSid && KID_SID_RE.test(input.kidSid)) {
        return `<script>window.Kismet=window.Kismet||{};window.Kismet._kidSid="${input.kidSid}";</script>`;
    }
    return '';
}

/**
 * The k.js tag for a collection.
 * @param {string} collectionSlug
 * @param {string} [kjsUrl]
 * @returns {string}
 */
export function renderKjsTag(collectionSlug, kjsUrl) {
    return `<script async src="${kjsUrl || DEFAULT_KJS_URL}?c=${encodeURIComponent(collectionSlug)}"></script>`;
}

/**
 * Seed then tag, the load-bearing order. '' when nothing should render.
 * @param {{ kidSid?: string | null, suppressed?: boolean, collectionSlug: string, kjsUrl?: string }} input
 * @returns {string}
 */
export function renderSeed(input) {
    const seed = renderSeedScript(input);
    if (!seed) return '';
    if (input.suppressed) return seed;
    return seed + renderKjsTag(input.collectionSlug, input.kjsUrl);
}

/**
 * The values a server framework passes to its render layer so the layout can
 * inline the seed: the Next reference uses request headers with these names.
 */
export const SEED_HEADERS = {
    kidSid: 'x-kismet-kid-sid',
    suppressed: 'x-kismet-sid-suppressed',
    tier: 'x-kismet-anchor-tier',
};
