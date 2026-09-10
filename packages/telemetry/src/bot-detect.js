// ── Bot detection (edge parity hint) ────────────────────────────────────
//
// The ONE bot vocabulary is api/hotels-api-ts/src/data/bot-patterns.json; the
// list this reads is generated from it (scripts/generate-bot-patterns.mjs) and CI
// fails when the two drift. Ingest (content-event.service.ts) re-classifies every
// event authoritatively from the raw userAgent, so what an edge emitter says here
// is a PARITY HINT: it decides edge-local behavior (no session for a crawler, the
// k.js seed suppression), never the stored taxonomy.
//
// Before this module the injection worker carried a hand-pasted copy of this array
// behind a "SYNC PROCEDURE" comment; that copy was six names behind the JSON when it
// was retired (CohereBot, Claude-User, Baiduspider, AIWebIndex, meta-webindexer,
// meta-externalads).

import { BOT_PATTERN_ROWS } from './bot-patterns.generated.js';

/**
 * @typedef {object} BotDetection
 * @property {boolean} isBot
 * @property {string | null} botName
 * @property {string | null} botCategory
 */

// Compiled ONCE at module init (the middleware copy this replaces compiled every
// pattern on every request).
/** @type {readonly { pattern: RegExp; name: string; category: string }[]} */
const BOT_PATTERNS = BOT_PATTERN_ROWS.map((row) => ({
    pattern: new RegExp(row.pattern, 'i'),
    name: row.name,
    category: row.category,
}));

/** Named-bot names in vocabulary order (what a robots.txt allow-list author wants). */
/** @type {readonly string[]} */
export const BOT_NAMES = BOT_PATTERN_ROWS.map((row) => row.name);

/**
 * @param {string | null | undefined} userAgent
 * @returns {BotDetection}
 */
export function detectBot(userAgent) {
    if (!userAgent) return { isBot: false, botName: null, botCategory: null };
    for (const { pattern, name, category } of BOT_PATTERNS) {
        if (pattern.test(userAgent)) {
            return { isBot: true, botName: name, botCategory: category };
        }
    }
    return { isBot: false, botName: null, botCategory: null };
}
