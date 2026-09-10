# WordPress HTTP validation

Disposable WordPress/PHP 8.2/Apache and MariaDB fixture with a local telemetry collector. Requires Docker Compose and Node.js 20+. Ports 8496 and 8797 bind to loopback. Credentials are test-only. WordPress HTTP requests are restricted to the collector; no production credentials are used.

Run from the repository root:

```sh
docker compose -f packages/telemetry-wordpress/tests/integration/compose.yml up -d wordpress collector
docker compose -f packages/telemetry-wordpress/tests/integration/compose.yml run --rm cli wp core install --url=http://telemetry.test:8496 --title='Telemetry validation' --admin_user=lab --admin_password=local-validation-only --admin_email=lab@example.invalid --skip-email
docker compose -f packages/telemetry-wordpress/tests/integration/compose.yml run --rm cli wp plugin activate kismet-telemetry
docker compose -f packages/telemetry-wordpress/tests/integration/compose.yml run --rm cli wp eval-file /lab/setup.php
docker compose -f packages/telemetry-wordpress/tests/integration/compose.yml run --rm cli wp rewrite structure '/%postname%/' --hard
node --test packages/telemetry-wordpress/tests/integration/http.test.mjs
```

Wait for WordPress to finish copying its files before the install command. Skip `core install` when reusing an installed fixture. Tests provide the `telemetry.test` Host header, so no hosts-file change is required.

Stop without deleting test data:

```sh
docker compose -f packages/telemetry-wordpress/tests/integration/compose.yml down
```

## Validation status

The initial real WordPress run passed 8 of 10 scenarios. It reproduced two consent-withdrawal failures: an existing or threaded identity bypassed current consent, and a property beacon included an old session after consent withdrawal.

This branch fixes those paths and removes the browser bootstrap's warm-cookie shortcut. The bootstrap now checks current consent for returning visitors and withholds the browser tracker when the visitor is suppressed or the anchor fails or times out. After the fix, all 10 HTTP scenarios and all 46 PHP pure checks pass. Four generated-bootstrap tests also pass for warm-cookie consent checks, successful resolution, errors and late responses after a timeout. Run these from the repository root with `node --test packages/telemetry-wordpress/tests/bootstrap.test.mjs`. The JavaScript tests use a simulated DOM, not a full browser.

The booking scenario simulates a confirmed reservation and verifies the bridge payload against the local collector. It does not make a real booking. This fixture does not yet validate a real browser, a Next.js boundary, a production browser tracker, full-page cache infrastructure, live ingest, or a customer staging site. Those remain separate acceptance checks.
