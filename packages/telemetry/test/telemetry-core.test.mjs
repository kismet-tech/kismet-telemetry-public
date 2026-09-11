import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CONTRACT_VERSION,
    COOKIE_CONSENT_DENY,
    countryAllowsCookies,
    resolveConsent,
    consentFromCookie,
    cookieDomainFor,
    buildCookie,
    readCookie,
    publicUrl,
    isHttps,
    renderSeed,
    renderSeedScript,
    classifyRequest,
    prefersMarkdown,
    resolveVisitor,
    isBotUserAgent,
    KID_SID_MINT_RE,
    buildContentEvent,
    postBookingBridge,
    postQuoteCapture,
    isValidConfirmationCode,
} from '../src/index.js';
import { createStubAuthority } from '../src/conformance/index.js';

const UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128 Safari/537.36';

test('contract version is pinned', () => {
    assert.equal(CONTRACT_VERSION, '1.0');
});

test('consent: country default denies unknown, denies EU/EEA/GB/CH; hook overrides; hook failure is fail-closed', async () => {
    assert.equal(COOKIE_CONSENT_DENY.size, 32);
    for (const country of [null, undefined, '', 'XX', 'T1', 'ZZ', 'invalid']) {
        assert.equal(countryAllowsCookies(country), false);
    }
    assert.equal(countryAllowsCookies('US'), true);
    assert.equal(countryAllowsCookies('gb'), false);
    assert.equal(countryAllowsCookies('CH'), false);
    const headers = new Headers({ cookie: 'CookieConsent=statistics:true' });
    const ctx = { country: 'GB', headers, url: new URL('https://example.co.uk/') };
    assert.equal(await resolveConsent(null, ctx), false);
    assert.equal(await resolveConsent(() => true, ctx), true);
    assert.equal(await resolveConsent(() => 'yes', ctx), false, 'non-boolean is no');
    assert.equal(
        await resolveConsent(() => {
            throw new Error('cmp down');
        }, ctx),
        false
    );
    assert.equal(
        await resolveConsent(consentFromCookie('CookieConsent', /statistics:true/), ctx),
        true
    );
    assert.equal(
        await resolveConsent(consentFromCookie('CookieConsent', /statistics:false/), ctx),
        false
    );
    assert.equal(await resolveConsent(consentFromCookie('Other'), ctx), false);
});

test('cookies: dotted domain rule, host-only for single-label and IPs, override wins; attributes per contract', () => {
    assert.equal(cookieDomainFor('www.example.co.uk'), '.example.co.uk');
    assert.equal(cookieDomainFor('example.co.uk:8443'), '.example.co.uk');
    assert.equal(cookieDomainFor('book.example.com'), '.book.example.com');
    assert.equal(cookieDomainFor('book.example.com', 'example.com'), '.example.com');
    assert.equal(cookieDomainFor('localhost'), '');
    assert.equal(cookieDomainFor('localhost:3000'), '');
    assert.equal(cookieDomainFor('127.0.0.1'), '');
    const c = buildCookie('_kid_sid', 'kid_Ab3dE9xZ', {
        maxAge: 7776000,
        domain: '.example.com',
        secure: true,
    });
    assert.equal(
        c,
        '_kid_sid=kid_Ab3dE9xZ; Domain=.example.com; Path=/; Max-Age=7776000; SameSite=Lax; Secure'
    );
    assert.ok(!/HttpOnly/.test(c));
    const h = buildCookie('_kid_sid', 'kid_Ab3dE9xZ', {
        maxAge: 7776000,
        domain: '',
        secure: false,
    });
    assert.equal(h, '_kid_sid=kid_Ab3dE9xZ; Path=/; Max-Age=7776000; SameSite=Lax');
    assert.equal(readCookie('a=1; _kid_sid=kid_Ab3dE9xZ; b=2', '_kid_sid'), 'kid_Ab3dE9xZ');
    assert.equal(readCookie(null, '_kid_sid'), null);
    const hd = new Headers({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'www.example.com' });
    const u = publicUrl(hd, new URL('http://0.0.0.0:8080/units/1?in=2026-10-03'));
    assert.equal(u.toString(), 'https://www.example.com/units/1?in=2026-10-03');
    assert.equal(isHttps(hd, new URL('http://0.0.0.0:8080/')), true);
    assert.equal(isHttps(new Headers(), new URL('http://localhost/')), false);
});

