<?php
// Request helpers shared by the anchor and the beacon: the visitor's address, the
// public URL behind a proxy, the serving host and the cookie domain rule, the
// identifier grammars and the local mint.

defined('ABSPATH') || exit;

const KISMET_TELEMETRY_KID_READ_RE = '/^kid_[A-Za-z0-9]{6,40}$/';
const KISMET_TELEMETRY_KID_MINT_RE = '/^kid_[A-Za-z0-9]{8}$/';
const KISMET_TELEMETRY_VID_RE      = '/^[A-Za-z0-9_]{6,64}$/';
const KISMET_TELEMETRY_CLICK_ID_RE = '/^[A-Za-z0-9._-]{1,512}$/';
const KISMET_TELEMETRY_SID_MAX_AGE = 7776000;   // 90 days
const KISMET_TELEMETRY_VID_MAX_AGE = 34560000;  // about 400 days

/** First hop of the visitor's address: cf-connecting-ip, x-forwarded-for, x-real-ip, socket. */
function kismet_telemetry_client_ip(): ?string {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $h) {
        if (!empty($_SERVER[$h])) {
            $ip = trim(explode(',', (string) $_SERVER[$h])[0]);
            if ($ip !== '') {
                return $ip;
            }
        }
    }
    return null;
}

/** The request host as the visitor saw it: forwarded host, else Host. Lowercase, no port. */
function kismet_telemetry_request_host(): string {
    $host = (string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? '');
    $host = strtolower(trim(explode(',', $host)[0]));
    if ($host === '') {
        $host = strtolower((string) wp_parse_url(home_url(), PHP_URL_HOST));
    }
    return $host;
}

/** Whether the visitor's request was HTTPS, honouring a proxy's forwarded proto. */
function kismet_telemetry_is_https(): bool {
    $fwd = (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '');
    if ($fwd !== '') {
        return trim(explode(',', $fwd)[0]) === 'https';
    }
    return function_exists('is_ssl') ? is_ssl() : false;
}

/** The public URL of this request. */
function kismet_telemetry_public_url(): string {
    $scheme = kismet_telemetry_is_https() ? 'https' : 'http';
    $host   = kismet_telemetry_request_host();
    $host   = preg_replace('/:\d+$/', '', $host);
    return $scheme . '://' . $host . (string) ($_SERVER['REQUEST_URI'] ?? '/');
}

/** Serving host: the site host minus a leading www. and any port (the event's servingDomain). */
function kismet_telemetry_serving_host(): string {
    $host = strtolower((string) wp_parse_url(home_url(), PHP_URL_HOST));
    return kismet_telemetry_normalize_serving_domain($host);
}

function kismet_telemetry_normalize_serving_domain(string $host): string {
    $host = strtolower(trim($host));
    $host = (string) preg_replace('/^www\./', '', $host);
    return (string) preg_replace('/:\d+$/', '', $host);
}

/**
 * The cookie Domain attribute (contract section 4): '.example.com' from the
 * serving host; '' (host-only) for single-label hosts and IP addresses; an
 * override wins.
 */
function kismet_telemetry_cookie_domain_for(string $host, string $override = ''): string {
    if ($override !== '') {
        return '.' . ltrim($override, '.');
    }
    $h = kismet_telemetry_normalize_serving_domain($host);
    if ($h === '' || strpos($h, '.') === false || filter_var($h, FILTER_VALIDATE_IP)) {
        return '';
    }
    return '.' . $h;
}

function kismet_telemetry_cookie_domain(): string {
    $domain = kismet_telemetry_cookie_domain_for(
        (string) wp_parse_url(home_url(), PHP_URL_HOST),
        (string) kismet_telemetry_opt('cookie_domain', '')
    );
    return (string) apply_filters('kismet_telemetry_cookie_domain', $domain);
}

function kismet_telemetry_valid_kid(?string $v): ?string {
    return is_string($v) && preg_match(KISMET_TELEMETRY_KID_READ_RE, $v) ? $v : null;
}

function kismet_telemetry_valid_vid(?string $v): ?string {
    return is_string($v) && preg_match(KISMET_TELEMETRY_VID_RE, $v) ? $v : null;
}

/** kid_ plus exactly eight characters from A-Z a-z 0-9, from a cryptographic source. */
function kismet_telemetry_mint(): string {
    static $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    $out = 'kid_';
    try {
        $bytes = random_bytes(8);
        for ($i = 0; $i < 8; $i++) {
            $out .= $alphabet[ord($bytes[$i]) % 62];
        }
    } catch (\Throwable $e) {
        for ($i = 0; $i < 8; $i++) {
            $out .= $alphabet[random_int(0, 61)];
        }
    }
    return $out;
}

/**
 * Click ids off a landing URL's query, guarded by charset and length.
 * @return array{gclid:?string,gbraid:?string,wbraid:?string,gadCampaignId:?string,fbclid:?string}
 */
function kismet_telemetry_click_ids(string $query): array {
    parse_str($query, $q);
    $get = static function (string $k) use ($q): ?string {
        $v = isset($q[$k]) && is_string($q[$k]) ? $q[$k] : null;
        return $v !== null && preg_match(KISMET_TELEMETRY_CLICK_ID_RE, $v) ? $v : null;
    };
    return [
        'gclid'         => $get('gclid'),
        'gbraid'        => $get('gbraid'),
        'wbraid'        => $get('wbraid'),
        'gadCampaignId' => $get('gad_campaignid'),
        'fbclid'        => $get('fbclid'),
    ];
}

/** YYYY-MM-DD as is; MM/DD/YYYY normalized; else null. */
function kismet_telemetry_parse_stay_date(?string $s): ?string {
    if ($s === null || $s === '') {
        return null;
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
        return $s;
    }
    if (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{4})$#', $s, $m)) {
        return $m[3] . '-' . str_pad($m[1], 2, '0', STR_PAD_LEFT) . '-' . str_pad($m[2], 2, '0', STR_PAD_LEFT);
    }
    return null;
}

function kismet_telemetry_parse_guests(?string $s): ?int {
    if ($s === null || $s === '' || !is_numeric($s)) {
        return null;
    }
    $n = (int) $s;
    return ($n > 0 && $n < 100) ? $n : null;
}
