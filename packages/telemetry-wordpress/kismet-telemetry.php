<?php
/**
 * Plugin Name: Kismet Telemetry
 * Plugin URI:  https://developers.kismet.travel/telemetry/
 * Description: Server-side tracking for your own WordPress site: a first-party visitor session on your domain, every page and AI crawler visit recorded server-side, and bookings joined to the visit. Implements the Kismet tracking contract v1.0. Tracking only, no page elements.
 * Version:     1.1.1
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author:      Kismet Technologies
 * Author URI:  https://kismet.travel
 * License:     Apache-2.0
 * License URI: https://www.apache.org/licenses/LICENSE-2.0
 * Text Domain: kismet-telemetry
 *
 * The contract this plugin implements is docs/CONTRACT.md in the kismet-telemetry
 * repository (contract 1.0). The WordPress adapter is the cache-safe variant of
 * section 7: the head bootstrap is a site constant, the per-visitor resolution is a
 * never-cached admin-ajax call, so a full-page cache can never freeze one visitor's
 * id for everyone.
 */

defined('ABSPATH') || exit;

define('KISMET_TELEMETRY_VERSION', '1.1.1');
define('KISMET_TELEMETRY_CONTRACT_VERSION', '1.0');
define('KISMET_TELEMETRY_FILE', __FILE__);
define('KISMET_TELEMETRY_DIR', __DIR__);

// Endpoint overrides for lab and staging: define in wp-config.php.
if (!defined('KISMET_TELEMETRY_RESOLVE_URL')) {
    define('KISMET_TELEMETRY_RESOLVE_URL', 'https://api.ksmt.app/v1/identity/resolve-anchor');
}
if (!defined('KISMET_TELEMETRY_TRACK_URL')) {
    define('KISMET_TELEMETRY_TRACK_URL', 'https://kismet.travel/api/track');
}
if (!defined('KISMET_TELEMETRY_API_ORIGIN')) {
    define('KISMET_TELEMETRY_API_ORIGIN', 'https://api.ksmt.app');
}
if (!defined('KISMET_TELEMETRY_KJS_URL')) {
    define('KISMET_TELEMETRY_KJS_URL', 'https://kismet.travel/k.js');
}

require_once __DIR__ . '/includes/credentials.php';
require_once __DIR__ . '/includes/rate-limit.php';
require_once __DIR__ . '/includes/bot-patterns.generated.php';
require_once __DIR__ . '/includes/bot-detect.php';
require_once __DIR__ . '/includes/settings.php';
require_once __DIR__ . '/includes/consent.php';
require_once __DIR__ . '/includes/request.php';
require_once __DIR__ . '/includes/route-profile.php';
require_once __DIR__ . '/includes/anchor.php';
require_once __DIR__ . '/includes/beacon.php';
require_once __DIR__ . '/includes/conversion.php';
require_once __DIR__ . '/includes/elements-compat.php';

// ── Hooks ──────────────────────────────────────────────────────────────────────

// The head bootstrap (site constant, cache-safe) and the per-visitor endpoint.
add_action('wp_head', 'kismet_telemetry_head_bootstrap', 0);
add_action('wp_ajax_nopriv_kismet_telemetry_anchor', 'kismet_telemetry_anchor_ajax');
add_action('wp_ajax_kismet_telemetry_anchor', 'kismet_telemetry_anchor_ajax');

// The server-plane event for every PHP-served front-end request, bots included.
add_action('template_redirect', 'kismet_telemetry_beacon_send', 20);

// Settings screen.
add_action('admin_menu', 'kismet_telemetry_admin_menu');
add_action('admin_init', 'kismet_telemetry_admin_save');

// When Kismet Elements is also active, this plugin owns tracking and Elements defers.
add_action('plugins_loaded', 'kismet_telemetry_elements_compat', 20);