test('seed: id then tag, suppression flag, nothing when neither, grammar-checked', () => {
    const s = renderSeed({ kidSid: 'kid_Ab3dE9xZ', collectionSlug: 'sea-view-stays' });
    assert.equal(
        s,
        '<script>window.Kismet=window.Kismet||{};window.Kismet._kidSid="kid_Ab3dE9xZ";</script><script async src="https://kismet.travel/k.js?c=sea-view-stays"></script>'
    );
    assert.equal(
        renderSeedScript({ suppressed: true }),
        '<script>window.Kismet=window.Kismet||{};window.Kismet._sidSuppressed=1;delete window.Kismet._kidSid;</script>'
    );
    assert.ok(!renderSeed({ suppressed: true, collectionSlug: 'x' }).includes('src='));
    assert.equal(renderSeed({ kidSid: null, collectionSlug: 'x' }), '');
    assert.equal(renderSeedScript({ kidSid: 'kid_"><script>' }), '');
});

test('route profile: agent, excluded, intent, property (function and pattern), search, stay parsing', () => {
    const profile = {
        property: { pattern: /^\/stays\/[^/]+\/([^/]+)\/?$/, as: 'externalListingId' },
        searchPaths: ['/stays', /^\/stays\/in\//],
        intent: { path: '/stays/checkout', propertyParam: 'listing' },
    };
    const c = (p, accept) =>
        classifyRequest(new URL('https://example.co.uk' + p), profile, { accept });
    assert.equal(c('/llms.txt').kind, 'agent');
    assert.equal(c('/stays/porthleven/x.md').kind, 'agent');
    assert.equal(c('/stays/porthleven/x', 'text/markdown, text/html;q=0.5').kind, 'agent');
    assert.equal(c('/stays/porthleven/x', 'text/html,*/*;q=0.8').kind, 'property');
    assert.equal(c('/_next/static/a.js').kind, 'excluded');
    assert.equal(c('/api/quote').kind, 'excluded');
    assert.equal(c('/images/a.png').kind, 'excluded');
    assert.equal(c('/stays').kind, 'search');
    assert.equal(c('/stays/in/falmouth').kind, 'search');
    const prop = c('/stays/porthleven/harbour-house?in=2026-10-03&out=2026-10-06&party=4');
    assert.equal(prop.kind, 'property');
    assert.equal(prop.externalListingId, 'harbour-house');
    assert.equal(prop.vrSlug, null);
    assert.deepEqual(
        [prop.stayCheckIn, prop.stayCheckOut, prop.guestCount],
        ['2026-10-03', '2026-10-06', 4]
    );
    const intent = c(
        '/stays/checkout?listing=0123456789abcdef01234567&checkin=10/03/2026&checkout=10/06/2026&guests=2'
    );
    assert.equal(intent.kind, 'intent');
    assert.equal(intent.externalListingId, '0123456789abcdef01234567');
    assert.equal(intent.stayCheckIn, '2026-10-03');
    assert.equal(c('/about').kind, 'page');
    assert.equal(
        classifyRequest(new URL('https://x.com/p'), null, { method: 'POST' }).kind,
        'excluded'
    );
    const fn = classifyRequest(new URL('https://x.com/units/412'), {
        property: (u) => (u.pathname.startsWith('/units/') ? { vrSlug: 'unit-412' } : null),
    });
    assert.equal(fn.kind, 'property');
    assert.equal(fn.vrSlug, 'unit-412');
    assert.equal(prefersMarkdown('text/html'), false);
    assert.equal(prefersMarkdown(null), false);
});

test('content event: externalListingId makes a property page and is conditional; absent by default (worker parity)', () => {
    const base = {
        pageUrl: 'https://x.com/p',
        domain: 'x.com',
        collectionSlug: 'c',
        vrSlug: null,
        userAgent: UA,
        country: null,
        referrer: null,
        clientSessionId: 'kid_Ab3dE9xZ',
    };
    const plain = buildContentEvent(base);
    assert.ok(!('externalListingId' in plain));
    assert.equal(plain.actionType, 'view');
    const withId = buildContentEvent({ ...base, externalListingId: '0123456789abcdef01234567' });
    assert.equal(withId.externalListingId, '0123456789abcdef01234567');
    assert.equal(withId.resourceClass, 'content_vr');
    assert.equal(withId.actionType, 'property_view');
    assert.equal(withId.vacationRentalSlug, null);
});

test('isBotUserAgent: vocabulary, generic clients, missing UA, humans', () => {
    assert.equal(isBotUserAgent('GPTBot/1.2'), true);
    assert.equal(isBotUserAgent('curl/8.4'), true);
    assert.equal(isBotUserAgent('curl/8.4', false), false, 'generic policy off');
    assert.equal(isBotUserAgent(''), true);
    assert.equal(isBotUserAgent(null), true);
    assert.equal(isBotUserAgent(UA), false);
});

test('resolveVisitor: current consent overrides cookie and threaded carriers', async () => {
    for (const carrier of ['cookie', 'threaded']) {
        const result = await resolveVisitor({
            url: new URL(
                `https://example.com/${carrier === 'threaded' ? '?kid_sid=kid_Thread01' : ''}`
            ),
            headers: new Headers({
                'user-agent': UA,
                cookie: carrier === 'cookie' ? '_kid_sid=kid_Cook0001; _kid_vid=vid_abcdef' : '',
            }),
            collectionSlug: 'example-collection',
            trackingKey: 'ctk_test',
            consent: () => false,
        });
        assert.equal(result.suppressed, true);
        assert.equal(result.kidSid, null);
        assert.equal(result.kidVid, null);
        assert.equal(result.setSid, false);
        assert.equal(result.reconcile, null);
    }
});

test('resolveVisitor: threaded, cookie, suppressed (bot / no consent), cold mint + reconcile, authorityFirst, no key', async () => {
    const authority = await createStubAuthority({ trackingKey: 'ctk_test' });
    try {
        const url = new URL('https://www.example.com/p?gclid=abc123');
        const base = {
            url,
            collectionSlug: 'lab',
            trackingKey: 'ctk_test',
            resolveEndpoint: authority.url + '/v1/identity/resolve-anchor',
        };
        const H = (/** @type {Record<string,string>} */ extra) =>
            new Headers({
                'user-agent': UA,
                'cf-ipcountry': 'US',
                'x-forwarded-for': '203.0.113.7',
                ...extra,
            });

        // threaded
        const t = await resolveVisitor({
            ...base,
            url: new URL(url + '&kid_sid=kid_Thread01'),
            headers: H({}),
        });
        assert.equal(t.tier, 'threaded');
        assert.equal(t.kidSid, 'kid_Thread01');
        assert.equal(t.setSid, true);
        await t.reconcile;
        assert.equal(authority.requests.length, 1);
        assert.equal(authority.requests[0].body.threadedKidSid, 'kid_Thread01');
        assert.equal(authority.requests[0].body.gclid, 'abc123');
        assert.equal(authority.requests[0].body.ip, '203.0.113.7');
        assert.equal(authority.requests[0].headers['x-kismet-tracking-key'], 'ctk_test');
        authority.reset();

        // threaded id already the cookie: no Set-Cookie
        const t2 = await resolveVisitor({
            ...base,
            url: new URL(url + '&kid_sid=kid_Thread01'),
            headers: H({ cookie: '_kid_sid=kid_Thread01' }),
        });
        assert.equal(t2.setSid, false);
        await t2.reconcile;
        authority.reset();

        // cookie
        const c = await resolveVisitor({
            ...base,
            headers: H({ cookie: '_kid_sid=kid_Cook0001; _kid_vid=vid_abcdef' }),
        });
        assert.equal(c.tier, 'cookie');
        assert.equal(c.kidSid, 'kid_Cook0001');
        assert.equal(c.kidVid, 'vid_abcdef');
        assert.equal(c.setSid, false);
        assert.equal(c.reconcile, null);
        assert.equal(authority.requests.length, 0);

        // bad cookie grammar falls through to a mint
        const bad = await resolveVisitor({ ...base, headers: H({ cookie: '_kid_sid=nope' }) });
        assert.equal(bad.tier, 'minted');
        await bad.reconcile;
        authority.reset();

        // suppressed: bot, even with a cookie
        const b = await resolveVisitor({
            ...base,
            headers: H({ 'user-agent': 'GPTBot/1.2', cookie: '_kid_sid=kid_Cook0001' }),
        });
        assert.equal(b.tier, 'suppressed');
        assert.equal(b.kidSid, null);
        assert.equal(b.isBot, true);
        assert.equal(authority.requests.length, 0);

        // suppressed: no consent (GB, default gate)
        const d = await resolveVisitor({ ...base, headers: H({ 'cf-ipcountry': 'GB' }) });
        assert.equal(d.tier, 'suppressed');
        assert.equal(d.consented, false);
        // consent hook says yes → mint
        const e = await resolveVisitor({
            ...base,
            headers: H({ 'cf-ipcountry': 'GB' }),
            consent: () => true,
        });
        assert.equal(e.tier, 'minted');
        await e.reconcile;
        authority.reset();

        // cold: mint + reconcile with proposedKidSid, response before the authority (hang)
        authority.hang(400);
        const t0 = Date.now();
        const m = await resolveVisitor({ ...base, headers: H({}) });
        assert.ok(Date.now() - t0 < 200, 'cold path did not wait on the authority');
        assert.equal(m.tier, 'minted');
        assert.match(m.kidSid, KID_SID_MINT_RE);
        assert.equal(m.setSid, true);
        await m.reconcile;
        authority.hang(0);
        assert.equal(authority.requests[0].body.proposedKidSid, m.kidSid);
        assert.equal(authority.requests[0].body.landingUrl, url.toString());
        authority.reset();

        // authorityFirst: adopts the authority's answer and its vid
        const a = await resolveVisitor({ ...base, headers: H({}), authorityFirst: true });
        assert.equal(a.tier, 'authority');
        assert.equal(a.kidSid, 'kid_Auth0001');
        assert.equal(a.kidVid, 'vid_stub0001');
        assert.equal(a.setVid, true);
        assert.equal(authority.requests[0].body.proposedKidSid, undefined);
        authority.reset();

        // authorityFirst with the authority down: falls back to the mint
        const down = await resolveVisitor({
            ...base,
            headers: H({}),
            authorityFirst: true,
            resolveEndpoint: 'http://127.0.0.1:9/nope',
            timeouts: { resolve: 200, reconcile: 200 },
        });
        assert.equal(down.tier, 'minted');
        await down.reconcile;

        // no key: local mint, no network
        const nk = await resolveVisitor({ ...base, trackingKey: '', headers: H({}) });
        assert.equal(nk.tier, 'minted');
        assert.equal(nk.reconcile, null);
        assert.equal(authority.requests.length, 0);
    } finally {
        await authority.close();
    }
});

test('conversion clients: validation, headers, endpoints, never throw', async () => {
    assert.equal(isValidConfirmationCode('EX-48213'), true);
    assert.equal(isValidConfirmationCode('platform'), false);
    assert.equal(isValidConfirmationCode('12345'), false);
    /** @type {{ url: string, init: any }[]} */
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
    };
    try {
        const env = { COLLECTION_KEY: 'ctk_test', KISMET_API_ORIGIN: 'https://api.example' };
        const r = await postBookingBridge(env, {
            kidSid: 'kid_Ab3dE9xZ',
            confirmationCode: 'EX-48213',
            bookingEngine: 'custom',
            domain: 'example.co.uk',
        });
        assert.equal(r.ok, true);
        assert.equal(r.status, 201);
        assert.equal(calls[0].url, 'https://api.example/v1/booking-bridge');
        assert.equal(calls[0].init.headers['X-Kismet-Tracking-Key'], 'ctk_test');
        assert.deepEqual(JSON.parse(calls[0].init.body), {
            kidSid: 'kid_Ab3dE9xZ',
            confirmationCode: 'EX-48213',
            bookingEngine: 'custom',
            domain: 'example.co.uk',
        });
        const bad = await postBookingBridge(env, {
            kidSid: 'kid_Ab3dE9xZ',
            confirmationCode: 'platform',
            domain: 'x',
        });
        assert.equal(bad.ok, false);
        assert.equal(calls.length, 1, 'invalid body is not sent');
        const missing = await postBookingBridge(env, { kidSid: 'kid_Ab3dE9xZ', domain: 'x' });
        assert.equal(missing.ok, false);
        const q = await postQuoteCapture(env, {
            kidSid: 'kid_Ab3dE9xZ',
            checkIn: '2026-10-03',
            checkOut: '2026-10-06',
            totalAmountCents: 57500,
            currency: 'GBP',
            domain: 'example.co.uk',
        });
        assert.equal(q.ok, true);
        assert.equal(calls[1].url, 'https://api.example/v1/quote-capture');
        const qf = await postQuoteCapture(env, { kidSid: 'kid_Ab3dE9xZ', totalAmountCents: 575.5 });
        assert.equal(qf.ok, false);
        globalThis.fetch = async () => {
            throw new Error('network down');
        };
        const down = await postBookingBridge(env, {
            kidSid: 'kid_Ab3dE9xZ',
            confirmationCode: 'EX-48213',
            domain: 'x',
        });
        assert.equal(down.ok, false);
        assert.match(down.error, /network down/);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('missing geography suppresses cold and returning visitors before resolution; explicit consent permits them', async () => {
    for (const cookie of ['', '_kid_sid=kid_Warm0001; _kid_ft=old']) {
        const input = {
            url: new URL('https://example.com/?kid_sid=kid_Link0001'),
            headers: new Headers({ 'user-agent': UA, cookie }),
            collectionSlug: 'lab',
            trackingKey: 'ctk_test',
        };
        const denied = await resolveVisitor(input);
        assert.equal(denied.suppressed, true);
        assert.equal(denied.kidSid, null);
        assert.equal(denied.resolveBody, null);
        assert.equal(denied.reconcile, null);
        const granted = await resolveVisitor({
            ...input,
            consent: () => true,
            resolveEndpoint: 'http://127.0.0.1:1',
        });
        assert.equal(granted.kidSid, 'kid_Link0001');
        await granted.reconcile;
    }
});
