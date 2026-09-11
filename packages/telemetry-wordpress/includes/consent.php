<?php
// Consent (contract section 4). Consent gates the session only, never the
// server-plane recording. Default: a country deny list read from a platform
// country header; unknown is denied. Most hosts send no such header, so the
// site wires its consent manager through the settings (consent_mode=cookie) or
// the `kismet_telemetry_should_set_cookies` filter.

defined('ABSPATH') || exit;

const KISMET_TELEMETRY_CONSENT_DENY = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
    'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    'IS', 'LI', 'NO', 'GB', 'CH',
];

/** ISO alpha-2 from the platform headers adapters see, or '' (a bare Apache/Azure hop). */
function kismet_telemetry_country(): string {
    foreach (['HTTP_CF_IPCOUNTRY', 'HTTP_X_VERCEL_IP_COUNTRY'] as $h) {
        $v = strtoupper(trim((string) ($_SERVER[$h] ?? '')));
        if ($v !== '' && $v !== 'XX' && $v !== 'T1') {
            return $v;
        }
    }
    return '';
}

/** The country default: unknown denied, listed denied. */
function kismet_telemetry_country_allows(string $country): bool {
    $country = strtoupper(trim($country));
    if (!preg_match('/^[A-Z]{2}$/', $country) || in_array($country, ['XX', 'ZZ'], true)) {
        return false;
    }
    return !in_array($country, KISMET_TELEMETRY_CONSENT_DENY, true);
}

/**
 * Whether this visitor may carry a session. Pure given the inputs; the WordPress
 * entry points read the request and the settings, then pass through the filter.
 * @param string $mode 'geo' | 'always' | 'cookie'
 * @param array<string,string> $cookies the request cookies
 */
function kismet_telemetry_consent_decision(string $mode, string $country, array $cookies, string $cookie_name, string $pattern): bool {
    if ($mode === 'always') {
        return true;
    }
    if ($mode === 'cookie') {
        if ($cookie_name === '' || !isset($cookies[$cookie_name])) {
            return false;
        }
        if ($pattern === '') {
            return true;
        }
        $value = (string) $cookies[$cookie_name];
        $decoded = rawurldecode($value);
        $re = '~' . str_replace('~', '\~', $pattern) . '~';
        return (bool) (@preg_match($re, $decoded) || @preg_match($re, $value));
    }
    return kismet_telemetry_country_allows($country);
}

/** The request-scoped decision, filterable: `kismet_telemetry_should_set_cookies($allow, $country)`. */
function kismet_telemetry_should_set_cookies(): bool {
    $country = kismet_telemetry_country();
    $allow   = kismet_telemetry_consent_decision(
        (string) kismet_telemetry_opt('consent_mode', 'geo'),
        $country,
        is_array($_COOKIE) ? $_COOKIE : [],
        (string) kismet_telemetry_opt('consent_cookie', ''),
        (string) kismet_telemetry_opt('consent_pattern', '')
    );
    return (bool) apply_filters('kismet_telemetry_should_set_cookies', $allow, $country);
}
