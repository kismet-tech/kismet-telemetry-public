import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { runConformance, formatReport } from '@kismet-tech/telemetry/conformance';
import { consentFromCookie } from '@kismet-tech/telemetry';
import { kismetTelemetry } from '../dist/esm/index.js';

// The adapter proves itself against the contract the way it will run at a
// client: a real Express app on a real HTTP server, behind a reverse proxy
// (x-forwarded-host and x-forwarded-proto set the public URL), the middleware
// mounted with app.use, the template printing res.locals.kismet.seed. The
// shared suite drives it against the stub authority and relay.
test('kismetTelemetry passes the v1 conformance suite through Express', async () => {
    let server;
    const report = await runConformance(async (env) => {
        const middleware = kismetTelemetry({
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
        const app = express();
        app.use(middleware);
        app.use((req, res) => {
            const seed = res.locals.kismet?.seed ?? '';
            res.type('html').send(
                `<!doctype html><html><head>${seed}<title>${req.path}</title></head><body></body></html>`
            );
        });
        server = createServer(app);
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;
        return {
            handle: async (request) => {
                const url = new URL(request.url);
                const headers = new Headers(request.headers);
                headers.set('x-forwarded-host', url.host);
                headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
                return fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
                    method: request.method,
                    headers,
                    redirect: 'manual',
                });
            },
            flush: () => middleware.flush(),
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
    await new Promise((r) => server.close(r));
    assert.ok(report.ok, '\n' + formatReport(report));
    assert.ok(report.passed >= 50, `expected a full run, got ${report.passed}`);
});
