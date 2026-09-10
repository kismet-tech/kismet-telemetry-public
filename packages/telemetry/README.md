# @kismet-tech/telemetry

The Kismet Telemetry core: the server-side tracking contract as code. Framework adapters (`@kismet-tech/telemetry-next`, the `kismet-telemetry` WordPress plugin, the planned Django package, `@kismet-tech/telemetry-node`) are thin wrappers over this package. If you are integrating a framework we do not ship, this package and the reference adapter are what you wire.

Contract: **1.0**. Docs: https://developers.kismet.travel/telemetry/ (the contract lives in the Kismet repo at `docs/CONTRACT.md`).


**Contract 1.0 limit:** `externalListingId` can be emitted, but ingest-side resolution and generic conversions are Contract 1.1 additions. For property-level attribution today, arrange a registered serving-URL mapping or use a known Kismet property slug. Confirm backend support before relying on the 1.1 fields.

## What it does

For every page request on your server:

1. Resolves the visitor: a threaded `?kid_sid=`, else the `_kid_sid` cookie, else nothing for bots and visitors without consent, else a locally minted id that is reconciled with Kismet after the response. Your page never waits on Kismet.
2. Sets the first-party cookies on the dotted serving domain, so one session survives `www` to apex and a WordPress root to a Next.js app.
3. Gives you the seed to inline before the k.js tag, so the browser tracker adopts the server's session instead of minting its own.
4. Emits one server-plane content event per page and per agent surface, bot-classified at ingest. This is the only record of AI agents and crawlers, which never run JavaScript.
5. Maps your URLs to funnel signals from a route profile you fill in once (property pages, search pages, the checkout path), so journeys reach viewed, planning and intent without client code.
6. Offers server-side clients for the booking bridge and quote capture, the conversion join.

## Install

```bash
npm install @kismet-tech/telemetry
```

Node 20+, Cloudflare Workers, or any runtime with `fetch`, `URL`, `crypto.getRandomValues` and `AbortSignal.timeout`. The `./conformance` subpath is Node-only.

## Wire it yourself

```js
import {
  resolveVisitor, classifyRequest, fireContentEvent, renderSeed,
  buildCookie, cookieDomainFor, isHttps, publicUrl, readCountry, visitorIp,
  normalizeServingDomain, SID_COOKIE, SID_MAX_AGE, consentFromCookie,
} from '@kismet-tech/telemetry';

const config = {
  collectionSlug: process.env.KISMET_COLLECTION_SLUG,
  trackingKey: process.env.KISMET_TRACKING_KEY,          // ctk_… ; server-side only
  consent: consentFromCookie('CookieConsent', /statistics:true/),
  profile: {
    property: { pattern: /^\/stays\/[^/]+\/([^/]+)\/?$/, as: 'externalListingId' },
    searchPaths: ['/stays'],
    intent: { path: '/stays/checkout', checkinParam: 'checkin', checkoutParam: 'checkout', guestsParam: 'guests' },
  },
};

export async function handle(request, ctx /* { waitUntil } */) {
  const url = publicUrl(request.headers, new URL(request.url));
  const cls = classifyRequest(url, config.profile, { accept: request.headers.get('accept'), method: request.method });
  if (cls.kind === 'excluded') return serve(request);

  const env = { COLLECTION_KEY: config.trackingKey };
  const common = {
    pageUrl: url.toString(), domain: normalizeServingDomain(url.host), collectionSlug: config.collectionSlug,
    userAgent: request.headers.get('user-agent'), clientIp: visitorIp(request.headers),
    country: readCountry(request.headers), referrer: request.headers.get('referer'),
  };

  if (cls.kind === 'agent') {
    fireContentEvent(ctx, env, { ...common, vrSlug: null, clientSessionId: null, agentFetch: true });
    return serve(request);
  }

  const v = await resolveVisitor({ url, headers: request.headers, ...config, waitUntil: ctx.waitUntil });
  fireContentEvent(ctx, env, {
    ...common, vrSlug: cls.vrSlug,
    ...(cls.externalListingId ? { externalListingId: cls.externalListingId } : {}),
    clientSessionId: v.isBot ? null : v.kidSid, ctaIntent: cls.kind === 'intent',
    stayCheckIn: cls.stayCheckIn, stayCheckOut: cls.stayCheckOut, guestCount: cls.guestCount,
  });

  const response = await serve(request, { seed: renderSeed({ kidSid: v.kidSid, suppressed: v.suppressed, collectionSlug: config.collectionSlug }) });
  response.headers.set('cache-control', 'private, no-store');
  if (v.kidSid && v.setSid) {
    response.headers.append('set-cookie', buildCookie(SID_COOKIE, v.kidSid, {
      maxAge: SID_MAX_AGE, domain: cookieDomainFor(url.host), secure: isHttps(request.headers, url),
    }));
  }
  return response;
}
```

`src/conformance/reference-adapter.js` is this, complete.

## Consent

The default gate is a country deny list read from the `cf-ipcountry` or `x-vercel-ip-country` header. Off Cloudflare and Vercel there is no header and the default sets cookies for everyone. Pass a `consent` hook that reads your consent manager's state; `consentFromCookie(name, pattern)` covers the common case. Consent gates the session only. Page views and crawler fetches are recorded either way, with a null session.

## Funnel signals

| Stage | What lights it | From |
|---|---|---|
| researching | `view` on a results page | route profile `searchPaths` |
| viewed | `property_view` with a property | route profile `property` |
| planning | `property_view` with check-in and check-out | stay parameters on the URL, or the browser helper |
| shortlisting | `add_to_wishlist` | browser helper only |
| intent | `cta_click` with the stay | route profile `intent`, or the browser helper |
| conversion | booking bridge | `postBookingBridge` from your checkout handler |

Browser helpers: `import { createTracker } from '@kismet-tech/telemetry/client'`, then `createTracker({ collectionSlug }).propertyView({ externalListingId, checkIn, checkOut, guests, stayTotalCents })` and friends. They dispatch the `kismet:visitor:*` events k.js bridges; never call `window.Kismet.track()`.

Property-level funnel stages require a resolved property. The 1.0 server path can use registered serving URLs or Kismet slugs; automatic external listing-id resolution is planned for 1.1.

## Conformance

```js
import { runConformance, formatReport } from '@kismet-tech/telemetry/conformance';
const report = await runConformance((env) => makeYourDriver(env));
if (!report.ok) throw new Error(formatReport(report));
```

A driver is `{ handle(Request) → Response, flush(), fixtures }`. The suite starts a stub authority and a stub relay and exercises the eight requirement groups of the contract. An adapter that does not pass does not ship.

## Scripts

`npm test`, `npm run typecheck`, `npm run build`. The bot vocabulary is generated from the platform's `bot-patterns.json`; `npm run generate:check` fails CI when it drifts.
