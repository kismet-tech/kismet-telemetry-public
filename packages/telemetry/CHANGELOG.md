# Changelog

## 1.0.1 (unreleased)

- Add Apache-2.0 license and notices to source distributions.
- Clarify data flow, catalog prerequisites and release validation status.

All notable changes to `@kismet-tech/telemetry`. Versions follow semver. Each entry names the tracking contract version the package conforms to (`docs/developer-platform/tracking/CONTRACT.md`).

## 1.0.0 (2026-09-03)

Conforms to contract 1.0. Published to npmjs 2026-09-03 (shasum 356bb32e5d1a76f87a06b8546258bf12180ce9a2, 72 files, 75.4 kB packed).

- New package. Lineage: `@kismet-tech/edge-events` 0.1.0, whose surface is re-exported unchanged (content-event builder, bot vocabulary, identity carrier and mint, resolve-anchor client, booking-engine tees, observe rules). The Cloudflare injection worker keeps building from the same source.
- `resolveVisitor`: the four-branch resolution of contract section 5 with local mint plus asynchronous reconcile as the default and an opt-in authority-first mode.
- Consent: the country fallback (EU 27, EEA, GB, CH) and the site's consent hook, plus `consentFromCookie` for consent-manager cookies. Fail-closed on a hook error.
- Cookies: the dotted serving-domain rule, host-only for single-label hosts and IPs, `buildCookie` per the contract, forwarded-header helpers (`publicUrl`, `isHttps`).
- Seed: `renderSeed` (id or suppression flag, then the k.js tag), the reserved-globals list, the request-header names the Next reference uses.
- Route profile: `classifyRequest` maps a URL to agent / intent / property / search / page for the server-plane funnel signals, with stay parsing.
- Content events: `externalListingId` (the site's own PMS listing id) accepted and emitted only when provided; it marks a property page. Contract 1.1 resolves it at ingest; sending it under 1.0 is harmless.
- Conversion: `postBookingBridge` and `postQuoteCapture` server-side clients with body validation.
- `@kismet-tech/telemetry/client`: browser helpers that dispatch the `kismet:visitor:*` events k.js bridges, and a browser-side bridge post.
- `@kismet-tech/telemetry/conformance`: stub authority and relay, `runConformance` over the eight requirement groups of contract section 15, and the reference adapter that passes it.

Known differences from the shipped Next reference: dotted cookie domain instead of host-only; cold visits no longer wait on the authority by default.
