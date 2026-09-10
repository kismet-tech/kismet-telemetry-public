// GENERATED FILE. DO NOT EDIT.
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
    { pattern: 'GPTBot', name: 'GPTBot', category: 'training' },
    { pattern: 'ClaudeBot', name: 'ClaudeBot', category: 'training' },
    { pattern: 'Google-Extended', name: 'Google-Extended', category: 'training' },
    { pattern: 'Bytespider', name: 'Bytespider', category: 'training' },
    { pattern: 'CCBot', name: 'CCBot', category: 'training' },
    { pattern: 'DeepSeekBot', name: 'DeepSeekBot', category: 'training' },
    { pattern: 'cohere-ai', name: 'Cohere-ai', category: 'training' },
    { pattern: 'CohereBot', name: 'CohereBot', category: 'training' },
    { pattern: 'Meta-ExternalAgent', name: 'Meta-ExternalAgent', category: 'training' },
    { pattern: 'Applebot-Extended', name: 'Applebot-Extended', category: 'training' },
    { pattern: 'GrokBot', name: 'GrokBot', category: 'training' },
    { pattern: 'ChatGPT-User', name: 'ChatGPT-User', category: 'citation' },
    { pattern: 'Claude-Web', name: 'Claude-Web', category: 'citation' },
    { pattern: 'Claude-User', name: 'Claude-User', category: 'citation' },
    { pattern: 'Perplexity-User', name: 'Perplexity-User', category: 'citation' },
    { pattern: 'Gemini-Deep-Research', name: 'Gemini-Deep-Research', category: 'citation' },
    { pattern: 'OAI-SearchBot', name: 'OAI-SearchBot', category: 'indexing' },
    { pattern: 'PerplexityBot', name: 'PerplexityBot', category: 'indexing' },
    { pattern: 'Googlebot', name: 'Googlebot', category: 'indexing' },
    { pattern: 'GoogleOther', name: 'GoogleOther', category: 'indexing' },
    { pattern: 'bingbot', name: 'Bingbot', category: 'indexing' },
    { pattern: 'Applebot', name: 'Applebot', category: 'indexing' },
    { pattern: 'DuckDuckBot', name: 'DuckDuckBot', category: 'indexing' },
    { pattern: 'YandexBot', name: 'YandexBot', category: 'indexing' },
    { pattern: 'Baiduspider', name: 'Baiduspider', category: 'indexing' },
    { pattern: 'YouBot', name: 'YouBot', category: 'indexing' },
    { pattern: 'xAI-Grok', name: 'xAI-Grok', category: 'indexing' },
    { pattern: 'AIWebIndex', name: 'AIWebIndex', category: 'indexing' },
    { pattern: 'meta-webindexer', name: 'Meta-WebIndexer', category: 'indexing' },
    { pattern: 'SemrushBot', name: 'SemrushBot', category: 'seo_tool' },
    { pattern: 'AhrefsBot', name: 'AhrefsBot', category: 'seo_tool' },
    { pattern: 'Amazonbot', name: 'Amazonbot', category: 'commerce' },
    { pattern: 'meta-externalads', name: 'Meta-ExternalAds', category: 'commerce' },
    { pattern: 'facebookexternalhit', name: 'FacebookBot', category: 'commerce' },
    { pattern: 'HeadlessChrome', name: 'HeadlessChrome', category: 'automation' },
    { pattern: 'Lighthouse', name: 'Lighthouse', category: 'automation' },
    { pattern: 'Nexus 5X? Build/(MRA58N|MMB29P)', name: 'SyntheticEmulator', category: 'automation' },
];

/** @type {Readonly<Record<string, { funnelStage: string | null; description: string }>>} */
export const BOT_CATEGORIES = {
    training: {
        funnelStage: 'Crawled',
        description: 'AI model training crawlers',
    },
    citation: {
        funnelStage: 'Cited',
        description: 'User-facing AI agents fetching content to answer a human query',
    },
    indexing: {
        funnelStage: 'Indexed',
        description: 'Search engine and AI search indexers',
    },
    seo_tool: {
        funnelStage: null,
        description: 'SEO analysis tools',
    },
    commerce: {
        funnelStage: null,
        description: 'Commerce and social platform crawlers',
    },
    automation: {
        funnelStage: null,
        description: 'Headless browsers, emulators, and synthetic/monitoring clients — not real visitors (never run k.js)',
    },
};
