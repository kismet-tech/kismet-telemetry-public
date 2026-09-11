# WordPress root plus a Next.js app on the same domain

For WordPress at `example.co.uk/` and a Next.js App Router app at `/stays/` with its own checkout. Both adapters use contract 1.0 and share a cookie domain. The standalone plugin contains tracking only; it does not require Elements or replace site pages.

Next.js 1.1.0 and the standalone WordPress 1.1.1 plugin are available. Local integration validation is complete; confirm the actual site's consent manager, caching and route mapping during staging acceptance. Django is planned.

## Review and configuration

Read [what is installed and sent](data-flow.md), then the [contract](CONTRACT.md). Obtain the collection slug and server-only tracking key from Kismet and register production/staging hostnames. Confirm the actual Next.js router/version and consent manager before selecting integration code.

Use the same cookie domain, for example `.example.co.uk`, on both surfaces. Wire consent on both: WordPress 1.1.1 denies missing geography by default. Configure an explicit default-denied hook on the npm adapters, and grant only on your consent manager's positive analytics signal.

## WordPress

Follow the [WordPress guide](https://developers.kismet.travel/telemetry/wordpress/). In Settings, Kismet Telemetry, enter slug and key, choose consent-manager-cookie mode and configure the route profile. The custom consent filter is `kismet_telemetry_should_set_cookies`.

Keep the per-visitor AJAX endpoint uncached. Full-page cache hits do not execute the PHP server beacon, although the browser bootstrap is cache-safe. Test both paths. With Elements installed, verify its tracking hooks defer to Telemetry and events are not duplicated.

## Next.js

Follow the [Next.js guide](https://developers.kismet.travel/telemetry/nextjs/) using `@kismet-tech/telemetry-next`. Add `createKismetMiddleware`, consent, the route profile, and `KismetSeed` from `@kismet-tech/telemetry-next/seed` in the root layout. Keep shared configuration server-only.

Compose existing middleware through the adapter's `next` option, preserving authentication, rewrites and headers. The seed makes the App Router layout dynamic. Never seed identity into shared cacheable HTML. Validate Pages Router or custom reverse-proxy integration separately against the actual site.

## Property and action mapping

Agree the actual property identifier, search paths, quote/price-check trigger, form submissions, booking intent and server-side booking-success hook with the site owner. A URL slug is not necessarily a PMS listing id.

Contract 1.0 property attribution needs a registered serving-URL mapping or known Kismet slug. Adapters can send `externalListingId`, but backend resolution and generic conversions are Contract 1.1 additions. Do not promise either from the 1.0 install alone.

## Checkout

From the server handler that knows the reservation succeeded:

```ts
import { bookingBridge } from '@kismet-tech/telemetry-next';

await bookingBridge(config, {
  kidSid,
  confirmationCode,
  bookingEngine: 'custom',
  domain: 'example.co.uk',
});
```

Carry the checkout request's `_kid_sid` through queues/callbacks to confirmation. A form submission or payment attempt is not a completed reservation. Prefer the runtime's supported post-response scheduler; inspect the helper's result in staging. Booking success must not depend on telemetry success.

## Mixed-site acceptance

1. With consent, visit WordPress then Next in a fresh browser, and repeat in reverse. Verify the same session in cookies and seeds.
2. Without consent, verify no new session is minted or attached to the page event. Test bots separately.
3. Test cold/warm visits, full-page-cache hits/misses, proxy headers, existing middleware and Elements coexistence where applicable. Record cache coverage gaps.
4. Read back a mapped property event and its session association. Test quotes and intent against the agreed mapping.
5. Complete a synthetic staging booking. Read back the bridge and, once reservation sync is available, its join to that session and confirmation code.
6. Make the telemetry receiver unavailable; verify pages and checkout still work. Measure overhead and check no personal seed leaks through shared caching.

A local WordPress/Next replica prepares the integration. Final acceptance needs the actual staging site or an agreed faithful replica of routing, caching, consent and checkout. Kismet can supply mappings/snippets, or prepare a PR after a separate repository invitation.


## Returning-visitor recognition

Version 1.1.0 supports optional `_kid_vid` recovery for consenting visitors. See the [visitor-recognition guide](visitor-recognition.md) for the server-side setting, consent integration and validation requirements.
