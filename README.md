# Kismet Telemetry

Server-side tracking for sites that run on your own stack. One versioned HTTP contract, a small core, and thin adapters per framework, so an engineering team can install Kismet tracking from the docs without Kismet in their request path.

Docs: https://developers.kismet.travel/telemetry/. Contract: [docs/CONTRACT.md](docs/CONTRACT.md).

## Packages

| Package | Registry | Status |
|---|---|---|
| [`@kismet-tech/telemetry`](packages/telemetry) | npm | 1.0.0 published: the core, contract 1.0 as code, browser helpers, conformance harness |
| [`@kismet-tech/telemetry-next`](packages/telemetry-next) | npm | 1.0.0 published 2026-09-04, live-smoked |
| [`@kismet-tech/telemetry-node`](packages/telemetry-node) | npm | 1.0.0 published 2026-09-04, live-smoked |
| [`kismet-telemetry`](packages/telemetry-wordpress) (WordPress plugin) | source and zip build script | 1.0.1 source available for review; real WordPress validation pending |
| `kismet-telemetry` (Django) | PyPI | planned |

Every adapter runs the same conformance suite (`@kismet-tech/telemetry/conformance`) against a stub authority and relay. An adapter that does not pass does not ship.

This public repository was opened for source review on 2026-09-09. It contains the licensed 1.0.1 source candidate; npm 1.0.0 remains the published package version. This source publication does not announce a new npm release.

## Review before installing

Read [what is installed and sent](docs/data-flow.md), including the separately served browser tracker and catalog prerequisites. Kismet supplies tracking keys through onboarding. The dedicated install report and self-serve key flow are not included in this release.

## What you get on install

Page and crawler requests that execute the adapter are recorded server-side, with a first-party session for consenting humans. WordPress full-page cache hits can bypass the server beacon. The booking bridge connects a confirmed reservation to its session. Property-level attribution and reporting require the corresponding Kismet configuration and backend support.

## Repository layout

- `packages/telemetry`: the core. `npm test` runs the unit tests and the reference adapter through the full conformance suite; `npm run build` emits ESM and CJS.
- `packages/telemetry-next`, `packages/telemetry-node`: the Next.js and Node adapters. `npm test` builds and runs each through the conformance suite.
- `packages/telemetry-wordpress`: the standalone WordPress plugin. `php tests/pure.test.php` and `bin/build-zip.sh`.
- `docs/CONTRACT.md`: the contract every adapter implements. `docs/install-*.md`: install outlines per site shape.
- `.github/workflows`: the PR guard and the manual publish.

## Bot vocabulary

`packages/telemetry/bot-patterns.json` is a vendored copy of the platform's vocabulary. `npm run generate:check` fails when the generated table lags the JSON; the platform side checks that the vendored copy matches its source.

## License

The source in this revision is licensed under [Apache-2.0](LICENSE). Package version 1.0.1 is prepared but unreleased; previously published 1.0.0 artifacts retain their original metadata. See [NOTICE](NOTICE). Dependencies retain their own licenses.
