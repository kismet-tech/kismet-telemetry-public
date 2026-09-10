# What Kismet Telemetry installs and sends

Installing Telemetry adds code to your application. It does not grant Kismet access to your GitHub repository, an interactive shell, or your application source. The adapter constructs tracking requests from the incoming request and fields you supply. It does not upload your source tree.

An npm dependency runs with the permissions of its host application. npm is a distribution mechanism, not a sandbox. Review the source, dependencies and install scripts, pin the version you approve, and review upgrades. A repository invitation for implementation assistance is a separate choice.

## Server requests

| Operation | Default destination | Data |
|---|---|---|
| Reconcile visitor identity | `https://api.ksmt.app/v1/identity/resolve-anchor` | Session identifiers, collection/domain, request signals and first-touch information. |
| Record page/crawler event | `https://kismet.travel/api/track` | Page URL, referrer, user agent, IP/country when supplied, collection, session when allowed, classification and optional property/stay fields. |
| Join a confirmed booking | `https://api.ksmt.app/v1/booking-bridge` | Session id and confirmation code, plus explicitly supplied booking fields. Your checkout calls this helper. |
| Record a quote | `https://api.ksmt.app/v1/quote-capture` | The quote fields your application supplies, including property, dates and price where configured. |

The [contract](CONTRACT.md) defines the payloads. Endpoint overrides support test receivers and staging. URLs and referrers may contain query parameters: avoid placing secrets or unnecessary personal data in URLs supplied to telemetry.

## Browser requests

The seed loads `https://kismet.travel/k.js?c=<collection>` into the browser. That script adopts the session and handles browser interactions, including custom events from the browser helpers. It is separately served: pinning the npm adapter does not pin the contents of `k.js`. The hosted ingest, identity service and browser tracker are separate from this adapter repository.

WordPress also makes a same-origin request to its `kismet_telemetry_anchor` AJAX action for a cold visitor. Its bootstrap is constant across cached pages; the per-visitor AJAX response must remain uncached.

## Consent and failures

Wire the site's consent manager into both adapters. Without a usable country header, the geography fallback allows sessions; it is not a replacement for consent. When a session is suppressed, server events still carry request metadata with a null session identifier.

Identity reconciliation and page events run outside the page's critical path. Booking and quote helpers are bounded and return failure results without throwing into checkout. Schedule them after the booking response where supported. Local middleware still has overhead; measure it on your stack.

A cache hit that bypasses WordPress/PHP also bypasses its server beacon. Missing server events do not prove no crawler visited. A Next layout reading the session seed is dynamic and must not cache one visitor's identity for another.

## Catalog and reporting prerequisites

Contract 1.0 supports the existing booking bridge. Ingest resolution of `externalListingId` and the generic conversion endpoint are Contract 1.1 additions. Do not rely on them until backend support is confirmed. With 1.0, use a registered serving-URL mapping or a known Kismet property slug for property-level attribution. A public URL slug is not necessarily the PMS listing id.

Kismet supplies the collection tracking key through onboarding. Self-serve keys and the dedicated install-report experience are separate work; installing the package alone does not provision either. Guesty credentials are not used by these adapters. PMS synchronization is a separate backend integration.

## Source review

- `packages/telemetry/src/identity.js`, `content-event.js`, `conversion.js`: identity, event and booking/quote transport.
- `packages/telemetry-next/src/index.ts` and `seed.tsx`: Next request handling and seed.
- `packages/telemetry-node/src/index.ts`: Node integration.
- `packages/telemetry-wordpress/includes/anchor.php`, `beacon.php`, `conversion.php`: WordPress handling and transport.
- Package manifests and lockfiles: dependencies and lifecycle scripts.

Review the deployed version and browser script as well as this overview.
