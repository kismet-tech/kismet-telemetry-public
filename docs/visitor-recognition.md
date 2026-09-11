# Returning-visitor recognition

Available in core, Next.js and WordPress version 1.1.0; not included in 1.0.1. Enable only after Kismet confirms that the visitor authority is available for your collection.

The session cookie `_kid_sid` identifies a browsing session. `_kid_vid` is an opaque, authority-issued visitor token that can link a later session after the session cookie is lost. It does not sign a guest in or authorize payment. Both cookies use the site's domain and require consent. The visitor cookie is set for up to 400 days; browser policies, deletion and private browsing can shorten that lifetime. Kismet stores a hash of the token and a collection-scoped session link.

## Next.js

Add `visitorRecognition: true` to `createKismetMiddleware`, retaining the site's explicit `consent` hook. The middleware handles `/__kismet/visitor`; include that path in custom matchers. The exported default matcher already includes it. With a Next.js `basePath`, the browser endpoint includes that prefix.

`KismetSeed` reads the middleware's headers and issues the same-origin follow-up automatically. For Pages Router or another renderer using `KismetSeedScripts`, pass `visitorRecognition: true` and `visitorEndpoint` including any base path. The follow-up rechecks consent on the server and returns only a cookie. The tracking key remains in server configuration. No additional application API route is required.

The page's normal session resolution remains asynchronous. Only the browser follow-up waits for the authority, with a one-second cap. Failure does not prevent the page or checkout from rendering. Exclude the follow-up endpoint from shared caches.

## WordPress

Set `define('KISMET_TELEMETRY_VISITOR_RECOGNITION', true);` in server configuration. Configure the existing consent-cookie settings or the `kismet_telemetry_should_set_cookies` filter. Geography alone does not enable visitor recognition.

The existing cache-safe AJAX anchor performs the bounded authority request and sets the visitor cookie. No new plugin or theme integration is required. Consent withdrawal clears the session and visitor cookies on the next anchor request. Applications that support immediate in-page withdrawal must invoke their consent refresh flow as well.

## Validation and limits

Local Chrome tests exercise WordPress, installed Next.js release tarballs and the actual recognition store on PostgreSQL. The HTTP/session/ingest shell is a test harness, not the deployed production API. Tests cover browser restart, loss of only the session cookie, WordPress/Next/WordPress continuity, www/apex cookie sharing, incoming server events, authority outage, consent withdrawal and independent visitors.

Before installation approval, Kismet must validate the deployed authority, collection configuration and ingestion pipeline. Customer staging must confirm actual consent-manager behavior, routing/cache configuration and booking matching. URL mapping alone cannot establish an authoritative reservation-to-visitor join.
