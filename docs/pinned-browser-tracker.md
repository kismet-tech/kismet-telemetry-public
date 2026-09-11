# Pinned browser tracker

The optional pinned browser tracker is versioned independently of the npm adapters. Release 1.0.0 works with telemetry Next.js and WordPress 1.1.0. It requires a consent-permitted session supplied by the adapter. Existing installations keep their current configuration until their operator changes it.

## Install

Use this exact URL, without a `?c=` query (the adapter adds the collection):

```text
https://kismet.travel/telemetry/kjs/1.0.0/1b99da0860e5e80a3ae84c970ff1725916123c97694fcd1400f939f92007ec11/k.js
```

Next.js, in the existing root layout:

```tsx
<KismetSeed
  collectionSlug={process.env.KISMET_COLLECTION_SLUG!}
  kjsUrl="https://kismet.travel/telemetry/kjs/1.0.0/1b99da0860e5e80a3ae84c970ff1725916123c97694fcd1400f939f92007ec11/k.js"
/>
```

WordPress, in `wp-config.php` before loading WordPress:

```php
define('KISMET_TELEMETRY_KJS_URL', 'https://kismet.travel/telemetry/kjs/1.0.0/1b99da0860e5e80a3ae84c970ff1725916123c97694fcd1400f939f92007ec11/k.js');
```

Keep the existing tracking-key, consent and visitor-recognition settings. `_kid_vid` remains managed by the adapter and its authority; changing the browser script URL does not activate or disable that feature.

## Review and upgrades

The URL contains both the release version and a SHA-256 content hash. The file is readable JavaScript. Its exact bytes are checked in, never rebuilt during a deployment, and must not be changed or removed. A new release gets a new directory and URL. No `latest` alias or redirect participates in this path. Customers review the source/diff and change their configured URL to upgrade. Rollback means restoring their previous release URL. Security fixes also require an explicit upgrade; Kismet must notify affected customers.

SHA-256: `1b99da0860e5e80a3ae84c970ff1725916123c97694fcd1400f939f92007ec11`

Subresource integrity, for manually managed script tags supporting SRI: `sha384-ZnAv3qLHY34352QLPFyYH+7h4dmD75gpF2Hg8ckHts7TY113S70hRy8t+ehEIQP4`. Current adapter URL overrides do not automatically add an integrity attribute. Hosts can also serve the exact reviewed file themselves and use that URL.

## What is fixed and what remains live

This release cannot load Google Tag, GA4, Meta or OpenAI SDK scripts. It does not set Google Consent Mode defaults. Host-installed analytics remain under the host's control; existing event bridges may call an analytics API the host already installed.

Kismet configuration and ingestion APIs remain live services. Configuration supplies data such as collection identifiers, geography, verification/bridge tokens and booking-engine selection. It cannot supply executable JavaScript or a new script URL to this release. API responses can still affect behavior implemented in the reviewed file. Pinning browser code does not freeze backend processing, data retention or the site's own scripts.

