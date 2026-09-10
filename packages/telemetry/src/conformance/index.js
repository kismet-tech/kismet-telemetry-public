// ── Conformance harness (CONTRACT.md v1 §15) ───────────────────────────────
//
// `@kismet-tech/telemetry/conformance`. Node-only. Starts a stub authority and a
// stub relay, drives an adapter through the eight requirement groups of the
// contract, and reports per-check results. Every framework adapter ships a test
// that calls `runConformance` with its own driver; an adapter that does not pass
// does not ship.
//
// The driver is the only adapter-specific piece: `handle(Request) → Response`,
// `flush()` to await background work (reconcile, events), and `fixtures` naming a
// host and a few paths the suite can hit.

/// <reference types="node" />
import { createServer } from 'node:http';
import { KID_SID_MINT_RE } from '../resolve.js';
import { RESERVED_GLOBALS } from '../seed.js';

/** The resolve-anchor body the authority declares; anything else is silently dropped. */
export const RESOLVE_BODY_KEYS = new Set([
    'collectionSlug',
    'vrSlug',
    'origin',
    'proposedKidSid',
    'threadedKidSid',
    'cookieKidSid',
    'cookieKidVid',
    'ip',
    'userAgent',
    'acceptLanguage',
    'referrer',
    'gclid',
    'gbraid',
    'wbraid',
    'gadCampaignId',
    'fbclid',
    'landingUrl',
]);

/**
 * @typedef {object} StubRequest
 * @property {Record<string, string>} headers
 * @property {any} body
 * @property {string} path
 * @property {number} at
 */

/**
 * @typedef {object} Stub
 * @property {string} url
 * @property {StubRequest[]} requests
 * @property {(ms: number) => void} hang Delay every response by `ms` from now on (0 to clear).
 * @property {() => void} reset Forget recorded requests.
 * @property {() => Promise<void>} close
 */

/**
 * @param {(req: StubRequest) => { status: number, body: unknown }} respond
 * @param {{ trackingKey?: string }} [opts]
 * @returns {Promise<Stub>}
 */
async function startStub(respond, opts) {
    /** @type {StubRequest[]} */
    const requests = [];
    let hangMs = 0;
    const server = createServer(
        /**
         * @param {import('node:http').IncomingMessage} req
         * @param {import('node:http').ServerResponse} res
         */
        (req, res) => {
            /** @type {Buffer[]} */
            const chunks = [];
            req.on('data', (/** @type {Buffer} */ c) => chunks.push(c));
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                /** @type {unknown} */
                let body = null;
                try {
                    body = raw ? JSON.parse(raw) : null;
                } catch {
                    body = raw;
                }
                /** @type {Record<string, string>} */
                const headers = {};
                for (const [k, v] of Object.entries(req.headers))
                    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v || '';
                const rec = { headers, body, path: req.url || '/', at: Date.now() };
                requests.push(rec);
                const send = () => {
                    if (
                        opts?.trackingKey &&
                        headers['x-kismet-tracking-key'] !== opts.trackingKey
                    ) {
                        res.writeHead(401, { 'content-type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'INVALID_TRACKING_KEY' }));
                        return;
                    }
                    const out = respond(rec);
                    res.writeHead(out.status, { 'content-type': 'application/json' });
                    res.end(JSON.stringify(out.body));
                };
                if (hangMs > 0) setTimeout(send, hangMs);
                else send();
            });
        }
    );
    await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
    const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
    return {
        url: `http://127.0.0.1:${addr.port}`,
        requests,
        hang: (ms) => {
            hangMs = ms;
        },
        reset: () => {
            requests.length = 0;
        },
        close: () =>
            new Promise((r) => {
                server.closeAllConnections?.();
                server.close(() => r(undefined));
            }),
    };
}

/**
 * A stub of POST /v1/identity/resolve-anchor: adopts a proposed or threaded id,
 * else answers with a fixed id; 401 without the expected key.
 * @param {{ trackingKey?: string }} [opts]
 * @returns {Promise<Stub>}
 */
