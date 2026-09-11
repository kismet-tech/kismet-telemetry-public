---
type: Reference
title: "Kismet Tracking HTTP Contract v1.0"
description: "The cookie, seed and beacon protocol a server-side tracking adapter implements on a client's own stack. Versioned; every adapter conforms to one contract version."
status: "Published contract 1.0, with the optional visitor-recognition extension released in package 1.1.0."
timestamp: 2026-09-03T21:00:00-04:00
---
# Kismet Tracking HTTP Contract v1.0

**Contract version:** 1.0. **Applies to:** every server-side adapter (Next.js, Node, Django, WordPress, hand-wired) and to the Kismet edge worker, which is the reference emitter.

This document is the wire contract between a site that runs a Kismet tracking adapter and the Kismet platform. It says what an adapter reads, what it sets, what it sends, and what it may never do. It does not describe any one adapter's API; each adapter has its own install page that points back here.

The words MUST, SHOULD and MAY are used in the RFC 2119 sense. Anything marked "conformance" is asserted by the shared conformance suite that every adapter ships with.

## 1. Scope and terms

- **Adapter.** The code that runs on the site's own server on every page request: Next.js middleware, an Express middleware, a Django middleware, the WordPress plugin, or something a client wires by hand from this page.
- **Authority.** Kismet's identity service at `https://api.ksmt.app`. It is the one place a session id is confirmed and a visitor id is issued. Adapters adopt what the authority (or the visitor) already has; they mint only on a cold visit, and then reconcile.
- **Relay.** `https://kismet.travel`, which fronts the event ingest for adapters and for k.js. Adapters MAY post events to the API origin directly with a service key; the default is the relay.
- **k.js.** Kismet's browser tracker, loaded from `https://kismet.travel/k.js?c=<collectionSlug>`. It handles the client plane (human interactions). The adapter's job is to make sure k.js adopts the server-resolved session instead of minting its own.
- **Session id (`kid_sid`).** The 90-day identity carrier. One visitor, one browser, one `kid_sid` across every Kismet surface on the domain.
- **Visitor id (`kid_vid`).** A longer-lived hint the authority returns. Adapters never mint one.
- **Server plane.** One content event per page or agent request, emitted by the adapter with `trackingMode: "server"`. This is the only record of AI agents and crawlers, which never run k.js.
- **Client plane.** Events k.js emits from the browser with `trackingMode: "client"`. Not the adapter's job.
- **Collection.** The Kismet tenant the site belongs to, identified by `collectionSlug`.

## 2. Credentials and configuration

| Setting | Required | What it is |
|---|---|---|
| `collectionSlug` | yes | The collection this site's pages belong to. Sent on every resolve and every event. |
| Tracking key (`ctk_…`) | yes | The collection's transport credential. Sent as the `X-Kismet-Tracking-Key` header on resolve-anchor, content events, booking bridge and quote capture. Server-side only. It MUST NOT be inlined into any page, script or cookie. |
| Authorized domains | yes, on the collection | The hostnames k.js may beacon from. Configured on the Kismet side, not by the adapter. In client mode the request Origin is the credential, so an unregistered hostname means client-plane events are rejected once enforcement is on. |
| `KISMET_TRACKING_ENDPOINT` | no | Where content events POST. Default `https://kismet.travel/api/track`. |
| `KISMET_RESOLVE_ANCHOR_URL` | no | Override for the authority. Default `https://api.ksmt.app/v1/identity/resolve-anchor`. |
| `KISMET_API_ORIGIN` | no | Override for every direct API call (booking bridge, quote capture). Default `https://api.ksmt.app`. |

Recommended environment variable names for adapters: `KISMET_COLLECTION_SLUG`, `KISMET_TRACKING_KEY`, plus the three optional overrides above. The WordPress plugin stores the same three values as options with the key encrypted at rest.

