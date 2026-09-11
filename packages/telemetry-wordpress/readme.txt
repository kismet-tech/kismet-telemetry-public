=== Kismet Telemetry ===
Contributors: kismettech
Tags: analytics, attribution, ai, tracking, first-party
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 1.1.0
License: Apache-2.0
License URI: https://www.apache.org/licenses/LICENSE-2.0

Server-side tracking on your own WordPress site: a first-party visitor session, every page and AI crawler visit recorded server-side, and bookings joined to the visit.

== Description ==

Kismet Telemetry implements the Kismet tracking contract (version 1.0) as a WordPress plugin. It is tracking only, no page elements.

On every page WordPress serves it records a server-side event, classified at ingest, including the AI assistants and crawlers that never run JavaScript. Consenting visitors get a first-party session cookie on your own domain, set from the server, so page views, interactions and a later booking join into one journey. A first-time visitor never waits: the id is minted locally and reconciled with Kismet after the page is served.

Cache-safe by design: the head bootstrap is identical for every visitor, and the per-visitor resolution happens in a never-cached call, so a full-page cache cannot freeze one visitor's id for everyone.

Works alongside the Kismet Elements plugin: when both are active, this plugin owns tracking and Elements defers to it.

Real WordPress HTTP conformance and staging validation are pending. Use for review and staging until those checks pass.

== Installation ==

1. Upload the plugin and activate it.
2. Settings, Kismet Telemetry: enter your collection slug and tracking key, choose how consent is read, and describe your property, results and checkout URLs.
3. Verify: load a page in a fresh browser and look for the `_kid_sid` cookie on your domain.

Docs: https://developers.kismet.travel/telemetry/

== Changelog ==

= 1.1.0 =
Opt-in returning-visitor recognition with explicit consent and cache-safe cookie recovery.

= 1.0.1 =
* Add license and notices; clarify validation status. Runtime behavior unchanged.

= 1.0.0 =
* First release. Conforms to contract 1.0.