export function createStubAuthority(opts) {
    return startStub((req) => {
        const b =
            req.body && typeof req.body === 'object'
                ? /** @type {Record<string, unknown>} */ (req.body)
                : {};
        const proposed = typeof b.proposedKidSid === 'string' ? b.proposedKidSid : null;
        const threaded = typeof b.threadedKidSid === 'string' ? b.threadedKidSid : null;
        return {
            status: 200,
            body: {
                ok: true,
                kid_sid: proposed || threaded || 'kid_Auth0001',
                kid_vid: 'vid_stub0001',
                isNew: !!proposed,
                tier: proposed ? 'proposed' : threaded ? 'threaded' : 'fingerprint',
            },
        };
    }, opts);
}

/**
 * A stub of the /api/track relay (or /v1/content-events): records events, 200.
 * @param {{ trackingKey?: string }} [opts]
 * @returns {Promise<Stub>}
 */
export function createStubRelay(opts) {
    return startStub(() => ({ status: 200, body: { success: true } }), opts);
}

/**
 * @typedef {object} DriverFixtures
 * @property {string} host The serving host the driver serves, e.g. 'www.example.com' (the suite derives the cookie domain).
 * @property {string} pagePath A plain page, e.g. '/about'.
 * @property {string} propertyPath A property page the driver's route profile recognises.
 * @property {string} propertyId The identifier the property page yields.
 * @property {'vacationRentalSlug' | 'externalListingId'} propertyIdField Which event field carries it.
 * @property {string} [intentPath] The intent path, hit with ?checkin=&checkout=&guests=. Omit if the adapter has no intent profile.
 * @property {string} [agentPath] An agent surface. Default '/llms.txt'.
 * @property {string} [consentCookie] A Cookie header value that satisfies the driver's consent hook (e.g. 'CookieConsent=yes'). Omit if the driver runs the country default only.
 */

/**
 * @typedef {object} AdapterDriver
 * @property {(request: Request) => Promise<Response>} handle
 * @property {() => Promise<void>} [flush] Await background work scheduled during handle().
 * @property {DriverFixtures} fixtures
 */

/**
 * @typedef {object} DriverEnv
 * @property {string} authorityUrl Full resolve-anchor URL of the stub.
 * @property {string} relayUrl Full content-event URL of the stub.
 * @property {string} trackingKey
 * @property {string} collectionSlug
 */

/**
 * @typedef {object} CheckResult
 * @property {string} id e.g. 'R2.cookie-attrs'
 * @property {string} name
 * @property {boolean} ok
 * @property {string} [detail]
 */

/**
 * @typedef {object} ConformanceReport
 * @property {boolean} ok
 * @property {number} passed
 * @property {number} failed
 * @property {CheckResult[]} results
 */

const HUMAN_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const BOT_UA =
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';

/**
 * @param {string} host
 * @param {string} path
 * @param {Record<string, string>} [headers]
 */
function makeRequest(host, path, headers) {
    const h = new Headers({
        'user-agent': HUMAN_UA,
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'accept-language': 'en-GB,en;q=0.9',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': host,
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
        referer: 'https://chatgpt.com/',
        ...(headers || {}),
    });
    return new Request(`https://${host}${path}`, { method: 'GET', headers: h });
}

/**
 * @param {Response} res
 * @param {string} name
 * @returns {string | null} the full Set-Cookie line for `name`, or null
 */
function setCookieFor(res, name) {
    const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return all.find((c) => c.startsWith(name + '=')) || null;
}

/**
 * @param {string | null} line
 * @returns {string | null}
 */
function cookieValue(line) {
    if (!line) return null;
    const m = /^[^=]+=([^;]+)/.exec(line);
    return m ? m[1] : null;
}

/**
 * @param {string} host
 * @returns {string}
 */
