# Kismet Telemetry

Visitor attribution and server-side event collection for websites built on your own stack.

Kismet Telemetry connects page visits, AI crawler requests and completed bookings to Kismet through a shared HTTP contract. A small JavaScript core and framework adapters integrate with your existing application, including sites that combine WordPress and Next.js.

[Documentation](https://developers.kismet.travel/telemetry/) · [Data flow](docs/data-flow.md) · [HTTP contract](docs/CONTRACT.md)

## Capabilities

- **Page and crawler events:** Record requests handled by your application, including crawlers that do not execute JavaScript.
- **Visitor continuity:** Carry a first-party session across supported site surfaces, with consent controls configured for your application.
- **Booking attribution:** Connect a confirmed reservation to its visitor session through a server-side booking bridge.
- **Property and funnel mapping:** Map application routes to property views, search and checkout events. Property-level attribution requires a configured Kismet catalog and supported identifier mapping.

## Packages

| Integration | Package | Availability |
| --- | --- | --- |
| JavaScript core | [`@kismet-tech/telemetry`](https://www.npmjs.com/package/@kismet-tech/telemetry) | npm 1.1.1 |
| Next.js | [`@kismet-tech/telemetry-next`](https://www.npmjs.com/package/@kismet-tech/telemetry-next) | npm 1.1.1 |
| Node.js | [`@kismet-tech/telemetry-node`](https://www.npmjs.com/package/@kismet-tech/telemetry-node) | npm 1.0.2 |
| WordPress | [Download plugin ZIP](https://github.com/kismet-tech/kismet-telemetry-public/releases/download/telemetry-wordpress-v1.1.1/kismet-telemetry-1.1.1.zip) | 1.1.1; local validation complete, site acceptance required |

The WordPress plugin, core and Next.js adapter are version 1.1.1; Node.js is 1.0.2. These versions deny cookies when country information is missing or unknown. Configure an explicit consent hook to follow your banner’s saved choice. Django support is planned.

## Getting started

1. Obtain a collection slug and server-side tracking key through Kismet onboarding, and register your site's authorized domains.
2. Install the adapter for your framework and follow its configuration guide.
3. Connect your consent manager, configure your route mappings and validate the integration on staging.

For Next.js:

```sh
npm install @kismet-tech/telemetry@1.1.0 @kismet-tech/telemetry-next@1.1.0
```

For Node.js:

```sh
npm install @kismet-tech/telemetry@1.1.0 @kismet-tech/telemetry-node@1.0.1
```

See the [Next.js guide](packages/telemetry-next/README.md), [Node.js guide](packages/telemetry-node/README.md), or [WordPress and Next.js integration guide](docs/install-wordpress-plus-nextjs.md) for configuration and booking-bridge examples. Installing a package alone does not configure tracking.

## Returning visitors

Next.js and WordPress support an opt-in `_kid_vid` cookie that links later sessions for consenting visitors. Enable the feature after Kismet configures your collection, following the [visitor-recognition guide](docs/visitor-recognition.md). Browser policies and cookie deletion can shorten its lifetime.

## Data and integration boundaries

The adapters send configured request metadata and event payloads to Kismet. They do not grant Kismet access to your source repository or upload your application code. The browser tracker is served separately from the npm packages. Review the [data-flow guide](docs/data-flow.md) for the fields collected, destinations and source-review boundaries.

Connect your existing banner through the [consent integration guide](docs/consent.md), or ask Kismet to prepare the configuration for your CMP.

Configure consent explicitly for your site. A geography fallback cannot determine a visitor's consent when the hosting platform supplies no country information. Keep tracking keys on the server.

Server-side coverage includes requests that execute the adapter. Full-page caches can bypass WordPress and its server beacon. Property-level reporting depends on catalog configuration and backend support; Contract 1.1 identifier resolution and generic conversions are separate from the Contract 1.0 integration documented here.

## Development

| Directory | Contents |
| --- | --- |
| [`packages/telemetry`](packages/telemetry) | Core library, browser helpers and shared conformance harness |
| [`packages/telemetry-next`](packages/telemetry-next) | Next.js middleware and rendering integration |
| [`packages/telemetry-node`](packages/telemetry-node) | Node.js adapter |
| [`packages/telemetry-wordpress`](packages/telemetry-wordpress) | Standalone WordPress plugin and zip build tooling |
| [`docs`](docs) | HTTP contract, data flow and integration guidance |
| [`.github/workflows`](.github/workflows) | Validation and release workflows |

The JavaScript packages include unit and conformance tests against local test services. Run the commands documented in each package's README before submitting a change. WordPress includes PHP tests and a zip build script; real-site validation is an additional requirement.

Bot classification uses the versioned vocabulary in [`bot-patterns.json`](packages/telemetry/bot-patterns.json). Run `npm run generate:check` from `packages/telemetry` to check that generated files match the vocabulary.

## License

The source in this repository is licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) for attribution. Previously published npm 1.0.0 artifacts retain their original license metadata, and third-party dependencies retain their own licenses.

## Pinned browser tracker

For review before browser-code changes, use the [pinned browser tracker](docs/pinned-browser-tracker.md). Its release URL is selected independently of the npm adapter version. The exact readable source and checksums are in [browser/1.0.0](browser/1.0.0).
