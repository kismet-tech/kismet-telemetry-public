# @kismet-tech/telemetry-next

Kismet Telemetry for Next.js (App Router, middleware on the Edge or Node runtime). A thin adapter over [`@kismet-tech/telemetry`](../telemetry): the contract (version 1.0) is the core's; this package wires it to `NextRequest`, `NextResponse` and the root layout.

Docs: https://developers.kismet.travel/telemetry/nextjs/


**Contract 1.0 limit:** `externalListingId` can be emitted, but ingest-side resolution and generic conversions are Contract 1.1 additions. For property-level attribution today, arrange a registered serving-URL mapping or use a known Kismet property slug. Confirm backend support before relying on the 1.1 fields.

## Install

```bash
npm install @kismet-tech/telemetry-next
```

Peer dependencies: `next` 14.2 or later, `react` 18.2 or later. ESM only; Next bundles it.

Environment: `KISMET_COLLECTION_SLUG` and `KISMET_TRACKING_KEY` (the collection's `ctk_` key, server-side only).

## Three files

```ts
// middleware.ts
import { createKismetMiddleware, KISMET_MATCHER, consentFromCookie } from '@kismet-tech/telemetry-next';

export const middleware = createKismetMiddleware({
  collectionSlug: process.env.KISMET_COLLECTION_SLUG!,
  trackingKey: process.env.KISMET_TRACKING_KEY!,
  consent: consentFromCookie('CookieConsent', /statistics:true/),
  profile: {
    property: { pattern: /^\/stays\/[^/]+\/([^/]+)\/?$/, as: 'externalListingId' },
    searchPaths: ['/stays', /^\/stays\/in\//],
    intent: { path: '/stays/checkout', checkinParam: 'checkin', checkoutParam: 'checkout', guestsParam: 'guests' },
  },
});

export const config = { matcher: KISMET_MATCHER };
```

```tsx
// app/layout.tsx
import { KismetSeed } from '@kismet-tech/telemetry-next/seed';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <KismetSeed collectionSlug={process.env.KISMET_COLLECTION_SLUG!} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

```ts
// wherever the reservation is confirmed, server side
import { bookingBridge } from '@kismet-tech/telemetry-next';

await bookingBridge(config, { kidSid, confirmationCode, bookingEngine: 'custom', domain: 'example.co.uk' });
```

`kidSid` is the `_kid_sid` cookie on the checkout request; carry it through your booking pipeline.

## Already have a middleware?

Pass it as `next`. Telemetry resolves the visitor first, calls yours with the seed headers on the request, and adds its cookies and headers to whatever you return:

```ts
export const middleware = createKismetMiddleware({
  ...config,
  next: async (request, event, visitor) => {
    // your logic; visitor.kidSid, visitor.tier, visitor.classification are available
    return NextResponse.next({ request: { headers: request.headers } });
  },
});
```

## Slug-only property URLs

The `after()` example below requires Next.js 15.1 or later. On earlier supported versions, use the runtime's supported background scheduler or the existing middleware path.

When the property id is only known at render, record the property view from the page's server component:

```ts
import { headers } from 'next/headers';
import { after } from 'next/server';
import { trackServerPropertyView } from '@kismet-tech/telemetry-next';

after(trackServerPropertyView(config, { headers: await headers(), url: currentUrl, externalListingId: listing.id, checkIn, checkOut, guests }));
```

## Browser signals

```ts
import { createTracker } from '@kismet-tech/telemetry-next/client';
const track = createTracker({ collectionSlug: 'your-collection' });
track.propertyView({ externalListingId: listing.id, checkIn, checkOut, guests, stayTotalCents });
track.save({ externalListingId: listing.id });
track.bookIntent({ externalListingId: listing.id, checkIn, checkOut, guests, stayTotalCents });
```

## What the middleware does on every page request

Resolves the visitor (threaded id, cookie, suppressed for bots and visitors without consent, else a locally minted id reconciled with Kismet after the response), emits one server-plane event (agent surfaces as `fetch` with no identity), sets `_kid_sid` and `_kid_vid` on the dotted serving domain, marks the response `private, no-store`, and passes the seed to the layout through request headers. The page never waits on Kismet, and a middleware error serves the page without telemetry rather than failing it.

## Conformance

`npm test` builds the package and runs it through the contract's conformance suite with a real `NextRequest` and `NextResponse`, plus unit tests for the seed component and the header contract with the layout.
