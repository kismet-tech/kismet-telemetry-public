# Pinned browser tracker

The optional pinned browser tracker is versioned independently of the npm adapters. Release 1.1.0 supports configured Google, GA4, Meta and OpenAI tags and works with telemetry Next.js and WordPress 1.1.0 or later. On hosts without country headers, configure an explicit default-denied consent hook; the next adapter patch also denies missing geography by default. It requires a consent-permitted session supplied by the adapter. Existing installations keep their current configuration until their operator changes it.

For your own consent banner, use [browser 1.2.0 with the consent bridge](consent.md). It follows explicit analytics and advertising choices and reloads after saved changes so server adapters and vendor scripts follow the new choice.

## Install

Use this exact URL, without a `?c=` query (the adapter adds the collection):

```text
https://kismet.travel/telemetry/kjs/1.1.0/68dc1119a46da113d95b245a1a19a8df31adc3cdf3de0863075671a70aab6887/k.js
```

Next.js, in the existing root layout:

```tsx
<KismetSeed
  collectionSlug={process.env.KISMET_COLLECTION_SLUG!}
  kjsUrl="https://kismet.travel/telemetry/kjs/1.1.0/68dc1119a46da113d95b245a1a19a8df31adc3cdf3de0863075671a70aab6887/k.js"
/>
```

WordPress, in `wp-config.php` before loading WordPress:

```php
define('KISMET_TELEMETRY_KJS_URL', 'https://kismet.travel/telemetry/kjs/1.1.0/68dc1119a46da113d95b245a1a19a8df31adc3cdf3de0863075671a70aab6887/k.js');
```

Keep the existing tracking-key, consent and visitor-recognition settings. `_kid_vid` remains managed by the adapter and its authority; changing the browser script URL does not activate or disable that feature.

## Review and upgrades

The URL contains both the release version and a SHA-256 content hash. The file is readable JavaScript. Its exact bytes are checked in, never rebuilt during a deployment, and must not be changed or removed. A new release gets a new directory and URL. No `latest` alias or redirect participates in this path. Customers review the source/diff and change their configured URL to upgrade. Rollback means restoring their previous release URL. Security fixes also require an explicit upgrade; Kismet must notify affected customers.

SHA-256: `68dc1119a46da113d95b245a1a19a8df31adc3cdf3de0863075671a70aab6887`

Subresource integrity, for manually managed script tags supporting SRI: `sha384-UGyfO4r1nOGus+hOOT0yQIMZ1bxYS6u/mh2S4SerhWD95mrJlitacD6UxYo3tMHY`. Current adapter URL overrides do not automatically add an integrity attribute. Hosts can also serve the exact reviewed file themselves and use that URL.

## What is fixed and what remains live

Release 1.1.0 retains tag management: configuring a Google tag, GA4 property, Meta pixel or OpenAI pixel changes the enabled destinations on the next page load, without replacing Kismet's pinned loader. Removing their IDs disables loading by this script. Third-party SDK URLs are vendor-managed and their contents may change independently; pinning Kismet code does not pin those SDKs. Customers must approve which integrations are enabled and wire their CMP's analytics and advertising choices. EEA/UK/Switzerland and missing geography default to denied for Google Consent Mode, and Meta/OpenAI loaders are withheld by that geography gate. The adapter's permitted session is required before this script starts.

Release 1.0.0 remains available as the restricted profile with no third-party script loaders. Its published bytes and URL are unchanged. Choose it when no vendor-managed code should be loaded through Kismet.

Kismet configuration and ingestion APIs remain live services. Configuration supplies data such as collection identifiers, geography, verification/bridge tokens and booking-engine selection. It cannot supply executable JavaScript or a new script URL to this release. API responses can still affect behavior implemented in the reviewed file. Pinning browser code does not freeze backend processing, data retention or the site's own scripts.

## Validation

Release validation covers enabled and disabled destinations, changed tag IDs, denied or missing geography, and suppressed adapter sessions. Third-party requests are intercepted during local tests. Customer consent-manager wiring and production ingestion are verified during installation.
