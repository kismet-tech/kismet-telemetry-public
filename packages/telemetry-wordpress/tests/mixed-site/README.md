# Mixed WordPress and Next.js browser validation

This fixture runs WordPress at `/` and Next.js at `/app` behind a single local origin, `http://telemetry.test:8499`. It uses a simulated checkout and a local collector. All external browser requests are intercepted; no customer data or real reservations are submitted.

## Prepare artifacts

Build and pack the core, then install that exact tarball into each adapter before building, testing and packing the adapters. Keep the artifact SHA-256 hashes with the results. Install all three candidate tarballs into `next-app` alongside its declared Next.js/React dependencies. Do not infer the core version from the adapter version: inspect the installed dependency tree.

Use the sibling `integration/compose.yml` fixture, setting `TELEMETRY_SITE_URL=http://telemetry.test:8499` on each Compose command. Follow its installation instructions. Run `wp eval-file /lab/setup.php` after setting the site URL: stored tracking keys are bound to that URL. Test credentials are local-only.

Start the Next.js fixture with `npm run dev` in `next-app`, and start `node proxy.cjs` in this directory. They listen on loopback ports 8500 and 8499 respectively. The WordPress and collector ports are 8496 and 8797.

## Run Chrome validation

Install Playwright in a local test-tools directory or supply an existing installation. Download the public browser tracker to a local file for inspection and record its SHA-256; the fixture serves that copy and intercepts all outbound destinations. Set:

- `PLAYWRIGHT_MODULE`: Playwright module path, or omit when resolvable as `playwright`.
- `CHROME_PATH`: Chrome executable, or omit to use Playwright's installed Chromium.
- `KISMET_TEST_KJS_PATH`: local copy of the browser tracker.
- `TELEMETRY_RESULTS_DIR`: output directory for JSON results, trace and screenshot.

Run `node browser.cjs`. The runner maps `telemetry.test` to loopback without modifying the hosts file. It asserts the browser stays on the shared origin.

The scenarios cover denied and consented visits, WordPress-to-Next session continuity, simulated completed-booking attribution, consent withdrawal on each surface, two visitors receiving identical cached HTML, and anchor failure. The cache scenario replays captured HTML; it is not a full CDN or WordPress cache-plugin test.

The downloaded tracker runs with a minimal mocked configuration response. This exercises identity and beacon behavior; it does not validate production configuration, delivery, analytics providers or reporting. Consent changes are tested across navigation. Immediate revocation within an already loaded page, HTTPS/proxy topology and the customer's actual consent manager and booking engine require separate staging acceptance.

## PostgreSQL-backed visitor recovery

The private infrastructure repository provides `tests/visitor-recognition/lab-server.ts`. Start it against a disposable local `visitor_test` PostgreSQL database with `PG_MODULE` and `VISITOR_TEST_DATABASE_URL` as documented there. It listens on 8798 and uses the real recognition store plus a minimal test HTTP/session/ingest shell.

Apply `integration/visitor.override.yml` with the base Compose file. It configures the existing local fixture for the visitor authority through `host.docker.internal` and the shared origin on port 8599. Re-run setup.php using the WordPress container so its tracking-key encryption uses the current site URL. Run the Next fixture with `VISITOR_LAB=1` and port 8600. Proxy `/app` to 8600 and other paths to WordPress 8496 on loopback port 8599, preserving the browser Host header. All credentials here are disposable test values.

Install candidate core and Next tarballs as above; the runtime must include the new helper, not registry 1.0.1. Run `visitor-browser.cjs` with `PLAYWRIGHT_MODULE`, `KISMET_TEST_KJS_PATH` and optionally `VISITOR_RESULTS_PATH`. It creates separate Chrome profiles and verifies nine recovery/failure scenarios. It uses Chrome on macOS and intercepts external browser traffic. Never direct this harness at a customer or production database.
