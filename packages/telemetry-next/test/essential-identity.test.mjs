import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { createKismetMiddleware, readKismetSeed } from '../dist/index.js';
import { kismetSeedInline } from '../dist/seed.js';

const sid = 'kid_AbCd1234';
const vid = 'vid_' + 'a'.repeat(64);
const ua = 'Mozilla/5.0 Chrome/150';
const request = (path, cookie, headers = {}) =>
    new NextRequest(`https://www.example.test${path}`, {
        headers: { 'user-agent': ua, cookie, 'x-kismet-visitor': '1', ...headers },
    });

test('denial clears recognition but preserves explicitly account-owned SID on both paths', async () => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return Response.json({ ok: true });
    };
    try {
        for (const consent of [
            () => false,
            undefined,
            () => {
                throw Error('CMP down');
            },
        ]) {
            const middleware = createKismetMiddleware({
                collectionSlug: 'example',
                trackingKey: 'test-only',
                visitorRecognition: true,
                essentialIdentity: 'account-owned-sid',
                consent,
                endpoints: {
                    track: 'https://receiver.test/track',
                    resolveAnchor: 'https://authority.test/resolve',
                },
            });
            for (const path of ['/stays/home', '/__kismet/visitor']) {
                const pending = [];
                const response = await middleware(
                    request(path, `_kid_sid=${sid}; _kid_vid=${vid}`),
                    {
                        waitUntil: (p) => pending.push(p),
                    }
                );
                await Promise.all(pending);
                const cookies = response.headers.getSetCookie();
                assert.equal(response.status, 200);
                assert.ok(
                    cookies.every((cookie) => !cookie.startsWith('_kid_sid=')),
                    cookies.join('\n')
                );
                assert.ok(
                    cookies.some(
                        (cookie) =>
                            cookie.startsWith('_kid_vid=;') &&
                            cookie.includes('Domain=.example.test;') &&
                            cookie.includes('Max-Age=0')
                    )
                );
                assert.ok(
                    cookies.some(
                        (cookie) =>
                            cookie.startsWith('_kid_vid=;') &&
                            !cookie.includes('Domain=') &&
                            cookie.includes('Max-Age=0')
                    )
                );
                if (path !== '/__kismet/visitor') {
                    const seed = readKismetSeed({
                        get: (name) => response.headers.get('x-middleware-request-' + name),
                    });
                    assert.equal(seed.kidSid, null);
                    assert.equal(seed.suppressed, true);
                    const inline = kismetSeedInline({
                        ...seed,
                        collectionSlug: 'example',
                        visitorRecognition: true,
                    });
                    assert.ok(!inline.includes(sid));
                    assert.ok(!inline.includes('fetch(') && !inline.includes('createElement'));
                }
            }
        }
        assert.equal(
            calls.length,
            3,
            'only sessionless page receipts, never the visitor authority'
        );
        assert.ok(
            calls.every(
                (call) =>
                    call.url === 'https://receiver.test/track' && call.body.clientSessionId === null
            )
        );
        assert.ok(
            calls.every(
                (call) =>
                    !JSON.stringify(call.body).includes(sid) &&
                    !JSON.stringify(call.body).includes(vid)
            )
        );
    } finally {
        globalThis.fetch = original;
    }
});

test('default denial still deletes telemetry-owned SID on the page and visitor endpoint', async () => {
    const middleware = createKismetMiddleware({
        collectionSlug: 'example',
        trackingKey: '',
        visitorRecognition: true,
        consent: () => false,
    });
    for (const path of ['/stays/home', '/__kismet/visitor']) {
        const response = await middleware(request(path, `_kid_sid=${sid}; _kid_vid=${vid}`), {
            waitUntil() {},
        });
        assert.ok(
            response.headers
                .getSetCookie()
                .some((cookie) => cookie.startsWith('_kid_sid=;') && cookie.includes('Max-Age=0'))
        );
    }
});

test('account-owned setting does not grant bot consent or bypass follow-up origin checks', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => assert.fail('must not call authority');
    try {
        const middleware = createKismetMiddleware({
            collectionSlug: 'example',
            trackingKey: 'test-only',
            visitorRecognition: true,
            essentialIdentity: 'account-owned-sid',
            consent: () => true,
        });
        const bot = await middleware(
            request('/__kismet/visitor', `_kid_sid=${sid}; _kid_vid=${vid}`, {
                'user-agent': 'Googlebot',
            }),
            { waitUntil() {} }
        );
        assert.ok(bot.headers.getSetCookie().every((cookie) => !cookie.startsWith('_kid_sid=')));
        assert.ok(bot.headers.getSetCookie().some((cookie) => cookie.startsWith('_kid_vid=;')));
        const foreign = await middleware(
            request('/__kismet/visitor', `_kid_sid=${sid}`, { origin: 'https://foreign.test' }),
            { waitUntil() {} }
        );
        assert.equal(foreign.status, 403);
        assert.equal(foreign.headers.getSetCookie().length, 0);
    } finally {
        globalThis.fetch = original;
    }
});
