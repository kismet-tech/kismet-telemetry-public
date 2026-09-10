# Changelog

## 1.0.1 (unreleased)

- Withhold the browser tracker on suppressed sessions, including anchor failure, to prevent retained cookies from being reused by the browser tracker.

- Recheck consent before adopting an existing or threaded identity and before attaching a session to property events. The browser bootstrap checks the anchor even with a warm cookie and suppresses identity on anchor failure.
- Add a disposable real WordPress HTTP fixture for cookie, consent, crawler, property-event and simulated booking-bridge validation. The post-fix HTTP suite passes; full browser and mixed-site validation remain pending.
- Include Apache-2.0 license and notices in the zip.
- Remove unverified WordPress tested-version claim; staging validation remains pending.

All notable changes to the `kismet-telemetry` WordPress plugin. Each entry names the tracking contract version it conforms to.

## 1.0.0 (unreleased)

Conforms to contract 1.0.

- First standalone release, extracted from the Kismet Elements plugin's identity anchor and server beacon.
- Differences from the Elements copy, all contract alignment: first-touch capture on the reconcile (landing URL and click ids were missing); a declined or bot visitor is seeded with the suppression flag instead of letting k.js mint a throwaway id; a consent mode that reads the site's consent manager cookie, since most hosts send no country header; a route profile (property pattern, results paths, checkout path) so the server plane lights the funnel; the shared bot vocabulary generated from the vendored JSON instead of a hand list; `externalListingId` on property events.
- Coexists with Kismet Elements: takes over its anchor and beacon when both are active and inherits its slug and key.
- Settings screen under Settings, Kismet Telemetry. Tracking key encrypted at rest.
