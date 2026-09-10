// Unit tests for @kismet-tech/edge-events. Runs on plain `node --test` (Node 20+),
// no framework, no network: fetch is stubbed per test.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BOT_PATTERN_ROWS,
    BOT_NAMES,
    detectBot,
    normalizePath,
    pathSuffix,
    OBSERVE_AGENT_SUFFIXES,
    observeShouldTrack,
    KID_SID_RE,
    extractKidSid,
    extractClickIds,
    mintLocalKidSid,
    setKidSidCookie,
    buildResolveAnchorBody,
    parseResolveAnchorResponse,
    postResolveAnchor,
    resolveAnchorEndpoint,
    normalizeServingDomain,
    buildContentEvent,
    fireContentEvent,
    DEFAULT_TRACKING_ENDPOINT,
    parseStayDate,
    parseGuestCount,
    parsePromoCode,
} from '../src/index.js';

const req = (url, headers = {}) => new Request(url, { headers });

test('bot vocabulary: generated rows are the JSON, compiled once, in order', () => {
    assert.ok(BOT_PATTERN_ROWS.length >= 37);
    assert.equal(BOT_NAMES[0], 'GPTBot');
    // Specific-before-general order survives generation.
    assert.ok(BOT_NAMES.indexOf('Applebot-Extended') < BOT_NAMES.indexOf('Applebot'));
    assert.ok(BOT_NAMES.indexOf('ChatGPT-User') < BOT_NAMES.indexOf('OAI-SearchBot'));
});

test('detectBot: named bots, humans, empty', () => {
    assert.deepEqual(
        detectBot('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)'),
        {
            isBot: true,
            botName: 'GPTBot',
            botCategory: 'training',
        }
    );
    assert.deepEqual(detectBot('Claude-User/1.0; +Claude-User@anthropic.com'), {
        isBot: true,
        botName: 'Claude-User',
        botCategory: 'citation',
    });
    assert.deepEqual(detectBot('Mozilla/5.0 (Macintosh) Chrome/140 Safari/537.36'), {
        isBot: false,
        botName: null,
        botCategory: null,
    });
    assert.deepEqual(detectBot(null), { isBot: false, botName: null, botCategory: null });
    assert.deepEqual(detectBot(''), { isBot: false, botName: null, botCategory: null });
});

test('normalizePath / pathSuffix', () => {
    assert.equal(normalizePath('/a/b/'), '/a/b');
    assert.equal(normalizePath('/'), '/');
    assert.equal(normalizePath(''), '/');
    assert.equal(normalizePath('/x?y=1'), '/x');
    assert.equal(pathSuffix('/post.MD'), '.md');
    assert.equal(pathSuffix('/post'), '');
    assert.ok(OBSERVE_AGENT_SUFFIXES.has('.txt'));
});

test('observeShouldTrack: GET pages + agent surfaces yes; WP plumbing, static, non-GET no', () => {
    const t = (method, path) => observeShouldTrack({ method }, { pathname: path });
    assert.equal(t('GET', '/some-page/'), true);
    assert.equal(t('GET', '/llms.txt'), true);
    assert.equal(t('GET', '/post.md'), true);
    assert.equal(t('GET', '/sitemap.xml'), true);
    assert.equal(t('GET', '/wp-admin/edit.php'), false);
    assert.equal(t('GET', '/wp-json/wp/v2/posts'), false);
    assert.equal(t('GET', '/wp-json'), false);
    assert.equal(t('GET', '/wp-login.php'), false);
    assert.equal(t('GET', '/favicon.ico'), false);
    assert.equal(t('GET', '/theme/style.css'), false);
    assert.equal(t('POST', '/some-page/'), false);
});

