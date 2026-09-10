# Changelog

## 1.0.1 (unreleased)

- Apply current consent before adopting an existing identity and omit the browser tracker when identity is suppressed.

- Add Apache-2.0 license and notices to source distributions.
- Clarify data flow, catalog prerequisites and release validation status.

All notable changes to `@kismet-tech/telemetry-node`. Each entry names the tracking contract version the package conforms to.

## 1.0.0 (2026-09-04)

Conforms to contract 1.0, on `@kismet-tech/telemetry` ^1.0.0.

- `kismetTelemetry(config)`: Express and Connect middleware doing the whole contract on every page request, with local mint plus after-response reconcile as the default, dotted-domain cookies, `private, no-store`, and the seed left on `req.kismet` and `res.locals.kismet` for the template. Works on the raw `node:http` request and response, so Fastify, Koa and a plain server use it too. A middleware error serves the page without telemetry.
- `createKismetResolver(config)`: the same decision as a function of a web `Request`, for frameworks that apply headers themselves. `applyKismetDecision` and `toWebRequest` are the two halves the middleware is made of.
- `kismetSeedHtml`: one inline script (seed, then the k.js tag appended by the script) for any template engine.
- `readKismetState`, `bookingBridge`, `quoteCapture`.
- `./client`: the browser helpers, re-exported from the core.
- ESM and CommonJS builds.
- Tests: the conformance suite through a real Express app on a real HTTP server behind forwarded headers, plus unit tests on the raw request and response.
