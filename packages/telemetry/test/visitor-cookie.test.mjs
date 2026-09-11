import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVisitorCookie, validKidVid } from '../src/resolve.js';
const token = 'vid_' + 'a'.repeat(64);
const input = {
    url: new URL('https://example.test/__kismet/visitor'),
    headers: new Headers({
        'user-agent': 'Mozilla/5.0 Chrome/150',
        cookie: '_kid_sid=kid_AbCd1234; _kid_vid=' + token,
    }),
    collectionSlug: 'test',
    trackingKey: 'test-key',
    consent: () => true,
};
test('browser follow-up forwards explicit consent and preserves page session', async () => {
    const original = globalThis.fetch;
    try {
        globalThis.fetch = async (url, init) => {
            const body = JSON.parse(init.body);
            assert.equal(body.visitorConsent, true);
            assert.equal(body.proposedKidSid, 'kid_AbCd1234');
            assert.equal(body.cookieKidVid, token);
            return Response.json({ ok: true, kid_sid: 'kid_AbCd1234', kid_vid: token });
        };
        const result = await resolveVisitorCookie(input);
        assert.equal(result.kidVid, token);
        assert.equal(result.setVid, true);
        assert.equal(result.kidSid, 'kid_AbCd1234');
        assert.equal(validKidVid(token), token);
        globalThis.fetch = async () =>
            Response.json({ ok: true, kid_sid: 'kid_OTHER123', kid_vid: token });
        assert.equal((await resolveVisitorCookie(input)).setVid, false);
        globalThis.fetch = async () => {
            throw Error('offline');
        };
        assert.equal((await resolveVisitorCookie(input)).kidSid, 'kid_AbCd1234');
        assert.equal((await resolveVisitorCookie(input)).setVid, false);
    } finally {
        globalThis.fetch = original;
    }
});
test('missing or denied explicit consent never calls authority despite existing cookies', async () => {
    const original = globalThis.fetch;
    try {
        globalThis.fetch = async () => assert.fail('unexpected network');
        for (const consent of [
            undefined,
            () => false,
            () => {
                throw Error('CMP unavailable');
            },
        ]) {
            const result = await resolveVisitorCookie({ ...input, consent });
            assert.equal(result.suppressed, true);
            assert.equal(result.kidVid, null);
        }
    } finally {
        globalThis.fetch = original;
    }
});