test('extractKidSid: adopt-only, strict grammar, query before cookie', () => {
    assert.equal(
        extractKidSid(new URL('https://x.com/?kid_sid=kid_Cnf0rm42'), req('https://x.com/')),
        'kid_Cnf0rm42'
    );
    assert.equal(
        extractKidSid(
            new URL('https://x.com/'),
            req('https://x.com/', { cookie: 'a=1; _kid_sid=kid_c00kie01; b=2' })
        ),
        'kid_c00kie01'
    );
    assert.equal(
        extractKidSid(
            new URL('https://x.com/?kid_sid=kid_Cnf0rm42'),
            req('https://x.com/', { cookie: '_kid_sid=kid_c00kie01' })
        ),
        'kid_Cnf0rm42'
    );
    assert.equal(
        extractKidSid(new URL('https://x.com/?kid_sid=kid_<script>'), req('https://x.com/')),
        null
    );
    assert.equal(extractKidSid(new URL('https://x.com/?kid_sid=abc'), req('https://x.com/')), null);
    assert.equal(
        extractKidSid(
            new URL('https://x.com/'),
            req('https://x.com/', { cookie: '_kid_sid=nope' })
        ),
        null
    );
});

test('mintLocalKidSid: kid_ + exactly 8 alnum (the authority adopt grammar)', () => {
    for (let i = 0; i < 50; i++) {
        const s = mintLocalKidSid();
        assert.match(s, /^kid_[A-Za-z0-9]{8}$/);
        assert.match(s, KID_SID_RE);
    }
});

test('extractClickIds: guarded charset/length, gad_campaignid mapping', () => {
    const ids = extractClickIds(
        new URL('https://x.com/?gclid=Cj0K.Q_jw-1&gad_campaignid=123&fbclid=IwAR0abc&wbraid=<x>')
    );
    assert.deepEqual(ids, {
        gclid: 'Cj0K.Q_jw-1',
        gbraid: null,
        wbraid: null,
        gadCampaignId: '123',
        fbclid: 'IwAR0abc',
    });
});

test('setKidSidCookie: apex-scoped, not HttpOnly, no-op without carrier', () => {
    const r = new Response('x');
    setKidSidCookie(r, 'kid_ABCDEFGH', 'example.com');
    assert.equal(
        r.headers.get('set-cookie'),
        '_kid_sid=kid_ABCDEFGH; Domain=.example.com; Path=/; Max-Age=7776000; Secure; SameSite=Lax'
    );
    const r2 = new Response('x');
    setKidSidCookie(r2, null, 'example.com');
    assert.equal(r2.headers.get('set-cookie'), null);
});

test('buildResolveAnchorBody: worker field order; undefined threaded/cookie ids vanish from JSON', () => {
    const body = buildResolveAnchorBody({
        collectionSlug: 'c',
        vrSlug: null,
        origin: 'example.com',
        proposedKidSid: 'kid_ABCDEFGH',
        ip: '203.0.113.9',
        userAgent: 'ua',
        acceptLanguage: null,
        referrer: null,
        clickIds: { gclid: 'g' },
        landingUrl: 'https://example.com/',
    });
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(body))), [
        'collectionSlug',
        'vrSlug',
        'origin',
        'proposedKidSid',
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
    const threaded = buildResolveAnchorBody({
        collectionSlug: 'c',
        origin: 'example.com',
        threadedKidSid: 'kid_Cnf0rm42',
        cookieKidSid: 'kid_c00kie01',
        landingUrl: 'https://example.com/?kid_sid=kid_Cnf0rm42',
    });
    assert.equal(threaded.threadedKidSid, 'kid_Cnf0rm42');
    assert.equal(threaded.cookieKidSid, 'kid_c00kie01');
    assert.equal('proposedKidSid' in JSON.parse(JSON.stringify(threaded)), false);
});

test('parseResolveAnchorResponse: public shape only, grammar-checked', () => {
    assert.deepEqual(
        parseResolveAnchorResponse({
            ok: true,
            kid_sid: 'kid_AUTH0001',
            kid_vid: 'v',
            isNew: true,
            tier: 'L1',
        }),
        {
            kidSid: 'kid_AUTH0001',
            kidVid: 'v',
            isNew: true,
            tier: 'L1',
        }
    );
    assert.equal(parseResolveAnchorResponse({ ok: false, kid_sid: 'kid_AUTH0001' }), null);
    assert.equal(parseResolveAnchorResponse({ ok: true, kid_sid: 'bad' }), null);
    assert.equal(parseResolveAnchorResponse('nope'), null);
});

