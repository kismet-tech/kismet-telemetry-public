# Connect your existing consent banner

Browser tracker 1.2.0 supports a site's own consent manager. Your banner remains the source of truth. Kismet supplies a versioned bridge that reads its analytics and advertising choices; the WordPress and Next.js adapters read the same saved choice on the server.

Share your banner/CMP name, consent-cookie format and saved-choice event with Kismet if you would like us to prepare the configuration. GTM itself does not identify which consent manager you use.

## 1. Connect the server adapters

Configure an explicit analytics-consent hook on both WordPress and Next.js. Start denied and return true only for the banner's positive analytics choice. The saved choice must be available to both frameworks, normally in a cookie with `Path=/` and the shared site domain. A browser-only localStorage value is not visible to server middleware.

- WordPress: use the consent-manager cookie settings with a pattern matching acceptance, or the `kismet_telemetry_should_set_cookies` filter. WordPress 1.1.1 also denies missing geography by default.
- Next.js: use the middleware's `consent` callback or `consentFromCookie(cookieName, acceptancePattern)`. Existing published npm versions need this explicit hook on hosts without country headers.

Do not treat cookie presence as acceptance. Many banners save a cookie for rejected choices too. Server sessionless request collection is separate from browser consent gating; review the [data-flow guide](https://developers.kismet.travel/telemetry/data-flow/) for that behavior.

## 2. Load the consent bridge before the adapter

Load this fixed script in the page head, without `async` or `defer`, before configuring consent and before the telemetry bootstrap:

```html
<script
  src="https://kismet.travel/telemetry/kjs/1.2.0/41f3829d51c1ac668eec3290824282e278821388af0b4345e87a687ad35a1df7/consent.js"
  integrity="sha384-2D4kI7lVXp3b8r2guu2UByPptb3obO5R89R1HzOihVATvZbn5R5ghqakvz3ZDGTN"
  crossorigin="anonymous"
></script>
<script>
  window.KismetConsent.configure({
    getConsent: readSavedBannerChoices,
    subscribe: onBannerChoiceSaved,
  })
</script>
```

`readSavedBannerChoices` and `onBannerChoiceSaved` are integration functions you supply for your banner, not built-in Kismet or CMP functions:

```js
// Example only: a JSON cookie named site_consent, and a saved-choice event.
// Replace these names and fields with your CMP's actual contract.
function readSavedBannerChoices() {
  const match = document.cookie.match(/(?:^|;\s*)site_consent=([^;]*)/)
  if (!match) return { analytics: false, advertising: false }
  const choices = JSON.parse(decodeURIComponent(match[1]))
  return {
    analytics: choices.analytics === true,
    advertising: choices.advertising === true,
  }
}

function onBannerChoiceSaved(changed) {
  window.addEventListener('site:consent-saved', changed)
  return () => window.removeEventListener('site:consent-saved', changed)
}
```

Define these functions before calling `configure`. This example does not identify your CMP; replace its cookie, field and event names with the actual values. Kismet can replace them with working code for your CMP. If your existing banner handler already receives the choices, it can call `KismetConsent.update({ analytics: true, advertising: false })` after saving them. `KismetConsent.refresh()` re-reads the configured provider. `getState()` exposes the current `{analytics, advertising, ready}` snapshot for validation.

Put the same bridge and configuration on both frameworks. On WordPress, insert it before the plugin's `wp_head` priority-0 bootstrap, for example through your site's integration plugin at priority -10. In Next.js, put it before `KismetSeed` in the root layout. Keep CSP allowances or nonces consistent with your existing inline-script policy.

Missing configuration, errors, non-boolean values and reads that exceed 1.5 seconds remain denied. Advertising permission also requires analytics permission for this tracker. Geography cannot override the explicit banner choice in this release.

## 3. Select browser tracker 1.2.0

Use this exact URL in the adapter, without adding the collection query yourself:

```text
https://kismet.travel/telemetry/kjs/1.2.0/b20c243e4fa25f9f24ad6c8a7b711936cce76d1fb098e23d5249db3dbc53e1f7/k.js
```

Next.js:

```tsx
<KismetSeed
  collectionSlug={process.env.KISMET_COLLECTION_SLUG!}
  kjsUrl="https://kismet.travel/telemetry/kjs/1.2.0/b20c243e4fa25f9f24ad6c8a7b711936cce76d1fb098e23d5249db3dbc53e1f7/k.js"
/>
```

WordPress, in `wp-config.php` before WordPress loads:

```php
define('KISMET_TELEMETRY_KJS_URL', 'https://kismet.travel/telemetry/kjs/1.2.0/b20c243e4fa25f9f24ad6c8a7b711936cce76d1fb098e23d5249db3dbc53e1f7/k.js');
```

The bridge and tracker are separately hashed, fixed files in one reviewed release. Review both. Existing released URLs are unchanged; installation requires explicitly selecting this version. Existing unversioned Kismet-managed installations retain their current behavior.

## Consent changes and vendor tags

The initial saved choice is read without reloading. Later changes immediately suspend Kismet browser emissions while being read. Once the saved categories change, the bridge updates the gates and reloads the page. This is intentional: the server adapters must re-read the cookie, and vendor SDKs already running cannot reliably be unloaded in place. Install the callback at the banner's saved-choice step and account for the reload in checkout or other unsaved forms. Repeating the same choice does not reload.

Analytics withdrawal clears Kismet identity/attribution cookies and stamped form identifiers. Advertising withdrawal clears `_fbc`/`_fbp`, revokes Meta consent when present, updates the loaded tracker's Google consent state, and reloads. The CMP and vendor integrations remain responsible for their other cookies. Requests already sent cannot be recalled.

Analytics-only consent enables Kismet browser events and configured GA4. Configured Google advertising tags, Meta and OpenAI SDKs require advertising consent too. Denied advertising match fields are removed from browser event payloads. Vendor SDK contents remain vendor-managed, even though Kismet's loader is pinned. This bridge does not control scripts installed separately by the site.

## Validate before production

1. No saved choice or rejection: no Kismet browser events or vendor SDK loading; no Kismet identity cookies after the consent check.
2. Accept analytics only: after the reload, the adapters establish the permitted session; configured GA4 may load, advertising SDKs do not.
3. Accept advertising too: after the reload, only configured vendor tags load.
4. Remove advertising permission: Kismet identity can remain for analytics; advertising SDKs are absent on the reloaded page.
5. Withdraw analytics: outgoing Kismet browser events stop, Kismet cookies clear and the reloaded adapters deny identity.
6. Cross WordPress, property results, property detail and checkout pages. Confirm the same saved choices and permitted session are used on both frameworks. `_kid_vid` still requires the existing visitor-recognition setup and collection enablement.

Release tests cover real Chrome with captured WordPress and Next.js bootstrap output, intercepted config/collector/vendor requests, category changes, cookie continuity, payload filtering, error handling and stale asynchronous responses. The test server supplies consent/session responses; this is not validation of a customer's actual CMP, production cache, PMS or visitor authority.