Where to get the key: a collection admin reveals or rotates it with `GET` or `POST /v1/collections/<slug>/tracking-key?reveal=true`. Developer-portal self-serve issuance is planned and is not part of this contract version.

## 3. Identifiers

| Identifier | Grammar | Notes |
|---|---|---|
| `kid_sid`, read grammar | `^kid_[A-Za-z0-9]{6,40}$` | What an adapter accepts from a `?kid_sid=` parameter or the `_kid_sid` cookie. Anything else is treated as absent. |
| `kid_sid`, mint grammar | `^kid_[A-Za-z0-9]{8}$` | What an adapter mints and what the authority adopts as a proposed id. Exactly eight characters after the prefix. A proposed id of any other length is silently re-minted by the authority, which forks the visitor into two sessions. |
| `kid_vid` | Legacy: `^[A-Za-z0-9_]{6,64}$`; visitor-recognition extension: `^vid_[a-f0-9]{64}$` (68 characters total) | Authority-issued recognition hint; adapters never mint one. |
| Mint alphabet | `A-Z a-z 0-9` | Eight bytes from a cryptographic random source, each reduced modulo 62. |

Conformance: the suite mints 1,000 ids and asserts every one matches the mint grammar; it presents a 7-char and a 9-char id and asserts the adapter never proposes them.

## 4. Cookies

| Cookie | Max-Age | Set when | Attributes |
|---|---|---|---|
| `_kid_sid` | 7,776,000 s (90 days) | The resolved id was not already on the visitor (threaded id differs from the cookie, or a cold mint). Refreshing on every request is allowed but not required. | `Path=/; SameSite=Lax; Secure` when the request is HTTPS; **not** `HttpOnly` (k.js reads it through `document.cookie`) |
| `_kid_vid` | 34,560,000 s (about 400 days) | When the authority returns a valid token after consent; the optional visitor follow-up may refresh the cookie. | Same as above |

**Domain rule.** The cookie MUST be set with `Domain=.<serving domain>` where the serving domain is the request host with a leading `www.` and any port removed (the same normalization the serving domain on events uses, section 8). Host-only cookies (no `Domain` attribute) are permitted only when the host is a single label such as `localhost` or an IP address, which browsers reject a `Domain` on. Adapters MUST let the operator override the domain for sites whose registrable domain is deeper than the serving domain (for example `book.example.com` sharing a session with `example.com`).

Why the dotted domain: a session has to survive `www.example.com` to `example.com` and a WordPress root to a Next.js app on the same host. A host-only cookie set by one surface is invisible to another on a sibling host. This is the one place the shipped Next reference (host-only) differs from the edge worker and the WordPress plugin (dotted), and the contract sides with the worker and plugin.

**Consent and geography.** An adapter MUST NOT set either cookie, and MUST NOT mint or resolve a session, for a visitor in a cookie-consent jurisdiction unless the site has signalled consent. The default gate is a country deny list read from the platform's country header (`cf-ipcountry`, `x-vercel-ip-country`, or the adapter's own geo source): the EU 27, Iceland, Liechtenstein, Norway, the United Kingdom and Switzerland. Starting with core/Next.js/WordPress 1.1.1 and Node 1.0.2, an unknown country (missing, malformed, `XX`, `T1`) is denied. Sites without trusted country headers therefore remain denied until their consent hook explicitly permits the visitor. Older releases allowed unknown geography and must be upgraded or configured with an explicit consent hook. Adapters MUST therefore expose a hook that replaces the decision with the site's actual consent state (read from the consent manager's cookie or API), and a site in a consent jurisdiction MUST wire it. The hook is the consent mechanism; the geography list is only the fallback.

**What consent gates and what it does not.** Consent gates the session: the cookies, the mint, the resolve call, the seed id, and therefore journeys, the guestbook and booking attribution. It does not gate the server-plane content event (section 8), which an adapter sends for every request regardless, with `clientSessionId` null when no session was allowed. Crawler and agent fetches, page views, referrers and countries are recorded either way; that is what the install report reads. A visitor who declines is measured as an anonymous visit, not lost.

