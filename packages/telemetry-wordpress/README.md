# kismet-telemetry (WordPress)

The WordPress adapter for Kismet Telemetry: the tracking contract (version 1.0) as a standalone plugin. Tracking only, no page elements. Extracted from the Kismet Elements plugin's anchor and server beacon, aligned to the contract, and given its own settings screen.

Docs: https://developers.kismet.travel/telemetry/wordpress/. Contract: [../../docs/CONTRACT.md](../../docs/CONTRACT.md).


**Contract 1.0 limit:** `externalListingId` can be emitted, but ingest-side resolution and generic conversions are Contract 1.1 additions. For property-level attribution today, arrange a registered serving-URL mapping or use a known Kismet property slug. Confirm backend support before relying on the 1.1 fields.

## What it does

- **Head bootstrap** (`wp_head`, priority 0): a site-constant script, safe to full-page cache. Warm visitors seed `window.Kismet._kidSid` from the cookie and load k.js. Cold visitors call the never-cached `kismet_telemetry_anchor` endpoint with the page URL; it resolves, sets the cookies, and answers with the id or a suppression, then k.js loads. A 1.5 s fallback loads k.js regardless.
- **Resolution** (contract section 5): threaded id, cookie, suppressed (bots, no consent), else a local mint with an after-response reconcile carrying the visitor's signals, click ids and landing URL (first-touch capture).
- **Cookies** (section 4): `_kid_sid` 90 days and `_kid_vid` about 400 days on the dotted serving domain, `SameSite=Lax`, `Secure` on HTTPS, never `HttpOnly`.
- **Server-plane beacon** (section 8): one event per PHP-served front-end GET, bots included, with the route profile deciding `view`, `property_view`, `cta_click` or `fetch`. PHP-tier capture: a request served entirely from a full-page cache is invisible here.
- **Consent** (section 4): country default, "always", or your consent manager's cookie, from the settings; developers can replace the decision with the `kismet_telemetry_should_set_cookies` filter.
- **Conversion**: `kismet_telemetry_booking_bridge()` and `kismet_telemetry_quote_capture()` for the checkout code that knows the booking succeeded.
- **Kismet Elements coexistence**: when Elements is active, its anchor bootstrap is unhooked, its beacon is switched off, and its collection slug and key are inherited when the fields here are empty.

## Settings

Settings, Kismet Telemetry. Connection (enabled, collection slug, tracking key stored encrypted, cookie domain override), Consent (mode, cookie name, value pattern), Route profile (property page pattern with the first capture group as the identifier, results paths, checkout path, stay parameter names).

Endpoint overrides for lab and staging in `wp-config.php`: `KISMET_TELEMETRY_RESOLVE_URL`, `KISMET_TELEMETRY_TRACK_URL`, `KISMET_TELEMETRY_API_ORIGIN`, `KISMET_TELEMETRY_KJS_URL`.

## Filters

- `kismet_telemetry_should_set_cookies($allow, $country)`: the consent decision.
- `kismet_telemetry_property($match, $path, $uri)`: return `['externalListingId' => '…']` or `['vrSlug' => '…']` for a property page.
- `kismet_telemetry_is_search($is, $path)`, `kismet_telemetry_intent($is, $path)`, `kismet_telemetry_is_agent_surface($is, $path)`.
- `kismet_telemetry_cookie_domain($domain)`, `kismet_telemetry_beacon_enabled($on)`.

## Develop

```bash
node scripts/generate-bot-patterns.mjs      # regenerate includes/bot-patterns.generated.php from the vendored vocabulary
php -l kismet-telemetry.php includes/*.php  # lint
php tests/pure.test.php                     # pure-function tests, no WordPress needed
bin/build-zip.sh                            # dist/kismet-telemetry-<version>.zip
```

The HTTP conformance run (contract section 15) needs a WordPress: the `kismet-local-wp` docker rig with this directory mounted as the plugin, `KISMET_TELEMETRY_RESOLVE_URL` and `KISMET_TELEMETRY_TRACK_URL` pointed at the stub authority and relay from `@kismet-tech/telemetry/conformance`, and a driver that forwards each `Request` to `http://localhost:8480` with the same headers. The HTTP harness and real staging smoke are both still pending. Pure-function tests alone do not verify a real WordPress installation.