function expectedDomain(host) {
    let h = host
        .toLowerCase()
        .replace(/^www\./, '')
        .replace(/:\d+$/, '');
    if (!h.includes('.') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return '';
    return '.' + h;
}

/**
 * Run the suite against an adapter.
 * @param {(env: DriverEnv) => AdapterDriver | Promise<AdapterDriver>} makeDriver
 * @param {{ collectionSlug?: string, trackingKey?: string, responseBudgetMs?: number }} [opts]
 * @returns {Promise<ConformanceReport>}
 */
export async function runConformance(makeDriver, opts) {
    const collectionSlug = opts?.collectionSlug || 'conformance-lab';
    const trackingKey = opts?.trackingKey || 'ctk_conformance_0000000000000000';
    const budget = opts?.responseBudgetMs ?? 1000;
    const authority = await createStubAuthority({ trackingKey });
    const relay = await createStubRelay({ trackingKey });
    /** @type {CheckResult[]} */
    const results = [];
    /**
     * @param {string} id
     * @param {string} name
     * @param {boolean} ok
     * @param {string} [detail]
     */
    const check = (id, name, ok, detail) => {
        results.push({ id, name, ok, ...(ok ? {} : { detail: detail || 'failed' }) });
    };

    try {
        const driver = await makeDriver({
            authorityUrl: authority.url + '/v1/identity/resolve-anchor',
            relayUrl: relay.url + '/api/track',
            trackingKey,
            collectionSlug,
        });
        const f = driver.fixtures;
        const flush = async () => {
            if (driver.flush) await driver.flush();
        };
        const domain = expectedDomain(f.host);
        const servingDomain = domain ? domain.slice(1) : f.host;

        // R1: mint grammar. Twenty cold visits, twenty distinct eight-char ids.
        {
            const ids = new Set();
            let allGrammar = true;
            for (let i = 0; i < 20; i++) {
                const res = await driver.handle(makeRequest(f.host, f.pagePath));
                const v = cookieValue(setCookieFor(res, '_kid_sid'));
                if (!v || !KID_SID_MINT_RE.test(v)) allGrammar = false;
                if (v) ids.add(v);
            }
            await flush();
            check(
                'R1.mint-grammar',
                'cold mints match ^kid_[A-Za-z0-9]{8}$',
                allGrammar,
                `ids: ${[...ids].slice(0, 3).join(', ')}`
            );
            check(
                'R1.mint-distinct',
                'cold mints are distinct',
                ids.size === 20,
                `${ids.size} distinct of 20`
            );
            authority.reset();
            relay.reset();
        }

        // R2: cookie attributes, and absence for bots and declined visitors.
        {
            const res = await driver.handle(makeRequest(f.host, f.pagePath));
            const sid = setCookieFor(res, '_kid_sid');
            check('R2.sid-present', 'cold human gets _kid_sid', !!sid, 'no Set-Cookie _kid_sid');
            if (sid) {
                check('R2.max-age', 'Max-Age=7776000', /;\s*Max-Age=7776000(;|$)/i.test(sid), sid);
                check('R2.path', 'Path=/', /;\s*Path=\/(;|$)/i.test(sid), sid);
                check('R2.samesite', 'SameSite=Lax', /;\s*SameSite=Lax(;|$)/i.test(sid), sid);
                check('R2.secure', 'Secure on https', /;\s*Secure(;|$)/i.test(sid), sid);
                check('R2.not-httponly', 'not HttpOnly', !/HttpOnly/i.test(sid), sid);
                const dm = /;\s*Domain=([^;]+)/i.exec(sid);
                const got = dm ? dm[1].trim() : '';
                check(
                    'R2.domain',
                    `Domain=${domain || '(host-only)'}`,
                    got.toLowerCase() === domain.toLowerCase(),
                    `got Domain=${got || '(none)'}`
                );
            }
            const bot = await driver.handle(
                makeRequest(f.host, f.pagePath, { 'user-agent': BOT_UA })
            );
            check(
                'R2.bot-no-cookie',
                'bot gets no cookie',
                !setCookieFor(bot, '_kid_sid') && !setCookieFor(bot, '_kid_vid')
            );
            const noUa = await driver.handle(makeRequest(f.host, f.pagePath, { 'user-agent': '' }));
            check(
                'R2.noua-no-cookie',
                'missing UA gets no cookie',
                !setCookieFor(noUa, '_kid_sid')
            );
            const denied = await driver.handle(
                makeRequest(f.host, f.pagePath, { 'cf-ipcountry': 'GB' })
            );
            check(
                'R2.denied-no-cookie',
                'GB without consent gets no cookie',
                !setCookieFor(denied, '_kid_sid')
            );
            if (f.consentCookie) {
                const consented = await driver.handle(
                    makeRequest(f.host, f.pagePath, {
                        'cf-ipcountry': 'GB',
                        cookie: f.consentCookie,
                    })
                );
                check(
                    'R2.consented-cookie',
                    'GB with consent gets a cookie',
                    !!setCookieFor(consented, '_kid_sid')
                );
            }
            await flush();
            authority.reset();
            relay.reset();
        }

        // R3: the four branches.
        {
            // threaded
            const tid = 'kid_Thread01';
            const res = await driver.handle(makeRequest(f.host, `${f.pagePath}?kid_sid=${tid}`));
            check(
                'R3.threaded-adopt',
                'threaded id is adopted into the cookie',
                cookieValue(setCookieFor(res, '_kid_sid')) === tid
            );
            await flush();
            const th = authority.requests.find((r) => r.body && r.body.threadedKidSid === tid);
            check(
                'R3.threaded-backstitch',
                'authority told about the threaded hop',
                !!th && !th.body.proposedKidSid
            );
            authority.reset();
            relay.reset();

            // cookie
            const cid = 'kid_Cook0001';
            const res2 = await driver.handle(
                makeRequest(f.host, f.pagePath, { cookie: `_kid_sid=${cid}` })
            );
            check(
                'R3.cookie-no-set',
                'cookie branch sets no new _kid_sid',
                !setCookieFor(res2, '_kid_sid')
            );
            await flush();
            check(
                'R3.cookie-no-network',
                'cookie branch calls no authority',
                authority.requests.length === 0,
                `${authority.requests.length} calls`
            );
            const ev = relay.requests.find((r) => r.body && r.body.clientSessionId === cid);
            check('R3.cookie-session-on-event', 'event carries the cookie id', !!ev);
            authority.reset();
            relay.reset();

            // suppressed (bot): no authority call
            await driver.handle(makeRequest(f.host, f.pagePath, { 'user-agent': BOT_UA }));
            await flush();
            check(
                'R3.suppressed-no-network',
                'suppressed branch calls no authority',
                authority.requests.length === 0
            );
            authority.reset();
            relay.reset();

            // cold: respond before the authority answers
            authority.hang(1500);
            const t0 = Date.now();
            const res3 = await driver.handle(makeRequest(f.host, f.pagePath));
            const dt = Date.now() - t0;
            const minted = cookieValue(setCookieFor(res3, '_kid_sid'));
            check(
                'R3.cold-nonblocking',
                `cold visit responds within ${budget} ms while the authority hangs`,
                dt < budget && !!minted,
                `${dt} ms`
            );
            await flush();
            authority.hang(0);
            const rc = authority.requests.find((r) => r.body && r.body.proposedKidSid === minted);
            check('R3.cold-reconcile', 'reconcile proposes the minted id', !!rc);
            authority.reset();
            relay.reset();
        }

        // R4: the resolve body.
        {
            const res = await driver.handle(
                makeRequest(f.host, `${f.pagePath}?gclid=Cj0KCQjw_abc123&fbclid=IwAR0xyz`)
            );
            const minted = cookieValue(setCookieFor(res, '_kid_sid'));
            await flush();
            const rc = authority.requests.find((r) => r.body && r.body.proposedKidSid === minted);
            check('R4.reconcile-sent', 'a reconcile was sent', !!rc);
            if (rc) {
                const keys = Object.keys(rc.body);
                const extra = keys.filter((k) => !RESOLVE_BODY_KEYS.has(k));
                check(
                    'R4.keys',
                    'only declared field names',
                    extra.length === 0,
                    `extra: ${extra.join(', ')}`
                );
                check(
                    'R4.key-header',
                    'X-Kismet-Tracking-Key sent',
                    rc.headers['x-kismet-tracking-key'] === trackingKey
                );
                check(
                    'R4.collection',
                    'collectionSlug set',
                    rc.body.collectionSlug === collectionSlug
                );
                check(
                    'R4.ip',
                    'ip is the visitor first hop',
                    rc.body.ip === '203.0.113.7',
                    `ip=${rc.body.ip}`
                );
                check('R4.ua', 'userAgent is the visitor UA', rc.body.userAgent === HUMAN_UA);
                check(
                    'R4.gclid',
                    'gclid from the landing URL',
                    rc.body.gclid === 'Cj0KCQjw_abc123'
                );
                check('R4.fbclid', 'fbclid from the landing URL', rc.body.fbclid === 'IwAR0xyz');
                check(
                    'R4.landing',
                    'landingUrl is the public URL',
                    typeof rc.body.landingUrl === 'string' &&
                        rc.body.landingUrl.includes(f.host) &&
                        rc.body.landingUrl.includes('gclid=')
                );
                check('R4.no-iphash', 'never an ipHash', !('ipHash' in rc.body));
            }
            authority.reset();
            relay.reset();
        }

        // R5: the seed.
        {
            const res = await driver.handle(makeRequest(f.host, f.pagePath));
            const minted = cookieValue(setCookieFor(res, '_kid_sid'));
            const html = await res.text();
            const seedAt = html.indexOf(`window.Kismet._kidSid="${minted}"`);
            const tagAt = html.indexOf('/k.js?c=');
            check('R5.seed-id', 'seed carries the cookie id', seedAt >= 0);
            check(
                'R5.seed-before-tag',
                'seed precedes the k.js tag',
                seedAt >= 0 && tagAt > seedAt
            );
            check(
                'R5.tag-collection',
                'k.js tag names the collection',
                html.includes(`/k.js?c=${encodeURIComponent(collectionSlug)}`)
            );
            const reserved = RESERVED_GLOBALS.filter((g) => html.includes(g));
            check(
                'R5.no-reserved-globals',
                'no reserved k.js globals in HTML',
                reserved.length === 0,
                reserved.join(', ')
            );
            const bot = await driver.handle(
                makeRequest(f.host, f.pagePath, { 'user-agent': BOT_UA })
            );
            const bhtml = await bot.text();
            check(
                'R5.suppressed-seed',
                'bot page seeds _sidSuppressed and no id',
                bhtml.includes('_sidSuppressed=1') && !bhtml.includes('_kidSid="')
            );
            await flush();
            authority.reset();
            relay.reset();
        }

        // R6: content events.
        {
            const res = await driver.handle(makeRequest(f.host, f.pagePath));
            const minted = cookieValue(setCookieFor(res, '_kid_sid'));
            await flush();
            const ev = relay.requests.find((r) => r.body && r.body.clientSessionId === minted);
            check('R6.human-event', 'human page emits one server event with the session', !!ev);
            if (ev) {
                check('R6.mode', "trackingMode 'server'", ev.body.trackingMode === 'server');
                check(
                    'R6.key-header',
                    'X-Kismet-Tracking-Key on the event',
                    ev.headers['x-kismet-tracking-key'] === trackingKey
                );
                check(
                    'R6.serving-domain',
                    `servingDomain ${servingDomain}`,
                    ev.body.servingDomain === servingDomain,
                    `got ${ev.body.servingDomain}`
                );
                check('R6.ua-raw', 'raw userAgent', ev.body.userAgent === HUMAN_UA);
                check(
                    'R6.page-url',
                    'pageUrl is the public URL',
                    typeof ev.body.pageUrl === 'string' &&
                        ev.body.pageUrl.startsWith(`https://${f.host}${f.pagePath}`),
                    ev.body.pageUrl
                );
                check(
                    'R6.plain-view',
                    'plain page is view / content_vrm',
                    ev.body.actionType === 'view' && ev.body.resourceClass === 'content_vrm'
                );
                check(
                    'R6.referrer',
                    'referrer forwarded raw',
                    ev.body.referrer === 'https://chatgpt.com/'
                );
                check('R6.no-iphash', 'never an ipHash', !('ipHash' in ev.body));
            }
            relay.reset();

            await driver.handle(makeRequest(f.host, f.pagePath, { 'user-agent': BOT_UA }));
            await flush();
            const bev = relay.requests[0];
            check('R6.bot-event', 'bot page emits an event', !!bev);
            if (bev) {
                check(
                    'R6.bot-null-session',
                    'bot event has null session',
                    bev.body.clientSessionId === null
                );
                check('R6.bot-hint', 'bot hint set', bev.body.isBot === true);
            }
            relay.reset();

            await driver.handle(
                makeRequest(f.host, f.pagePath, {
                    'user-agent': BOT_UA,
                    cookie: '_kid_sid=kid_Human001',
                })
            );
            await flush();
            const echo = relay.requests[0];
            check(
                'R6.bot-echo-null',
                'a bot echoing a session cookie still gets null',
                !!echo && echo.body.clientSessionId === null
            );
            relay.reset();

            const agentPath = f.agentPath || '/llms.txt';
            const ares = await driver.handle(makeRequest(f.host, agentPath));
            await flush();
            const aev = relay.requests[0];
            check('R6.agent-event', 'agent surface emits an event', !!aev);
            if (aev) {
                check(
                    'R6.agent-fetch',
                    "agent surface is actionType 'fetch'",
                    aev.body.actionType === 'fetch'
                );
                check(
                    'R6.agent-null-session',
                    'agent event has null session',
                    aev.body.clientSessionId === null
                );
            }
            check(
                'R6.agent-no-cookie',
                'agent surface sets no cookie',
                !setCookieFor(ares, '_kid_sid')
            );
            relay.reset();

            await driver.handle(
                makeRequest(
                    f.host,
                    `${f.propertyPath}?checkin=2026-10-03&checkout=2026-10-06&guests=4`
                )
            );
            await flush();
            const pev = relay.requests[0];
            check('R6.property-event', 'property page emits an event', !!pev);
            if (pev) {
                check(
                    'R6.property-class',
                    'property page is property_view / content_vr',
                    pev.body.actionType === 'property_view' &&
                        pev.body.resourceClass === 'content_vr',
                    `${pev.body.actionType} / ${pev.body.resourceClass}`
                );
                check(
                    'R6.property-id',
                    `${f.propertyIdField} = ${f.propertyId}`,
                    pev.body[f.propertyIdField] === f.propertyId,
                    `got ${String(pev.body[f.propertyIdField])}`
                );
                check(
                    'R6.property-stay',
                    'stay dates and guests parsed',
                    pev.body.stayCheckIn === '2026-10-03' &&
                        pev.body.stayCheckOut === '2026-10-06' &&
                        pev.body.guestCount === 4
                );
            }
            relay.reset();

            if (f.intentPath) {
                await driver.handle(
                    makeRequest(
                        f.host,
                        `${f.intentPath}?checkin=2026-10-03&checkout=2026-10-06&guests=2`
                    )
                );
                await flush();
                const iev = relay.requests[0];
                check(
                    'R6.intent-event',
                    'intent path emits cta_click with the stay',
                    !!iev &&
                        iev.body.actionType === 'cta_click' &&
                        iev.body.stayCheckIn === '2026-10-03'
                );
                relay.reset();
            }
            authority.reset();
        }

        // R7: cache-control on a seeded response.
        {
            const res = await driver.handle(makeRequest(f.host, f.pagePath));
            const cc = (res.headers.get('cache-control') || '').toLowerCase();
            check(
                'R7.cache-control',
                'seeded response is private, no-store',
                cc.includes('private') && cc.includes('no-store'),
                cc || '(none)'
            );
            await flush();
            authority.reset();
            relay.reset();
        }

        // R8: nothing waits on Kismet.
        {
            authority.hang(3000);
            relay.hang(3000);
            const t0 = Date.now();
            const res = await driver.handle(makeRequest(f.host, f.pagePath));
            const dt = Date.now() - t0;
            check(
                'R8.cold-budget',
                `cold visit within ${budget} ms with authority and relay hanging`,
                dt < budget && res.status === 200,
                `${dt} ms`
            );
            const t1 = Date.now();
            await driver.handle(
                makeRequest(f.host, f.propertyPath, { cookie: '_kid_sid=kid_Cook0002' })
            );
            const dt2 = Date.now() - t1;
            check(
                'R8.warm-budget',
                `warm visit within ${budget} ms with the relay hanging`,
                dt2 < budget,
                `${dt2} ms`
            );
            authority.hang(0);
            relay.hang(0);
            await flush();
        }
    } finally {
        await authority.close();
        await relay.close();
    }

    const failed = results.filter((r) => !r.ok).length;
    return { ok: failed === 0, passed: results.length - failed, failed, results };
}

/**
 * One-line-per-check text for a test failure message.
 * @param {ConformanceReport} report
 * @returns {string}
 */
export function formatReport(report) {
    return report.results
        .map(
            (r) =>
                `${r.ok ? 'PASS' : 'FAIL'} ${r.id.padEnd(26)} ${r.name}${r.ok ? '' : `  [${r.detail}]`}`
        )
        .join('\n');
}
