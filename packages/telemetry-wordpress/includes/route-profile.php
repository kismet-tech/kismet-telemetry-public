<?php
// Route profile (contract section 13a): which URLs are properties, results pages,
// the checkout path, agent surfaces. From the settings, with developer filters:
//   kismet_telemetry_property($match, $path, $url)  → ['vrSlug'=>?, 'externalListingId'=>?] | null
//   kismet_telemetry_is_search($is, $path)
//   kismet_telemetry_intent($is, $path)
//   kismet_telemetry_is_agent_surface($is, $path)

defined('ABSPATH') || exit;

/**
 * Pure classification of a path + query against a profile array.
 * @param array{property_pattern?:string,property_id_kind?:string,search_paths?:string,intent_path?:string,checkin_param?:string,checkout_param?:string,guests_param?:string} $profile
 * @return array{kind:string,vrSlug:?string,externalListingId:?string,stayCheckIn:?string,stayCheckOut:?string,guestCount:?int}
 */
function kismet_telemetry_classify(string $path, string $query, array $profile, string $accept = ''): array {
    $base = ['kind' => 'page', 'vrSlug' => null, 'externalListingId' => null, 'stayCheckIn' => null, 'stayCheckOut' => null, 'guestCount' => null];
    $path = '/' . ltrim($path, '/');

    if (preg_match('/\.md$/i', $path) || $path === '/llms.txt' || $path === '/.well-known/llm-index.json' || kismet_telemetry_prefers_markdown($accept)) {
        return array_merge($base, ['kind' => 'agent']);
    }
    if (preg_match('/\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|woff2?|ttf|otf|eot|txt|xml|json|pdf|zip|mp4|webm|mp3)$/i', $path)) {
        return array_merge($base, ['kind' => 'excluded']);
    }

    parse_str($query, $q);
    $qs = static function (string $k) use ($q): ?string {
        return isset($q[$k]) && is_string($q[$k]) ? $q[$k] : null;
    };
    $stay = [
        'stayCheckIn'  => kismet_telemetry_parse_stay_date($qs($profile['checkin_param'] ?? 'checkin') ?? $qs('in') ?? $qs('checkIn')),
        'stayCheckOut' => kismet_telemetry_parse_stay_date($qs($profile['checkout_param'] ?? 'checkout') ?? $qs('out') ?? $qs('checkOut')),
        'guestCount'   => kismet_telemetry_parse_guests($qs($profile['guests_param'] ?? 'guests') ?? $qs('party')),
    ];

    $intent = trim((string) ($profile['intent_path'] ?? ''));
    if ($intent !== '' && kismet_telemetry_path_matches($path, $intent)) {
        return array_merge($base, $stay, ['kind' => 'intent']);
    }

    foreach (preg_split('/\r?\n/', (string) ($profile['search_paths'] ?? '')) ?: [] as $line) {
        $line = trim($line);
        if ($line !== '' && kismet_telemetry_path_matches($path, $line)) {
            return array_merge($base, $stay, ['kind' => 'search']);
        }
    }

    $pattern = trim((string) ($profile['property_pattern'] ?? ''));
    if ($pattern !== '') {
        $re = '~' . str_replace('~', '\~', $pattern) . '~';
        if (@preg_match($re, $path, $m)) {
            $id   = isset($m['id']) ? $m['id'] : ($m[1] ?? null);
            $kind = ($profile['property_id_kind'] ?? 'externalListingId') === 'vrSlug' ? 'vrSlug' : 'externalListingId';
            return array_merge($base, $stay, ['kind' => 'property', $kind => $id !== null && $id !== '' ? $id : null]);
        }
    }

    return array_merge($base, $stay);
}

/** Exact match, or a prefix when the entry ends with *. Trailing slashes are ignored. */
function kismet_telemetry_path_matches(string $path, string $entry): bool {
    $entry = '/' . ltrim($entry, '/');
    if (substr($entry, -1) === '*') {
        return strpos($path, substr($entry, 0, -1)) === 0;
    }
    return rtrim($path, '/') === rtrim($entry, '/');
}

/** True when text/markdown is listed and outranks text/html. */
function kismet_telemetry_prefers_markdown(string $accept): bool {
    if ($accept === '' || stripos($accept, 'text/markdown') === false) {
        return false;
    }
    $q = static function (string $type) use ($accept): float {
        foreach (explode(',', $accept) as $part) {
            $part = trim($part);
            if (stripos($part, $type) === 0) {
                return preg_match('/;\s*q=([0-9.]+)/', $part, $m) ? (float) $m[1] : 1.0;
            }
        }
        return $type === '*/*' ? 0.0 : -1.0;
    };
    $md   = $q('text/markdown');
    $html = max($q('text/html'), $q('*/*'));
    return $md > 0 && $md > $html;
}

/** The request-scoped classification: settings plus the developer filters. */
function kismet_telemetry_classify_request(): array {
    $uri   = (string) ($_SERVER['REQUEST_URI'] ?? '/');
    $parts = wp_parse_url($uri);
    $path  = (string) ($parts['path'] ?? '/');
    $query = (string) ($parts['query'] ?? '');
    $profile = [
        'property_pattern' => (string) kismet_telemetry_opt('property_pattern', ''),
        'property_id_kind' => (string) kismet_telemetry_opt('property_id_kind', 'externalListingId'),
        'search_paths'     => (string) kismet_telemetry_opt('search_paths', ''),
        'intent_path'      => (string) kismet_telemetry_opt('intent_path', ''),
        'checkin_param'    => (string) kismet_telemetry_opt('checkin_param', 'checkin'),
        'checkout_param'   => (string) kismet_telemetry_opt('checkout_param', 'checkout'),
        'guests_param'     => (string) kismet_telemetry_opt('guests_param', 'guests'),
    ];
    $cls = kismet_telemetry_classify($path, $query, $profile, (string) ($_SERVER['HTTP_ACCEPT'] ?? ''));

    // Developer overrides. Kismet Elements' property query var counts as a Kismet slug.
    $elements_slug = function_exists('get_query_var') ? (string) get_query_var('kismet_property_slug') : '';
    if ($cls['kind'] === 'page' && $elements_slug !== '') {
        $cls['kind']   = 'property';
        $cls['vrSlug'] = $elements_slug;
    }
    $prop = apply_filters('kismet_telemetry_property', null, $path, $uri);
    if (is_array($prop) && (!empty($prop['vrSlug']) || !empty($prop['externalListingId']))) {
        $cls['kind']              = $cls['kind'] === 'intent' ? 'intent' : 'property';
        $cls['vrSlug']            = isset($prop['vrSlug']) ? (string) $prop['vrSlug'] : null;
        $cls['externalListingId'] = isset($prop['externalListingId']) ? (string) $prop['externalListingId'] : null;
    }
    if ($cls['kind'] === 'page' && apply_filters('kismet_telemetry_is_search', false, $path)) {
        $cls['kind'] = 'search';
    }
    if (apply_filters('kismet_telemetry_intent', false, $path)) {
        $cls['kind'] = 'intent';
    }
    if (apply_filters('kismet_telemetry_is_agent_surface', false, $path)) {
        $cls['kind'] = 'agent';
    }
    return $cls;
}
