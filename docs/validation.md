# Telemetry 1.0.1 candidate validation

Status: local validation passed. Corrected npm artifacts remain unpublished; see the repository Releases page for WordPress downloads. This report is evidence for source review, not approval of a customer production installation.

## Results

| Check | Result |
| --- | --- |
| Core unit tests and conformance | 26 passed |
| Next.js tests and conformance | 6 passed |
| Node tests and conformance | 8 passed |
| WordPress pure checks | 46 passed |
| WordPress bootstrap regressions | 4 passed |
| Real WordPress HTTP scenarios | 10 passed |
| Chrome mixed WordPress / Next.js scenarios | 8 passed |

The mixed fixture covers anonymous visits, consented identity, WordPress-to-Next continuity, simulated booking confirmation and matching booking-bridge session, consent withdrawal followed by navigation on both surfaces, two visitors receiving identical cached HTML, and anchor failure. Browser tests found no page errors.

Validation exposed adoption of retained identifiers despite denied consent in core 1.0.0, and browser tracker adoption of retained cookies after suppression. Candidates evaluate consent first and withhold the browser tracker on suppressed visits. These findings and fixes are not claims about the already published 1.0.0 artifacts.

## Environment and reproduction

WordPress 7.1, PHP 8.2.33, MariaDB 11; Next.js 15.5.25 development server, React 19.1.0; Chrome 152.0.7977.83. WordPress `/` and Next.js `/app` share a local HTTP origin. The collector and simulated booking endpoint are local. External browser requests are intercepted, and the reviewed browser tracker receives a minimal mocked configuration. No production reservations or customer events were submitted.

See [HTTP fixture](../packages/telemetry-wordpress/tests/integration/README.md) and [mixed browser fixture](../packages/telemetry-wordpress/tests/mixed-site/README.md). The browser runner produces JSON checks, a primary-context trace and a checkout screenshot. Build and test the core from the same checkout before installing it into the adapters. Install all three exact candidate tarballs for reproduction.

## Remaining acceptance

Validate the actual staging consent manager, WordPress caching/CDN, HTTPS and proxy topology, Next deployment build, checkout mapping, and production ingest/report reconciliation. Immediate consent revocation within an already loaded page is not established by navigation-based tests. The cached-HTML fixture does not certify any particular cache plugin or CDN. Source review and local validation can precede staging access.

Before recommending installation, merge the fixes privately, publish the reviewed public source snapshot and matching artifacts, and verify anonymous source/download access. Publish the corrected core before its adapters. Do not present npm 1.0.0 as the validated correction.

## Candidate artifact SHA-256

These hashes identify the locally packed candidates used for review. Rebuilds must receive a new manifest.

- `kismet-tech-telemetry-1.0.1.tgz`: `1636b1a4a51cd7377d9601d9f223e360034bc05a45fac11ef07b1ef2faf5eb5d`
- `kismet-tech-telemetry-next-1.0.1.tgz`: `abc6883f53ff63c5edd3dce52427e9dc842dd6b4d41af5a88259c25f57ee4766`
- `kismet-tech-telemetry-node-1.0.1.tgz`: `3202c171f032b701182b166000fd2efb066dc48e5a1d8eb82bf28e36eefe7c81`
- `kismet-telemetry-1.0.1.zip`: `03f90637006cc60bf950a776f8ae83a50f18d0aaed062c7f156f683e96a4e3dc`
- `kjs-reviewed.js`: `79135dddd0607b328083f6421d08cab1d4f9997fb6dd4e54af7b3a8dda410485`