**Bots.** A request whose user agent matches the shared bot vocabulary (section 8) or has no user agent MUST NOT receive a cookie, a mint, or a resolve call. Bots are not guests.

Conformance: cookie names, ages, attributes and the domain rule are asserted from the `Set-Cookie` header on a cold human request; absence is asserted on a bot request and on a request from a denied country with no consent signal.

## 5. Resolution order

For every page request the adapter resolves the visitor in this order and stops at the first match. Assets, the adapter's own API routes, and anything that is not a page or an agent surface are excluded before this runs.

1. **Suppressed.** Bot user agent, missing user agent, or a consent-denied visitor: no id, no cookie, no network. The page seed (section 7) carries the suppression flag so k.js will not mint either.
2. **Threaded.** `?kid_sid=<id>` on the URL and the id matches the read grammar: adopt it verbatim. Set the cookie if it differs from the current cookie. Send a non-blocking resolve-anchor with `threadedKidSid` (and `cookieKidSid` when a different cookie was present) so the authority receives the session identifiers for the navigation. This is how a session crosses domains or arrives from an email link.
3. **Cookie.** `_kid_sid` present and valid: adopt it. No network.
4. **Cold human.** No carrier. The adapter MUST produce an id without blocking the response. The v1 default is:
   - mint an id in the mint grammar,
   - set the cookie,
   - seed the page with it,
   - post the server-plane event under it,
   - reconcile it with the authority after the response is sent (`proposedKidSid`), bounded at 3,000 ms, result ignored.

   An adapter MAY offer an "authority first" mode that calls resolve-anchor before responding, with no proposed id, to request a session identifier from the authority. If offered it MUST be opt-in, MUST be bounded at 1,500 ms, and MUST fall back to the local mint on any failure. It is not the default because a cold visitor should never wait on Kismet.

Fail-open means "never null for a human", not "no id". A consent-permitted human leaves with a `kid_sid`; what varies is whether the authority has heard about it yet.

The resolved decision SHOULD be passed to the page render as request-scoped data (the Next reference uses the request headers `x-kismet-kid-sid`, `x-kismet-sid-suppressed: 1` and `x-kismet-anchor-tier: threaded | cookie | authority | minted | suppressed`). The tier header on the response is useful for verification and harmless to expose.

Conformance: each of the four branches is exercised against a local stub of the authority; the cold branch asserts a response was produced before the stub was called.

### Optional returning-visitor extension (package 1.1.0)

The 1.1.0 core, Next.js and WordPress releases add a bounded visitor-cookie follow-up. This is an optional extension to Contract 1.0, separate from the planned Contract 1.1 property/conversion changes. It requires an explicit consent hook or consent-cookie configuration, adapter opt-in and collection enablement at Kismet. Geography alone does not enable it.

The follow-up sends `visitorConsent: true`, the established page session as `proposedKidSid`, and `cookieKidVid` when present to the tracking-key-authenticated resolve-anchor endpoint. It waits at most one second and persists the returned visitor token only when the returned session matches the page session. It does not block page rendering or replace that session. The normal page-resolution path above remains asynchronous.

A valid visitor token can link a new session after loss of the session cookie; it does not authenticate a guest or authorize wallet access. Token expiry is 400 days from issuance, and browser policies or user deletion can shorten cookie persistence. Consent withdrawal clears both cookies on the next adapter request; immediate in-page withdrawal must invoke the site's consent refresh flow.

## 6. Resolve-anchor (the authority)

`POST https://api.ksmt.app/v1/identity/resolve-anchor`

Headers: `Content-Type: application/json`, `X-Kismet-Tracking-Key: ctk_…`.

Body. Every field is optional except `collectionSlug` and `origin`; the authority silently drops anything not listed, so an adapter MUST send exactly these names. Values are the **visitor's**, never the adapter's own request headers. Send the original values in the documented fields without hashing them.

