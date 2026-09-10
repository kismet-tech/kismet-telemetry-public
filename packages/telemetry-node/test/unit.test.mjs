import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
    kismetTelemetry,
    kismetSeedHtml,
    toWebRequest,
    readKismetState,
    CONTRACT_VERSION,
} from '../dist/esm/index.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function fakeReq(url, headers = {}, { encrypted = true } = {}) {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = url;
    req.headers = {
        host: 'www.example.com',
        'user-agent': 'Mozilla/5.0 Chrome/128 Safari/537.36',
        ...headers,
    };
    req.socket = { encrypted };
    return req;
}

function fakeRes() {
    const headers = new Map();
    return {
        locals: {},
        setHeader: (k, v) => headers.set(k.toLowerCase(), v),
        getHeader: (k) => headers.get(k.toLowerCase()),
        headers,
    };
}

function run(middleware, req, res) {
    return new Promise((resolve) => middleware(req, res, resolve));
}

test('contract version, CJS entry', () => {
    assert.equal(CONTRACT_VERSION, '1.0');
    const cjs = require('../dist/cjs/index.js');
    assert.equal(typeof cjs.kismetTelemetry, 'function');
    assert.equal(cjs.CONTRACT_VERSION, '1.0');
});

test('kismetSeedHtml: seed then tag in one script, suppression, nothing when neither', () => {
    const html = kismetSeedHtml({ kidSid: 'kid_Ab3dE9xZ', suppressed: false }, 'sea-view-stays');
    const seedAt = html.indexOf('window.Kismet._kidSid="kid_Ab3dE9xZ"');
    const tagAt = html.indexOf('https://kismet.travel/k.js?c=sea-view-stays');
    assert.ok(seedAt >= 0 && tagAt > seedAt, html);
    assert.equal((html.match(/<script>/g) || []).length, 1, 'one inline script');
    const sup = kismetSeedHtml({ kidSid: null, suppressed: true }, 'x');
    assert.ok(sup.includes('_sidSuppressed=1') && !sup.includes('_kidSid="'));
    assert.ok(!sup.includes('createElement'));
    assert.ok(!sup.includes('src='));
    assert.equal(kismetSeedHtml({ kidSid: null, suppressed: false }, 'x'), '');
    assert.equal(kismetSeedHtml({ kidSid: 'kid_"><script>', suppressed: false }, 'x'), '');
});

test('toWebRequest rebuilds the public URL from forwarded headers', () => {
    const req = fakeReq(
        '/stays/porthleven/harbour-house?in=2026-10-03',
        {
            host: '10.0.0.5:3000',
            'x-forwarded-host': 'www.example.com',
            'x-forwarded-proto': 'https',
        },
        { encrypted: false }
    );
    const r = toWebRequest(req);
    // toWebRequest keeps the socket view; the resolver applies publicUrl.
    assert.equal(new URL(r.url).pathname, '/stays/porthleven/harbour-house');
    assert.equal(r.headers.get('x-forwarded-host'), 'www.example.com');
});

test('cold human: cookie on the dotted domain, seed on the request and res.locals, private no-store', async () => {
    const mw = kismetTelemetry({ collectionSlug: 'lab', trackingKey: '', profile: {} });
    const req = fakeReq('/about');
    const res = fakeRes();
    await run(mw, req, res);
    const state = readKismetState(req);
    assert.ok(state && state.kidSid && /^kid_[A-Za-z0-9]{8}$/.test(state.kidSid));
    assert.equal(res.locals.kismet, state);
    assert.equal(state.tier, 'minted');
    assert.ok(state.seed.includes(`_kidSid="${state.kidSid}"`));
    assert.equal(res.getHeader('cache-control'), 'private, no-store');
    assert.equal(res.getHeader('x-kismet-anchor-tier'), 'minted');
    const cookies = res.getHeader('set-cookie');
    assert.ok(Array.isArray(cookies) && cookies.length === 1);
    assert.match(
        cookies[0],
        /^_kid_sid=kid_[A-Za-z0-9]{8}; Domain=\.example\.com; Path=\/; Max-Age=7776000; SameSite=Lax; Secure$/
    );
    await mw.flush();
});

test('existing Set-Cookie header is kept', async () => {
    const mw = kismetTelemetry({ collectionSlug: 'lab', trackingKey: '', profile: {} });
    const req = fakeReq('/about');
    const res = fakeRes();
    res.setHeader('Set-Cookie', 'theme=dark; Path=/');
    await run(mw, req, res);
    const cookies = res.getHeader('set-cookie');
    assert.equal(cookies.length, 2);
    assert.equal(cookies[0], 'theme=dark; Path=/');
    await mw.flush();
});

test('bot: no cookie, suppression seed; asset: untouched', async () => {
    const mw = kismetTelemetry({ collectionSlug: 'lab', trackingKey: '', profile: {} });
    const bot = fakeReq('/about', {
        'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    });
    const res = fakeRes();
    await run(mw, bot, res);
    assert.equal(res.getHeader('set-cookie'), undefined);
    assert.ok(bot.kismet.suppressed && bot.kismet.seed.includes('_sidSuppressed=1'));
    const asset = fakeReq('/static/app.css');
    const res2 = fakeRes();
    await run(mw, asset, res2);
    assert.equal(asset.kismet, undefined);
    assert.equal(res2.getHeader('cache-control'), undefined);
    await mw.flush();
});

test('a broken request still reaches next()', async () => {
    const mw = kismetTelemetry({ collectionSlug: 'lab', trackingKey: '', profile: {} });
    const req = fakeReq('/about');
    req.headers = null; // Object.entries(null) throws inside toWebRequest
    const res = fakeRes();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        await run(mw, req, res);
    } finally {
        console.warn = originalWarn;
    }
    assert.equal(req.kismet, undefined);
});
