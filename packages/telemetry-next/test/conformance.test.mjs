import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { runConformance, formatReport } from '@kismet-tech/telemetry/conformance';
import { consentFromCookie } from '@kismet-tech/telemetry';
import { createKismetMiddleware } from '../dist/index.js';

// The adapter proves itself against the contract: a real NextRequest in, a real
// NextResponse out, background work collected through a NextFetchEvent-shaped
// object, driven by the shared suite against the stub authority and relay.
test('createKismetMiddleware passes the v1 conformance suite', async () => {
    const report = await runConformance((env) => {
        const middleware = createKismetMiddleware({
            collectionSlug: env.collectionSlug,
            trackingKey: env.trackingKey,
            endpoints: { resolveAnchor: env.authorityUrl, track: env.relayUrl },
            consent: (ctx) => {
                const c = (ctx.country || '').toUpperCase();
                if (!c || c === 'XX' || c === 'T1' || !['GB', 'FR', 'DE', 'CH', 'IE'].includes(c))
                    return true;
                return consentFromCookie('CookieConsent', /statistics:true/)(ctx);
            },
            profile: {
                property: {
                    pattern: /^\/stays\/[^/]+\/([^/]+)\/?$/,
                    as: 'externalListingId',
                },
                searchPaths: ['/stays'],
                intent: { path: '/stays/checkout' },
            },
        });
        /** @type {Promise<unknown>[]} */
        let pending = [];
        const event = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => undefined)) };
        return {
            handle: async (request) => {
                const req = new NextRequest(request.url, {
                    method: request.method,
                    headers: request.headers,
                });
                const res = await middleware(req, /** @type {any} */ (event));
                // NextResponse.next() has no body; the suite reads the seed from HTML, so
                // render the page the way a layout would, from the request headers the
                // middleware attached.
                const kid = res.headers.get('x-middleware-request-x-kismet-kid-sid');
                const sup = res.headers.get('x-middleware-request-x-kismet-sid-suppressed');
                const seed =
                    sup === '1'
                        ? '<script>window.Kismet=window.Kismet||{};window.Kismet._sidSuppressed=1;</script>'
                        : kid
                          ? `<script>window.Kismet=window.Kismet||{};window.Kismet._kidSid="${kid}";</script>`
                          : '';
                const tag = seed
                    ? `<script async src="https://kismet.travel/k.js?c=${encodeURIComponent(env.collectionSlug)}"></script>`
                    : '';
                const html = `<!doctype html><html><head>${seed}${tag}</head><body></body></html>`;
                const out = new Response(html, { status: 200, headers: res.headers });
                return out;
            },
            flush: async () => {
                const p = pending;
                pending = [];
                await Promise.allSettled(p);
            },
            fixtures: {
                host: 'www.example.co.uk',
                pagePath: '/about',
                propertyPath: '/stays/porthleven/harbour-house',
                propertyId: 'harbour-house',
                propertyIdField: 'externalListingId',
                intentPath: '/stays/checkout',
                consentCookie: 'CookieConsent=statistics:true',
            },
        };
    });
    assert.ok(report.ok, '\n' + formatReport(report));
    assert.ok(report.passed >= 50, `expected a full run, got ${report.passed}`);
});