test('postResolveAnchor: posts to the env endpoint with the tracking key; failures are null', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ ok: true, kid_sid: 'kid_AUTH0001', kid_vid: null }), {
            status: 200,
        });
    };
    try {
        const r = await postResolveAnchor({ COLLECTION_KEY: 'ctk_x' }, { origin: 'e.com' });
        assert.deepEqual(r, { kidSid: 'kid_AUTH0001', kidVid: null });
        assert.equal(calls[0].url, 'https://api.ksmt.app/v1/identity/resolve-anchor');
        assert.equal(calls[0].init.headers['X-Kismet-Tracking-Key'], 'ctk_x');
        assert.equal(calls[0].init.body, '{"origin":"e.com"}');
        assert.equal(
            resolveAnchorEndpoint({ KISMET_API_ORIGIN: 'https://api.staging.example' }),
            'https://api.staging.example/v1/identity/resolve-anchor'
        );
        assert.equal(
            resolveAnchorEndpoint({ RESOLVE_ANCHOR_ENDPOINT: 'https://x/y' }),
            'https://x/y'
        );

        globalThis.fetch = async () => {
            throw new TypeError('down');
        };
        assert.equal(await postResolveAnchor({}, {}), null);
        globalThis.fetch = async () => new Response('nope', { status: 500 });
        assert.equal(await postResolveAnchor({}, {}), null);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('normalizeServingDomain: apex, no port', () => {
    assert.equal(normalizeServingDomain('www.example.com:443'), 'example.com');
    assert.equal(normalizeServingDomain('example.com'), 'example.com');
    assert.equal(normalizeServingDomain('sub.example.com'), 'sub.example.com');
});

test('buildContentEvent: worker key order + precedence fetch > cta_click > property_view > view', () => {
    const base = {
        pageUrl: 'https://example.com/rentals/1',
        domain: 'example.com',
        collectionSlug: 'c',
        vrSlug: 'p',
        userAgent: 'Mozilla/5.0 Chrome/140',
        clientIp: '203.0.113.9',
        country: 'US',
        city: 'Sarasota',
        region: 'Florida',
        referrer: null,
        clientSessionId: 'kid_ABCDEFGH',
        responseStatus: 200,
    };
    const e = buildContentEvent(base);
    assert.deepEqual(Object.keys(e), [
        'trackingMode',
        'pageUrl',
        'responseStatus',
        'clientSessionId',
        'resourceClass',
        'actionType',
        'collectionSlug',
        'vacationRentalSlug',
        'servingDomain',
        'isBot',
        'botName',
        'botCategory',
        'verifiedBot',
        'userAgent',
        'clientIp',
        'country',
        'city',
        'region',
        'referrer',
    ]);
    assert.equal(e.trackingMode, 'server');
    assert.equal(e.actionType, 'property_view');
    assert.equal(e.resourceClass, 'content_vr');
    assert.equal(
        buildContentEvent({ ...base, agentFetch: true, ctaIntent: true }).actionType,
        'fetch'
    );
    assert.equal(buildContentEvent({ ...base, ctaIntent: true }).actionType, 'cta_click');
    assert.equal(buildContentEvent({ ...base, vrSlug: null }).actionType, 'view');
    assert.equal(buildContentEvent({ ...base, vrSlug: null }).resourceClass, 'content_vrm');
    assert.equal(
        buildContentEvent({ ...base, vrSlug: null, propertyPage: true }).actionType,
        'property_view'
    );
    // Empty stay fields are omitted, present ones ride in worker order.
    const stay = buildContentEvent({
        ...base,
        stayCheckIn: '2026-07-17',
        stayCheckOut: null,
        guestCount: 4,
        promoCode: 'S',
    });
    assert.deepEqual(
        Object.keys(stay).filter((k) =>
            ['stayCheckIn', 'stayCheckOut', 'guestCount', 'promoCode'].includes(k)
        ),
        ['stayCheckIn', 'guestCount', 'promoCode']
    );
    // Bot verdict defaults to detectBot; a caller-supplied verdict wins.
    assert.equal(buildContentEvent({ ...base, userAgent: 'GPTBot/1.2' }).botName, 'GPTBot');
    assert.equal(
        buildContentEvent({ ...base, bot: { isBot: true, botName: 'unknown', botCategory: null } })
            .botName,
        'unknown'
    );
    // Consumer-specific fields appear only when supplied.
    const kt = buildContentEvent({
        ...base,
        trackingMode: 'kismet',
        clientIp: undefined,
        city: undefined,
        region: undefined,
        metaClientIp: '203.0.113.9',
        groupSlug: null,
        referrerSource: 'chatgpt',
        utmSource: 'x',
        exposureDepth: 'full',
    });
    assert.equal(kt.trackingMode, 'kismet');
    assert.equal('clientIp' in kt, false);
    assert.equal('city' in kt, false);
    assert.equal(kt.metaClientIp, '203.0.113.9');
    assert.equal(kt.groupSlug, null);
    assert.equal(kt.referrerSource, 'chatgpt');
    assert.equal(kt.exposureDepth, 'full');
});

test('fireContentEvent: default endpoint, headers, waitUntil, 2s cap, never throws', async () => {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response('{}');
    };
    const waited = [];
    try {
        fireContentEvent(
            { waitUntil: (p) => waited.push(p) },
            { COLLECTION_KEY: 'ctk_x' },
            {
                pageUrl: 'https://e.com/',
                domain: 'e.com',
                collectionSlug: 'c',
                vrSlug: null,
                userAgent: 'ua',
                country: null,
                referrer: null,
                clientSessionId: null,
            }
        );
        await Promise.all(waited);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, DEFAULT_TRACKING_ENDPOINT);
        assert.deepEqual(calls[0].init.headers, {
            'Content-Type': 'application/json',
            'X-Kismet-Tracking-Key': 'ctk_x',
        });
        assert.ok(calls[0].init.signal instanceof AbortSignal);
        assert.equal(JSON.parse(calls[0].init.body).trackingMode, 'server');

        // Ingest-direct emitter: API key + custom endpoint; no ctx ⇒ detached, still no throw.
        fireContentEvent(
            null,
            {
                TRACKING_ENDPOINT: 'https://api.example/v1/content-events',
                API_KEY: 'k',
                COLLECTION_KEY: 'ctk_m',
            },
            {
                trackingMode: 'kismet',
                pageUrl: 'https://e.com/',
                domain: 'e.com',
                collectionSlug: null,
                vrSlug: null,
                userAgent: 'ua',
                country: null,
                referrer: null,
                clientSessionId: null,
            }
        );
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(calls[1].url, 'https://api.example/v1/content-events');
        assert.deepEqual(calls[1].init.headers, {
            'Content-Type': 'application/json',
            'X-API-Key': 'k',
            'X-Kismet-Tracking-Key': 'ctk_m',
        });

        globalThis.fetch = async () => {
            throw new TypeError('down');
        };
        const w2 = [];
        fireContentEvent(
            { waitUntil: (p) => w2.push(p) },
            {},
            {
                pageUrl: 'https://e.com/',
                domain: 'e.com',
                collectionSlug: null,
                vrSlug: null,
                userAgent: null,
                country: null,
                referrer: null,
                clientSessionId: null,
            }
        );
        await Promise.all(w2); // resolves (caught), never rejects
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('parseStayDate / parseGuestCount / parsePromoCode', () => {
    assert.equal(parseStayDate('07/17/2026'), '2026-07-17');
    assert.equal(parseStayDate('7/4/2026'), '2026-07-04');
    assert.equal(parseStayDate('2026-07-17'), '2026-07-17');
    assert.equal(parseStayDate('17-07-2026'), null);
    assert.equal(parseStayDate(null), null);
    assert.equal(parseGuestCount('4'), 4);
    assert.equal(parseGuestCount('0'), null);
    assert.equal(parseGuestCount('100'), null);
    assert.equal(parseGuestCount('x'), null);
    assert.equal(parsePromoCode('  SUMMER '), 'SUMMER');
    assert.equal(parsePromoCode('   '), null);
    assert.equal(parsePromoCode('a'.repeat(100)).length, 64);
});
