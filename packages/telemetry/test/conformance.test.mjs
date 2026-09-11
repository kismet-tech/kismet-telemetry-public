import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConformance, formatReport } from '../src/conformance/index.js';
import { createReferenceAdapter } from '../src/conformance/reference-adapter.js';
import { consentFromCookie, countryAllowsCookies } from '../src/index.js';

// The core proves itself: the reference adapter (fetch handler on the core alone)
// passes the contract's conformance suite. Every framework adapter ships the same
// test with its own driver.
test('reference adapter passes the v1 conformance suite', async () => {
    const report = await runConformance((env) => {
        const adapter = createReferenceAdapter({
            collectionSlug: env.collectionSlug,
            trackingKey: env.trackingKey,
            resolveEndpoint: env.authorityUrl,
            trackingEndpoint: env.relayUrl,
            consent: (ctx) => {
                // Country default, plus a consent-manager cookie for consent jurisdictions.
                const cmp = consentFromCookie('CookieConsent', /statistics:true/);
                const c = (ctx.country || '').toUpperCase();
                if (countryAllowsCookies(c)) return true;
                return cmp(ctx);
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
        return {
            handle: adapter.handle,
            flush: adapter.flush,
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
    assert.ok(report.passed >= 50, `expected a full run, got ${report.passed} checks`);
});
