<?php
// Coexistence with the Kismet Elements plugin, which carries an older copy of
// this anchor and beacon. When both are active, this plugin owns tracking:
//   - Elements' head bootstrap is unhooked (ours renders instead);
//   - Elements' server beacon is switched off through its own filter;
//   - Elements' collection slug and tracking key are used when ours are empty.
// Elements' anchor admin-ajax endpoint is left registered: its booking-nonce
// refresh calls it on aged cached pages, and that endpoint adopts an existing
// cookie before anything else, so it can never fork the session this plugin set.

defined('ABSPATH') || exit;

function kismet_telemetry_elements_active(): bool {
    return function_exists('kismet_elements_anchor_bootstrap') || function_exists('kismet_elements_tracking_key');
}

function kismet_telemetry_elements_compat(): void {
    if (!kismet_telemetry_elements_active()) {
        return;
    }
    if (function_exists('kismet_elements_anchor_bootstrap')) {
        remove_action('wp_head', 'kismet_elements_anchor_bootstrap', 0);
    }
    add_filter('kismet_elements_server_beacon_enabled', '__return_false');

    add_filter('kismet_telemetry_collection_fallback', static function (string $v): string {
        if ($v !== '') {
            return $v;
        }
        return function_exists('kismet_elements_anchor_collection') ? (string) kismet_elements_anchor_collection() : (string) get_option('kismet_elements_collection_slug', '');
    });
    add_filter('kismet_telemetry_tracking_key_fallback', static function (string $v): string {
        if ($v !== '') {
            return $v;
        }
        return function_exists('kismet_elements_tracking_key') ? (string) kismet_elements_tracking_key() : '';
    });
}
