<?php
// A small per-IP token bucket on transients for the never-cached anchor endpoint.

defined('ABSPATH') || exit;

/**
 * True when under the limit; sends a 429 JSON error and exits when over.
 * @param string $action bucket name
 * @param int    $limit  requests per 60 s per address (default 60)
 */
function kismet_telemetry_rate_limit(string $action, int $limit = 60): bool {
    $ip     = kismet_telemetry_client_ip() ?: '0.0.0.0';
    $key    = 'kismet_tel_rl_' . md5($action . '_' . $ip);
    $window = 60;
    $now    = time();
    $bucket = get_transient($key);
    if (!is_array($bucket) || $now > (int) ($bucket['reset'] ?? 0)) {
        set_transient($key, ['count' => 1, 'reset' => $now + $window], $window + 1);
        return true;
    }
    $bucket['count'] = (int) $bucket['count'] + 1;
    set_transient($key, $bucket, $window + 1);
    if ($bucket['count'] > $limit) {
        wp_send_json_error(['message' => 'Rate limit exceeded'], 429);
    }
    return true;
}