```json
{
  "collectionSlug": "sea-view-stays",
  "vrSlug": null,
  "origin": "https://example.co.uk",
  "proposedKidSid": "kid_Ab3dE9xZ",
  "threadedKidSid": null,
  "cookieKidSid": null,
  "cookieKidVid": null,
  "ip": "203.0.113.7",
  "userAgent": "Mozilla/5.0 …",
  "acceptLanguage": "en-GB,en;q=0.9",
  "referrer": "https://www.google.com/",
  "gclid": null,
  "gbraid": null,
  "wbraid": null,
  "gadCampaignId": null,
  "fbclid": null,
  "landingUrl": "https://example.co.uk/stays/porthleven?gclid=…"
}
```

Field rules:

- `origin` is the site origin (scheme and host) or, from the WordPress plugin, the bare host. Either is accepted.
- `ip` is the first hop of `X-Forwarded-For`, or `cf-connecting-ip`, or the socket address, in that order of preference.
- Click ids (`gclid`, `gbraid`, `wbraid`, `gadCampaignId` from `gad_campaignid`, `fbclid`) are read off the landing URL and MUST match `^[A-Za-z0-9._-]{1,512}$` or be sent as null. This is first-touch capture: Google's offline conversion upload is keyed on these, so an adapter that drops them makes the site's paid bookings unattributable.
- `landingUrl` is the full URL of this request as the visitor saw it (public scheme and host reconstructed from forwarded headers when the server sits behind a proxy).
- `proposedKidSid` is set only on a cold-mint reconcile. `threadedKidSid` and `cookieKidSid` only on a threaded hop.

Response, `200`:

```json
{ "ok": true, "kid_sid": "kid_Ab3dE9xZ", "kid_vid": "vid_…", "isNew": true, "tier": "proposed" }
```

An adapter MUST validate `kid_sid` against the read grammar and `kid_vid` against its grammar before using either. Any non-2xx, timeout, malformed body or `ok: false` is treated as "no answer": the adapter keeps the id it already has.

Errors: `401 { "ok": false, "error": "INVALID_TRACKING_KEY" }` when the key is missing, wrong, or not for `collectionSlug`; `400` with an error code for a malformed body; `500 RESOLVE_FAILED`.

Timeouts: 3,000 ms after the response (reconcile), 1,500 ms on the critical path (authority-first mode only).

## 7. The page seed and the k.js tag

A page served to a human MUST carry, in `<head>`, in this order:

```html
<script>window.Kismet=window.Kismet||{};window.Kismet._kidSid="kid_Ab3dE9xZ";</script>
<script async src="https://kismet.travel/k.js?c=sea-view-stays"></script>
```

A page served to a suppressed visitor (bot, or consent denied) MUST seed the suppression flag instead of an id:

```html
<script>window.Kismet=window.Kismet||{};window.Kismet._sidSuppressed=1;delete window.Kismet._kidSid;</script>
```

Rules:

- The seed precedes the k.js tag. k.js adopts `window.Kismet._kidSid` over its own cookie read, and re-reads the seed once the head has parsed, so a parser-inserted tag that evaluates early is still fine. A page with neither seed nor suppression flag makes k.js mint its own id, which forks the visitor.
- Renderers that reorder scripts (React 19 hoists any `<script async src>` element ahead of other head content) MUST NOT emit the k.js tag as a separate element. Emit one inline script that sets the seed and then appends the k.js tag itself; the WordPress plugin's bootstrap and `@kismet-tech/telemetry-next` both do this.
- The `?c=` parameter is the collection slug.
- The adapter MUST NOT set or read the globals `__kismetKjs`, `__kismetKjsEval`, `__kismetKjsTag` or `__kismetAnalyticsAdapterMounted`. k.js owns them; reusing one caused a production outage on 2026-07-09.
- The seed value is per visitor. See section 10 for what that means for caching.

