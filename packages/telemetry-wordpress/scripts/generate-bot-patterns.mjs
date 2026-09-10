#!/usr/bin/env node
// Generates includes/bot-patterns.generated.php from the vendored vocabulary
// packages/telemetry/bot-patterns.json (one source for every adapter).
//   node scripts/generate-bot-patterns.mjs          # write
//   node scripts/generate-bot-patterns.mjs --check  # exit 1 if stale (CI)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, '../../telemetry/bot-patterns.json');
const TARGET = path.resolve(here, '../includes/bot-patterns.generated.php');
const json = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
const rows = json.patterns;
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const body = rows.map((r) => `        ['pattern' => '${esc(r.pattern)}', 'name' => '${esc(r.name)}', 'category' => '${esc(r.category)}'],`).join('\n');
const out = `<?php
// GENERATED from packages/telemetry/bot-patterns.json by scripts/generate-bot-patterns.mjs. Do not edit.
// ${rows.length} patterns, in source order (more specific before general).

defined('ABSPATH') || exit;

/** @return array<int, array{pattern:string,name:string,category:string}> */
function kismet_telemetry_bot_patterns(): array {
    return [
${body}
    ];
}
`;
if (process.argv.includes('--check')) {
    const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
    if (current !== out) {
        console.error('✗ includes/bot-patterns.generated.php is stale. Run: node scripts/generate-bot-patterns.mjs');
        process.exit(1);
    }
    console.log(`✓ bot-patterns.generated.php is current (${rows.length} patterns)`);
} else {
    fs.writeFileSync(TARGET, out);
    console.log(`✓ wrote bot-patterns.generated.php (${rows.length} patterns)`);
}
