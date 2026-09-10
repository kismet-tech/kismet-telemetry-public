# @kismet-tech/telemetry-node

Kismet Telemetry for Node servers. A thin adapter over [`@kismet-tech/telemetry`](../telemetry): the contract (version 1.0) is the core's; this package wires it to the `node:http` request and response, which is what Express, Connect, Fastify and Koa hand you.

Docs: https://developers.kismet.travel/telemetry/node/


**Contract 1.0 limit:** `externalListingId` can be emitted, but ingest-side resolution and generic conversions are Contract 1.1 additions. For property-level attribution today, arrange a registered serving-URL mapping or use a known Kismet property slug. Confirm backend support before relying on the 1.1 fields.

## Install

```bash
npm install @kismet-tech/telemetry-node
```

Node 20 or later. ESM and CommonJS.

Environment: `KISMET_COLLECTION_SLUG` and `KISMET_TRACKING_KEY` (the collection's `ctk_` key, server-side only).

## Express

```js
import express from 'express';
import { kismetTelemetry, consentFromCookie } from '@kismet-tech/telemetry-node';

const app = express();

app.use(
  kismetTelemetry({
    collectionSlug: process.env.KISMET_COLLECTION_SLUG,
    trackingKey: process.env.KISMET_TRACKING_KEY,
    consent: consentFromCookie('CookieConsent', /statistics:true/),
    profile: {
      property: { pattern: /^\/stays\/[^/]+\/([^/]+)\/?$/, as: 'externalListingId' },
      searchPaths: ['/stays', /^\/stays\/in\//],
      intent: { path: '/stays/checkout', checkinParam: 'checkin', checkoutParam: 'checkout', guestsParam: 'guests' },
    },
  })
);

app.get('/stays/:town/:house', (req, res) => {
  res.render('property', { kismetSeed: res.locals.kismet?.seed ?? '' });
});
```

In the template, print the seed first thing in `<head>`, unescaped:

```html
<head>
  <%- kismetSeed %>
  <title>...</title>
</head>
```

Mount it before your routes and before any static middleware you want excluded (assets are excluded by the route profile anyway). Behind a reverse proxy, make sure it forwards `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-For`; the adapter reads them to rebuild the public URL, decide `Secure`, and take the visitor's IP.

## The checkout call

```js
import { bookingBridge } from '@kismet-tech/telemetry-node';

await bookingBridge(config, { kidSid, confirmationCode, bookingEngine: 'custom', domain: 'example.co.uk' });
```

`kidSid` is the `_kid_sid` cookie on the checkout request (`req.kismet.kidSid` on any page request); carry it through your booking pipeline to wherever the confirmation code is known. Bounded, never throws, must not affect the booking.

## Fastify, Koa, plain node:http

The middleware only needs the raw request and response.

```js
// Fastify
fastify.addHook('onRequest', (request, reply, done) => middleware(request.raw, reply.raw, done));
// then request.raw.kismet.seed in the handler

// Koa
app.use((ctx, next) => new Promise((r) => middleware(ctx.req, ctx.res, r)).then(next));
// then ctx.req.kismet.seed

// node:http
createServer((req, res) => middleware(req, res, () => render(req, res)));
```

## Frameworks that speak Request and Response

`createKismetResolver(config).resolve(request)` returns the decision (state, headers, Set-Cookie lines) without applying it, for Hono, Cloudflare Workers, Deno and similar. The core's reference adapter is the worked example for the same shape.

## Browser signals

```js
import { createTracker } from '@kismet-tech/telemetry-node/client';
const track = createTracker({ collectionSlug: 'your-collection' });
track.propertyView({ externalListingId: listing.id, checkIn, checkOut, guests, stayTotalCents });
track.save({ externalListingId: listing.id });
track.bookIntent({ externalListingId: listing.id, checkIn, checkOut, guests, stayTotalCents });
```

## What the middleware does on every page request

Resolves the visitor (threaded id, cookie, suppressed for bots and visitors without consent, else a locally minted id reconciled with Kismet after the response), emits one server-plane event (agent surfaces as `fetch` with no identity), sets `_kid_sid` and `_kid_vid` on the dotted serving domain, marks the response `private, no-store`, and leaves `{ kidSid, suppressed, tier, classification, seed }` on `req.kismet` and `res.locals.kismet`. The page never waits on Kismet, and a middleware error serves the page without telemetry rather than failing it.

Caching: a page that prints the seed is per visitor and is marked `private, no-store` for that reason. If you serve HTML from a shared cache, do not print the seed into it; use the cache-safe bootstrap pattern in the contract (section 7) instead.

## Conformance

`npm test` builds the package and runs it through the contract's conformance suite as a real Express app on a real HTTP server behind forwarded headers, plus unit tests on the raw request and response.
