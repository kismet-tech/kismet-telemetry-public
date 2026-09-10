#!/usr/bin/env node
/**
 * Generates src/bot-patterns.generated.js from the ONE bot vocabulary:
 * packages/telemetry/bot-patterns.json (a vendored copy of the platform vocabulary
 * symlinks there). Ingest (content-event.service.ts / traffic-classification.ts)
 * reads that JSON directly and stays the classification authority; every edge
 * emitter (the injection worker, kismet.travel middleware, Kismet-built sites)
 * gets the same list through this module, never a hand-pasted copy.
 *
 *   node scripts/generate-bot-patterns.mjs          # write
 *   node scripts/generate-bot-patterns.mjs --check  # exit 1 if stale (CI)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, '../bot-patterns.json');
const TARGET = path.resolve(here, '../src/bot-patterns.generated.js');

const json = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
if (!Array.isArray(json.patterns) || json.patterns.length === 0) {
    console.error(`✗ ${SOURCE}: expected a non-empty "patterns" array`);
    process.exit(1);
}
for (const [i, p] of json.patterns.entries()) {
    if (
        typeof p.pattern !== 'string' ||
        typeof p.name !== 'string' ||
        typeof p.category !== 'string'
    ) {
        console.error(`✗ ${SOURCE}: patterns[${i}] must have string pattern/name/category`);
        process.exit(1);
    }
    // Fail at generation time, not in a deployed worker.
    new RegExp(p.pattern, 'i');
}

// Single-quoted JS string literal (prettier style for this repo).
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const rows = json.patterns
    .map((p) => `    { pattern: ${q(p.pattern)}, name: ${q(p.name)}, category: ${q(p.category)} },`)
    .join('\n');

const categories = Object.entries(json.categories ?? {})
    .map(
        ([key, c]) =>
            `    ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : q(key)}: {\n        funnelStage: ${c.funnelStage == null ? 'null' : q(c.funnelStage)},\n        description: ${q(c.description ?? '')},\n    },`
    )
    .join('\n');

const out = `// GENERATED FILE. DO NOT EDIT.
// Source: packages/telemetry/bot-patterns.json (a vendored copy of the platform vocabulary).
// Regenerate: node packages/telemetry/scripts/generate-bot-patterns.mjs
// CI fails (edge-events-guard) when this file is stale relative to the JSON.
//
// ORDER MATTERS: more specific patterns come before general ones (ChatGPT-User before
// GPTBot, Applebot-Extended before Applebot). The order here is the JSON's order.

/**
 * @typedef {object} BotPatternRow
 * @property {string} pattern RegExp source, matched case-insensitively against the raw User-Agent.
 * @property {string} name
 * @property {string} category
 */

/** @type {readonly BotPatternRow[]} */
export const BOT_PATTERN_ROWS = [
${rows}
];

/** @type {Readonly<Record<string, { funnelStage: string | null; description: string }>>} */
export const BOT_CATEGORIES = {
${categories}
};
`;

const check = process.argv.includes('--check');
const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;
if (check) {
    if (current !== out) {
        console.error(
            `✗ ${path.relative(process.cwd(), TARGET)} is stale relative to bot-patterns.json.\n` +
                `  Run: node packages/telemetry/scripts/generate-bot-patterns.mjs`
        );
        process.exit(1);
    }
    console.log(`✓ bot-patterns.generated.js is current (${json.patterns.length} patterns)`);
    process.exit(0);
}
if (current === out) {
    console.log(`= bot-patterns.generated.js unchanged (${json.patterns.length} patterns)`);
} else {
    fs.writeFileSync(TARGET, out);
    console.log(`✓ wrote bot-patterns.generated.js (${json.patterns.length} patterns)`);
}
