import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { createKismetMiddleware } from '../dist/index.js';
import { kismetSeedInline } from '../dist/seed.js';
const token = 'vid_' + 'a'.repeat(64);
test('same-origin follow-up saves long visitor token and rejects cross-origin calls', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    try {
        globalThis.fetch = async () => {
            calls++;
            return Response.json({ ok: true, kid_sid: 'kid_AbCd1234', kid_vid: token });
        };
        const middleware = createKismetMiddleware({
            collectionSlug: 'test',
            trackingKey: 'test',
            visitorRecognition: true,
            consent: ({ headers }) => headers.get('cookie')?.includes('consent=yes'),
        });
        const request = (more = {}) =>
            new NextRequest('https://example.test/__kismet/visitor', {
                headers: {
                    'user-agent': 'Mozilla/5.0 Chrome/150',
                    cookie: '_kid_sid=kid_AbCd1234; consent=yes',
                    'x-kismet-visitor': '1',
                    ...more,
                },
            });
        const response = await middleware(request(), { waitUntil() {} });
        assert.match(response.headers.get('set-cookie'), new RegExp('_kid_vid=' + token));
        assert.match(response.headers.get('set-cookie'), /Max-Age=34560000/);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.deepEqual(await response.json(), { ok: true });
        assert.equal(
            (await middleware(request({ origin: 'https://other.test' }), { waitUntil() {} }))
                .status,
            403
        );
        assert.equal(calls, 1);
        const denied = await middleware(request({ cookie: '_kid_sid=kid_AbCd1234' }), {
            waitUntil() {},
        });
        assert.match(denied.headers.get('set-cookie'), /Max-Age=0/);
        assert.equal(calls, 1);
    } finally {
        globalThis.fetch = original;
    }
});
test('seed schedules local follow-up with basePath and rejects foreign URLs', () => {
    const props = {
        collectionSlug: 'test',
        kidSid: 'kid_AbCd1234',
        suppressed: false,
        visitorRecognition: true,
        visitorEndpoint: '/app/__kismet/visitor',
    };
    assert.match(kismetSeedInline(props), /fetch\("\/app\/__kismet\/visitor"/);
    assert.doesNotMatch(kismetSeedInline({ ...props, visitorEndpoint: '//foreign.test' }), /fetch/);
});
