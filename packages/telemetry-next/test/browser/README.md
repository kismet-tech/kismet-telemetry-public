# Returning-visitor browser validation

This optional maintainer test uses real Chrome, the built Next adapter, the pinned browser 1.3.0 scripts, and a disposable loopback-only recognition authority backed by PostgreSQL. It verifies cookie behavior and stored session-to-visitor linkage. It does not establish customer deployment, OAuth, a full Next router, hosted ingestion or dashboard acceptance.

Run `npm test` first. Start the existing local visitor-recognition lab documented in `packages/telemetry-wordpress/tests/mixed-site/README.md`. Never point the lab at a customer or production database.

Set these environment variables and run `npm run test:visitor-browser`:

- `PLAYWRIGHT_MODULE`: installed Playwright module path, if unavailable in normal module resolution.
- `CHROME_PATH`: Chrome executable; defaults to the standard macOS location.
- `KISMET_BROWSER_RELEASE_DIR`: reviewed browser 1.3.0 directory containing `manifest.json` and its hashed assets.
- `VISITOR_LAB_ORIGIN`: the disposable lab URL, default `http://127.0.0.1:8798`. Only a loopback HTTP origin is accepted.
- `VISITOR_RESULTS_PATH`: optional path for the JSON evidence summary.
- `TELEMETRY_PACKAGE_ROOT`: optional path to a clean installation of the candidate npm tarball, to test packaged output rather than the checkout build.

The test creates temporary Chrome profiles and a one-day self-signed certificate using OpenSSL, and serves its HTTPS fixture on loopback. External browser requests are intercepted. The account-carrier cookie and lab credential are synthetic. No customer information, hosted tracking key or live booking is used.