**Cache-safe variant.** A site that serves full-page-cached HTML cannot inline a per-visitor seed. The WordPress plugin uses a constant bootstrap in `<head>` that calls a never-cached, same-origin endpoint on every visit. That endpoint evaluates current consent before adopting an existing identifier and returns the resolution of section 5. The bootstrap seeds a permitted session and then loads k.js. A suppressed response, endpoint failure or 1,500 ms timeout sets suppression and does not load k.js. This keeps page rendering independent of tracking and prevents a retained cookie from bypassing current consent. Any adapter MAY implement this variant.

## 8. Server-plane content events

`POST https://kismet.travel/api/track` (default) or `POST https://api.ksmt.app/v1/content-events` with a service key.

Headers: `Content-Type: application/json`, `X-Kismet-Tracking-Key: ctk_…`.

Sent for every page request and every agent-surface request, after the identity decision, scheduled so it never delays the response, bounded at 2,000 ms, failures swallowed. Not sent for assets, the adapter's own API routes, `robots.txt` or sitemaps.

Body (field order is the reference emitter's; keep it):

```json
{
  "trackingMode": "server",
  "pageUrl": "https://example.co.uk/stays/porthleven/harbour-house?in=2026-10-03&out=2026-10-06&party=4",
  "responseStatus": 200,
  "clientSessionId": "kid_Ab3dE9xZ",
  "resourceClass": "content_vr",
  "actionType": "property_view",
  "collectionSlug": "sea-view-stays",
  "vacationRentalSlug": "harbour-house",
  "stayCheckIn": "2026-10-03",
  "stayCheckOut": "2026-10-06",
  "guestCount": 4,
  "servingDomain": "example.co.uk",
  "isBot": false,
  "botName": null,
  "botCategory": null,
  "verifiedBot": false,
  "userAgent": "Mozilla/5.0 …",
  "clientIp": "203.0.113.7",
  "country": "GB",
  "referrer": "https://chatgpt.com/"
}
```

Field rules:

| Field | Rule |
|---|---|
| `trackingMode` | Always `"server"` from an adapter. |
| `pageUrl` | The public URL as the visitor requested it, scheme and host reconstructed from `X-Forwarded-Proto` and `X-Forwarded-Host` when behind a proxy. Keep the query string and any `.md` suffix. |
| `clientSessionId` | The resolved `kid_sid` for a human page view. **Null for a bot, even one echoing a shared `?kid_sid=` link, and null for every agent-surface fetch.** |
| `resourceClass` | `content_vr` when the page is one property, else `content_vrm`. Allowed values: `content_vr`, `content_vrm`, `content_vr_rates`, `content_vr_reviews`, `content_marketing`. |
| `actionType` | `fetch` for an agent surface; `cta_click` for a booking-engine intent page with a resolved property; `property_view` for a property page; otherwise `view`. Other values (`click`, `add_to_wishlist`, the `form_*` family, `meeting_booked`, `nl_ask`) belong to the client plane. |
| `vacationRentalSlug` | The Kismet property slug when the adapter knows it; null otherwise. Ingest attributes `.md` fetches to a property by serving URL, so agent events land correctly without it. |
| `stayCheckIn`, `stayCheckOut`, `guestCount`, `promoCode` | Parsed off the URL when present (`in`/`out`/`party`, or `checkin`/`checkout`/`guests`, ISO or US dates normalized to `YYYY-MM-DD`). Omitted, not null, when absent. |
| `servingDomain` | Request host with leading `www.` and port stripped. |
| `isBot`, `botName`, `botCategory` | The shared vocabulary's verdict as a hint. Ingest re-classifies from the raw `userAgent` and its verdict wins. Categories: `training`, `search`, `commerce`, `assistant`. |
| `userAgent` | Raw. Required for classification. |
| `clientIp` | Visitor IP address from the trusted request context. Send it unmodified as `clientIp`; `ipHash` is not an accepted request field. |
| `country`, `city`, `region` | From the platform's geo headers when available; null otherwise. |
| `referrer` | The `Referer` header, raw. |

**Agent surfaces.** A request for a markdown twin (`/<page>.md`, `Accept: text/markdown` outranking `text/html`), `/llms.txt`, `/.well-known/llm-index.json`, or an equivalent the adapter serves, is an agent fetch: no identity work, no cookie, no seed, one event with `actionType: "fetch"` and a null session.

**Bot vocabulary.** The pattern table is published in `@kismet-tech/edge-events` (`bot-patterns.generated.js`, generated from the platform's `bot-patterns.json`) and mirrored in the WordPress plugin. An adapter in a language without the package MUST carry the same table; the conformance suite checks a fixed list of user agents against it.

Response: `200 { "success": true }`. `400` for an invalid `trackingMode`, `resourceClass` or `actionType`; `401` when server mode has no key and enforcement is on; `429` above 120 requests per minute per source address at the relay.

Conformance: the suite captures the event posted for a human page, a bot page, and an agent surface and asserts every field rule above.

## 9. Booking bridge

The deterministic join between a session and a completed reservation. Call it once, server side, from the code path that knows the booking succeeded (a checkout confirmation handler, an order-complete hook). Do not scrape it from the confirmation page in the browser; k.js already does that for engines it knows, and the point of the adapter is a reliable server-side call.

`POST https://api.ksmt.app/v1/booking-bridge`

Headers: `Content-Type: application/json`, `X-Kismet-Tracking-Key: ctk_…`.

```json
{
  "kidSid": "kid_Ab3dE9xZ",
  "confirmationCode": "EX-48213",
  "reservationId": null,
  "bookingEngine": "custom",
  "domain": "example.co.uk"
}
```

Rules:

- `kidSid` and `domain` are required. One of `confirmationCode` or `reservationId` is required. Send the confirmation code the guest sees; send `reservationId` when the value is the PMS's own id (a 24-hex Guesty id, for example). The platform matches on whichever the PMS webhook later carries.
- A confirmation code MUST be 6 to 64 characters and contain at least one digit. Plain words are rejected downstream.
- `bookingEngine` names the engine: `icnd`, `guesty`, `homerunner`, `kismet`, or a free label such as `custom`.
- The bridge row lives 24 hours. A reservation whose PMS webhook arrives later than that falls back to the quote-capture match.

Response: `201 { "ok": true, "bridgeId": "…", "expiresAt": "…" }`. `400` on a body that fails the rules.

The route is public today (validated in-handler in later versions); adapters MUST send the tracking key anyway so they conform when validation lands. From a browser, k.js posts the same body to `https://kismet.travel/api/k/booking-bridge` with a bridge token; that path is the client plane and not an adapter concern.

## 10. Quote capture

Optional. Records a price the guest saw for a stay, keyed to the session, so a reservation with no bridge can still be matched on property and dates. Call it from the server code that returns a quote, after the response is sent.

`POST https://api.ksmt.app/v1/quote-capture`

```json
{
  "kidSid": "kid_Ab3dE9xZ",
  "bookingEngine": "custom",
  "listingId": "12345",
  "pageUrl": "https://example.co.uk/stays/porthleven/harbour-house",
  "vrSlug": null,
  "collectionSlug": "sea-view-stays",
  "checkIn": "2026-10-03",
  "checkOut": "2026-10-06",
  "externalQuoteId": null,
  "totalAmountCents": 57500,
  "currency": "GBP",
  "domain": "example.co.uk"
}
```

`kidSid` is required; everything else optional. `pageUrl` lets the platform resolve the property when the adapter has no slug. `totalAmountCents` is an integer in minor units. Rows live 30 days. Response `201`.

## 11. Caching

- A response that inlines a per-visitor seed MUST carry `Cache-Control: private, no-store`. Cached HTML with a seed hands one visitor's identity to everyone who hits the cache.
- A site that must cache HTML uses the cache-safe variant in section 7 and never inlines the id.
- The `Set-Cookie` for `_kid_sid` MUST be on a response that is not cached by a shared cache, for the same reason.
- Content events and reconcile calls are never on the critical path, so caching the page does not lose the server-plane record only if the adapter runs on the cache miss path. Where a CDN serves hits without the adapter, the operator should know those hits are invisible to the server plane; the install report (in development) shows this as a coverage gap.

## 12. Crossing a boundary

**Same registrable domain, different surfaces** (a WordPress root and a Next.js app under a path, or `www` and apex): the dotted cookie domain of section 4 is the whole mechanism. Both adapters adopt the same `_kid_sid`; whichever the visitor hit first minted it. Each surface still emits its own server-plane events and seeds its own pages.

**Different domains** (a marketing site and a separately hosted booking engine): the sending side appends `?kid_sid=<id>` to the outbound link; the receiving side adopts it using the threaded-carrier rule and reports the supplied identifiers to the authority. k.js does this automatically for links it can see; a server-rendered link the adapter generates SHOULD append it too.

**Email and campaign links**: the platform's link proxy threads `?kid_sid=` on click; nothing for the adapter to do beyond rule 1.

## 13. What is booking-shaped, and what is not

The contract is meant to be booking-type agnostic (booking-type agnostic by design). Sections 3 to 8 and 11 to 12 are: they describe a visitor, a page, an agent and a session, and apply unchanged to a hotel, a tour operator, a lead-gen site or a SaaS signup. Sections 9 and 10 are booking-shaped by name (`confirmationCode`, `checkIn`, `checkOut`), and the stay parameters in section 8 are optional. A non-lodging site conforms by leaving them out.

Planned for 1.1, not in this version: a generic conversion event (`POST /api/k/conversion` with `kidSid`, `conversionType`, `conversionId`, optional value and currency) of which the booking bridge becomes one type; and `externalListingId` on content events and quote capture, the site's own PMS listing id, resolved to the Kismet property at ingest, so a site never has to know Kismet slugs. Adapters MAY send `externalListingId` under 1.0; ingest drops unknown fields, so it is harmless until it is read.

## 13a. Funnel stages and what lights them

The platform derives a journey stage per session and property from the events above. An adapter that emits only collection-level `view` leaves every visitor at `researching`. To light the rest, the adapter needs to know which URLs are which, which is why every adapter takes a route profile (property page matcher, search paths, intent path with stay parameter names, agent-surface paths) and maps automatically:

| Stage | Signal | Who emits it |
|---|---|---|
| researching | `view` on a results or content page | Adapter, server plane |
| viewed | `property_view` on `content_vr` with a property identifier | Adapter from the route profile, or the browser helper |
| shortlisting | `add_to_wishlist` with a property | Browser helper only (a save is a click) |
| planning | `property_view` with `stayCheckIn` and `stayCheckOut` | Adapter when the URL carries dates; browser helper when the visitor picks them |
| intent | `cta_click` with a property and the stay | Adapter on the intent path; browser helper on a book button |
| conversion | Booking bridge (section 9) | Server, from the checkout handler |

Browser helpers dispatch `kismet:visitor:*` CustomEvents that k.js bridges to the client plane; they never call `window.Kismet.track()` directly, which omits `resourceClass` and is rejected.

**How a property is identified.** An adapter never needs to know Kismet's slugs. Three resolutions, in the order the platform applies them:

1. `vacationRentalSlug` when the site does know it (Kismet-built sites).
2. `pageUrl` against the collection's registered serving URLs. For a site Kismet serves, these exist by construction; for a self-hosted site paired with a PMS, Kismet registers them once from the site's sitemap. This is the zero-configuration path and the only one that attributes crawler and agent fetches to a property.
3. `externalListingId`, the site's own PMS listing id, resolved at ingest within the collection (contract 1.1; safe to send under 1.0).

A site with no Kismet catalog (the self-serve start) sends its own identifier as `externalListingId` and gets page-level reporting; per-property funnel stages need a catalog to resolve against.

## 14. Errors and fail-open behaviour

| Situation | Adapter behaviour |
|---|---|
| No tracking key configured | Resolve locally, set cookies, seed the page, log one warning. Post no events and no reconcile (they would be rejected). |
| Authority unreachable or slow | Keep the local id; the reconcile is retried on the next cold visit only in the sense that a new visitor gets a new reconcile. No queueing. |
| Relay returns non-2xx for an event | Drop it. Never retry on the request path. |
| Threaded id fails the read grammar | Treat as absent; fall through to the cookie. |
| Cookie value fails the read grammar | Treat as absent; fall through to bot and consent checks, then mint. |
| Authority returns an id that fails the grammar | Ignore the response entirely. |
| Adapter throws anywhere | The page MUST still be served. Wrap the whole adapter in a guard that degrades to "no tracking on this request". |

## 15. Conformance requirements

The shared suite runs an adapter against a local stub of the authority and the relay and asserts:

1. Mint grammar (section 3).
2. Cookie names, ages, attributes and domain rule; no cookie for bots or consent-denied visitors (section 4).
3. The four resolution branches, with the cold branch responding before any network call (section 5).
4. The resolve-anchor body carries exactly the declared field names, visitor values, click ids from the landing URL, and `proposedKidSid` on a cold mint (section 6).
5. The seed precedes the tag, carries the resolved id or the suppression flag, and touches no reserved global (section 7).
6. Content event field rules for a human page, a bot page and an agent surface, including a null session on both non-human cases (section 8).
7. `Cache-Control: private, no-store` on any response carrying an inline seed (section 11).
8. No request is delayed by more than the adapter's own compute when the stub authority and relay are made to hang (sections 5, 8, 14).

An adapter that does not ship the suite does not ship.

## 16. Known drift in shipped implementations (as of 2026-09-03)

Recorded so a reader comparing this document to the code is not surprised. Each is scheduled to close in a 1.x release.

- The Next.js reference implementation (on `@kismet-tech/edge-events` 0.1.0) sets host-only cookies and asks the authority before responding on a cold visit (1,500 ms cap). Contract v1 requires the dotted domain and makes local mint the default. Closed by the Next adapter 1.0.
- The Kismet Elements WordPress plugin (0.1.74) already does local mint plus async reconcile and the dotted domain. Its resolve body omits `landingUrl` and the click ids, so first-touch capture on a WordPress landing is missing. Closed by the WordPress alignment slice.
- The edge worker reads `cf-connecting-ip` and `request.cf` geo; adapters behind other proxies read forwarded headers. Both are conformant.
- The relay's server-mode key check and the API's content-event key check run in warn mode. Adapters MUST behave as though they are enforced.

## 17. Versioning

The contract carries a major.minor version. A minor version adds optional fields or endpoints and never changes an existing rule; every 1.x adapter stays conformant. A major version may change a rule and ships with a migration note. Each adapter declares the contract version it conforms to in its README and its changelog, and the conformance suite is versioned with the contract.

Changelog:

- **1.0 (2026-09-03, draft).** Extracted from the shipped worker, Next reference, WordPress plugin and the platform routes. Decisions taken here rather than inherited: dotted cookie domain as the rule; local mint plus async reconcile as the default; the consent hook as a MUST; the tracking key on the bridge and quote calls.

### Consent suppression clarification

Current consent takes precedence over a session cookie or threaded identifier. For a suppressed visitor, emit the suppression seed without loading the browser tracker. This prevents an older browser tracker from adopting a retained cookie. Consent changes within an already loaded page require integration with the consent manager; navigation-based validation does not establish in-page revocation behavior.
