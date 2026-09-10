# Changelog

## 1.0.1 (unreleased)

- Apply current consent before adopting an existing identity and omit the browser tracker when identity is suppressed.

- Add Apache-2.0 license and notices to source distributions.
- Clarify data flow, catalog prerequisites and release validation status.

All notable changes to `@kismet-tech/telemetry-next`. Each entry names the tracking contract version the package conforms to.

## 1.0.0 (2026-09-04)

Conforms to contract 1.0, on `@kismet-tech/telemetry` ^1.0.0.

- `createKismetMiddleware(config)`: the whole contract on every page request, with local mint plus after-response reconcile as the default, dotted-domain cookies, `private, no-store`, and the seed handed to the layout through request headers. A middleware error serves the page without telemetry.
- `KISMET_MATCHER`: pages plus the two agent index files; never assets or `/api/*`.
- `<KismetSeed />` (`./seed`): reads the middleware's headers and renders the seed then the k.js tag. `KismetSeedScripts` is the pure half.
- `readKismetSeed`, `trackServerPropertyView` (render-time server event for slug-only property URLs), `bookingBridge`, `quoteCapture`.
- `./client`: the browser helpers, re-exported from the core.
- Tests: the conformance suite with a real `NextRequest` and `NextResponse`, plus unit tests.
