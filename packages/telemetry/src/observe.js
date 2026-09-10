// ── Path normalization ──────────────────────────────────────────────────

/**
 * Strip the query and one trailing slash; '' → '/'. The worker's KV page keys and
 * every path rule below are keyed on this form.
 * @param {string} pathname
 * @returns {string}
 */
export function normalizePath(pathname) {
    let path = pathname.split('?')[0];
    if (path.length > 1 && path.endsWith('/')) {
        path = path.slice(0, -1);
    }
    return path || '/';
}

// ── Observe-only mode (WP bot/AI-crawl capture) ─
// KISMET_WORKER_MODE='observe' (deploy-time binding) turns the worker into a
// pure pass-through SENSOR on the customer's own zone: `fetch(request)`
// unchanged — never rewrite host/origin, never inject, never set a cookie,
// never mint identity — and beacon each page/agent-surface GET to /api/track
// AFTER the response is on its way. This is the tier that sees what PHP
// and k.js structurally cannot: bots fetching CACHED pages, and attempts the
// origin then blocks (the beacon carries responseStatus, so a host that drops
// GPTBot still shows the ATTEMPT). NO classification at the edge — raw UA + CF
// signals ride to ingest's traffic-classification authority; detectBot here is
// only the worker-parity isBot hint. KV-independent by design: collection
// identity comes from the COLLECTION_SLUG binding, so an observe deploy needs
// no vrm_config/KV sync — deployable on a zone with zero Kismet page data.

// Static assets whose fetches are noise for the crawl plane. Deliberately
// NARROWER than the worker's BYPASS_EXTENSIONS_SET: .txt/.xml/.json/.md stay
// tracked — robots.txt, llms.txt, sitemaps, and data endpoints are exactly the
// agent-surface fetches the sensor exists to see.
export const OBSERVE_SKIP_EXTENSIONS = new Set([
    '.js',
    '.css',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.webp',
    '.avif',
    '.mp4',
    '.webm',
    '.map',
    '.zip',
    '.pdf',
]);

// Non-HTML suffixes that fire as actionType 'fetch' (agent surface) instead of
// 'view' — parity with the injection path's agent-md serves.
export const OBSERVE_AGENT_SUFFIXES = new Set(['.txt', '.xml', '.json', '.md']);

// WP plumbing that is never a page view (parity with the PHP beacon's
// admin/AJAX/cron/REST skips — the beacon can't fire there, so the edge
// mirroring them keeps the two planes dedup-comparable).
export const OBSERVE_SKIP_PATH_PREFIXES = ['/wp-admin', '/wp-json'];
export const OBSERVE_SKIP_PATHS = new Set([
    '/xmlrpc.php',
    '/wp-cron.php',
    '/wp-login.php',
    '/favicon.ico',
]);

/**
 * Lower-cased extension of a normalized path ('' when none): the key the observe
 * agent-suffix rule and a Kismet-built site's middleware test against.
 * @param {string} normalizedPath
 * @returns {string}
 */
export function pathSuffix(normalizedPath) {
    const dot = normalizedPath.lastIndexOf('.');
    return dot === -1 ? '' : normalizedPath.slice(dot).toLowerCase();
}

/**
 * @param {{ method: string }} request
 * @param {{ pathname: string }} url
 * @returns {boolean}
 */
export function observeShouldTrack(request, url) {
    if (request.method !== 'GET') return false;
    const path = normalizePath(url.pathname);
    if (OBSERVE_SKIP_PATHS.has(path)) return false;
    for (const prefix of OBSERVE_SKIP_PATH_PREFIXES) {
        if (path === prefix || path.startsWith(prefix + '/')) return false;
    }
    const dot = path.lastIndexOf('.');
    if (dot !== -1 && OBSERVE_SKIP_EXTENSIONS.has(path.slice(dot).toLowerCase())) return false;
    return true;
}
