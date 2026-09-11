import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { NextRequest } from 'next/server.js';
import {
    createKismetMiddleware,
    readKismetSeed,
    KISMET_MATCHER,
    CONTRACT_VERSION,
} from '../dist/index.js';
import { KismetSeedScripts } from '../dist/seed.js';

test('contract version and matcher', () => {
    assert.equal(CONTRACT_VERSION, '1.0');
    assert.ok(Array.isArray(KISMET_MATCHER) && KISMET_MATCHER.length === 3);
    assert.ok(KISMET_MATCHER.includes('/llms.txt'));
});

test('KismetSeedScripts: seed then tag, suppression, nothing when neither', () => {
    const html = renderToStaticMarkup(
        createElement(KismetSeedScripts, {
            collectionSlug: 'sea-view-stays',
            kidSid: 'kid_Ab3dE9xZ',
            suppressed: false,
        })
    );
    const seedAt = html.indexOf('window.Kismet._kidSid="kid_Ab3dE9xZ"');
    const tagAt = html.indexOf('https://kismet.travel/k.js?c=sea-view-stays');
    assert.ok(seedAt >= 0 && tagAt > seedAt, html);
    const sup = renderToStaticMarkup(
        createElement(KismetSeedScripts, { collectionSlug: 'x', kidSid: null, suppressed: true })
    );
    assert.ok(sup.includes('_sidSuppressed=1') && !sup.includes('_kidSid="'));
    assert.ok(!sup.includes('createElement'));
    assert.ok(!sup.includes('src='));
    const none = renderToStaticMarkup(
        createElement(KismetSeedScripts, { collectionSlug: 'x', kidSid: null, suppressed: false })
    );
    assert.equal(none, '');
    const bad = renderToStaticMarkup(
        createElement(KismetSeedScripts, {
            collectionSlug: 'x',
            kidSid: 'kid_"><script>',
            suppressed: false,
        })
    );
    assert.equal(bad, '', 'an id outside the grammar never reaches the page');
});

test('readKismetSeed reads what the middleware wrote', async () => {
    const middleware = createKismetMiddleware({
        collectionSlug: 'lab',
        trackingKey: '',
        profile: {},
    });
    const pending = [];
    const event = { waitUntil: (p) => pending.push(p) };
    const req = new NextRequest('https://www.example.com/about', {
        headers: {
            'user-agent': 'Mozilla/5.0 Chrome/128 Safari/537.36',
            'x-forwarded-proto': 'https',
            'cf-ipcountry': 'US',
        },
    });
    const res = await middleware(req, event);
    const kid = res.headers.get('x-middleware-request-x-kismet-kid-sid');
    assert.match(kid, /^kid_[A-Za-z0-9]{8}$/);
    const seed = readKismetSeed({ get: (n) => res.headers.get('x-middleware-request-' + n) });
    assert.equal(seed.kidSid, kid);
    assert.equal(seed.suppressed, false);
    assert.equal(seed.tier, 'minted');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('_kid_sid='));
    assert.ok(
        cookie &&
            cookie.includes('Domain=.example.com') &&
            cookie.includes('Secure') &&
            !/HttpOnly/.test(cookie),
        cookie
    );
    await Promise.allSettled(pending);
});

test('middleware never breaks the page: a throwing consent hook still serves', async () => {
    const middleware = createKismetMiddleware({
        collectionSlug: 'lab',
        trackingKey: '',
        consent: () => {
            throw new Error('cmp down');
        },
    });
    const res = await middleware(
        new NextRequest('https://www.example.com/about', {
            headers: { 'user-agent': 'Mozilla/5.0 Chrome/128', 'cf-ipcountry': 'GB' },
        }),
        { waitUntil() {} }
    );
    assert.equal(res.status, 200);
    assert.equal(
        res.headers.get('x-middleware-request-x-kismet-sid-suppressed'),
        '1',
        'fail-closed: no session'
    );
    assert.equal(res.headers.getSetCookie().length, 0);
});

test('excluded paths pass straight through', async () => {
    const middleware = createKismetMiddleware({ collectionSlug: 'lab', trackingKey: '' });
    const res = await middleware(new NextRequest('https://www.example.com/api/health'), {
        waitUntil() {},
    });
    assert.equal(res.headers.get('x-kismet-anchor-tier'), null);
    assert.equal(res.headers.getSetCookie().length, 0);
});
