# Returning-visitor recognition

Available in core, Next.js and WordPress version 1.1.0; not included in 1.0.1. Enable only after Kismet confirms that the visitor authority is available for your collection.

The session cookie `_kid_sid` identifies a browsing session. `_kid_vid` is an opaque, authority-issued visitor token that can link a later session after the session cookie is lost. It does not sign a guest in or authorize payment. Analytics use of either cookie requires consent. A guest account may separately own `_kid_sid` as an essential sign-in carrier; the Next.js setting below preserves it without permitting analytics use. The visitor cookie is set for up to 400 days; browser policies, deletion and private browsing can shorten that lifetime. Recognition is scoped to the collection.

## Next.js

Add `visitorRecognition: true` to `createKismetMiddleware`, retaining the site's explicit `consent` hook. The middleware handles `/__kismet/visitor`; include that path in custom matchers. The exported default matcher already includes it. With a Next.js `basePath`, the browser endpoint includes that prefix.

`KismetSeed` reads the middleware's headers and issues the same-origin follow-up automatically. For Pages Router or another renderer using `KismetSeedScripts`, pass `visitorRecognition: true` and `visitorEndpoint` including any base path. The follow-up rechecks consent on the server and returns only a cookie. The tracking key remains in server configuration. No additional application API route is required.

The page's normal session resolution remains asynchronous. Only the browser follow-up waits for the authority, with a one-second cap. Failure does not prevent the page or checkout from rendering. Exclude the follow-up endpoint from shared caches.

### Sites with a guest account

If your account integration owns `_kid_sid`, use Next adapter 1.1.2 or later and set `essentialIdentity: 'account-owned-sid'` alongside `visitorRecognition: true`. Set the same option in a reviewed browser consent bridge, version 1.3.0 or later. The adapter preserves the existing SID on denied page and visitor-endpoint requests, but does not pass it to analytics, load the tracker or ask the recognition authority. It clears `_kid_vid` in both host-only and configured-domain cookie scopes. The default remains cleanup of the telemetry-owned SID.

Connect the server consent hook and browser bridge to the same saved choice. Notify the bridge synchronously when that choice changes. Preserving an essential cookie is not analytics permission. Test sign-in while denied, grant, withdrawal, and renewed grant before enabling recognition on the host.

## WordPress

Set `define('KISMET_TELEMETRY_VISITOR_RECOGNITION', true);` in server configuration. Configure the existing consent-cookie settings or the `kismet_telemetry_should_set_cookies` filter. Geography alone does not enable visitor recognition.

The existing cache-safe AJAX anchor performs the bounded authority request and sets the visitor cookie. No new plugin or theme integration is required. Consent withdrawal clears the session and visitor cookies on the next anchor request. Applications that support immediate in-page withdrawal must invoke their consent refresh flow as well.

## Validation and limits

Local Chrome tests exercise WordPress and installed Next.js release tarballs against a local test service. These tests do not establish acceptance on a customer site. Tests cover browser restart, loss of only the session cookie, WordPress/Next/WordPress continuity, www/apex cookie sharing, incoming server events, authority outage, consent withdrawal and independent visitors.

Before installation approval, Kismet must validate the deployed authority, collection configuration and ingestion pipeline. Customer staging must confirm actual consent-manager behavior, routing/cache configuration and booking matching. URL mapping alone cannot establish an authoritative reservation-to-visitor join.

For returning-visitor acceptance, retain consent and `_kid_vid`, remove only `_kid_sid`, and visit again. Verify a new session is issued and the authority links it to the same stored visitor. Restart the browser and repeat. Withdrawing consent must remove `_kid_vid` and stop analytics; an explicitly account-owned SID must remain available to the guest account. A stable cookie value alone does not prove the stored join.
