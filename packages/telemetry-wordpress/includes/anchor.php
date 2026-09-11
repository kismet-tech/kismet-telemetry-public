<?php
// The identity anchor (contract sections 5, 6, 7): resolution order, the local
// mint with an after-response reconcile, the first-party cookies, the never-cached
// per-visitor endpoint, and the cache-safe head bootstrap.
//
// Cache-safe delivery: the <head> bootstrap is identical for every visitor (safe
// to full-page cache); the per-visitor resolution happens in admin-ajax, which
// no page cache serves. The bootstrap passes the page URL so the server can read a
// threaded ?kid_sid= and the click ids off the landing URL (first-touch capture).

defined('ABSPATH') || exit;

/**
 * Resolve the visitor for the anchor endpoint. Pure given its inputs.
 * @param array{threaded:?string,cookie_sid:?string,cookie_vid:?string,is_bot:bool,consented:bool} $in
 * @return array{kid_sid:?string,kid_vid:?string,tier:string,set_sid:bool,suppressed:bool,reconcile:?string}
 *   reconcile: 'threaded' | 'proposed' | null, what to send the authority
 */
function kismet_telemetry_resolve(array $in): array {
    $threaded = kismet_telemetry_valid_kid($in['threaded'] ?? null);
    $cookie   = kismet_telemetry_valid_kid($in['cookie_sid'] ?? null);
    $vid      = kismet_telemetry_valid_vid($in['cookie_vid'] ?? null);
    $is_bot   = !empty($in['is_bot']);

    // A carrier is identity, not evidence of current consent.
    if ($is_bot || empty($in['consented'])) {
        return ['kid_sid' => null, 'kid_vid' => null, 'tier' => 'suppressed', 'set_sid' => false, 'suppressed' => true, 'reconcile' => null];
    }
    if ($threaded !== null) {
        return ['kid_sid' => $threaded, 'kid_vid' => $vid, 'tier' => 'threaded', 'set_sid' => $threaded !== $cookie, 'suppressed' => false, 'reconcile' => 'threaded'];
    }
    if ($cookie !== null) {
        return ['kid_sid' => $cookie, 'kid_vid' => $vid, 'tier' => 'cookie', 'set_sid' => false, 'suppressed' => false, 'reconcile' => null];
    }
    return ['kid_sid' => kismet_telemetry_mint(), 'kid_vid' => $vid, 'tier' => 'minted', 'set_sid' => true, 'suppressed' => false, 'reconcile' => 'proposed'];
}

/**
 * The resolve-anchor body (contract section 6): exactly the declared names, the
 * visitor's signals, click ids and landing URL. Pure.
 * @param array{collection:string,origin:string,landing_url:string,ip:?string,ua:?string,accept_language:?string,referrer:?string,proposed:?string,threaded:?string,cookie_sid:?string,cookie_vid:?string} $in
 */
function kismet_telemetry_resolve_body(array $in): array {
    $query = (string) (wp_parse_url($in['landing_url'])['query'] ?? '');
    $clicks = kismet_telemetry_click_ids($query);
    $body = [
        'collectionSlug' => $in['collection'],
        'vrSlug'         => null,
        'origin'         => $in['origin'],
        'proposedKidSid' => $in['proposed'] ?? null,
        'threadedKidSid' => $in['threaded'] ?? null,
        'cookieKidSid'   => $in['cookie_sid'] ?? null,
        'cookieKidVid'   => $in['cookie_vid'] ?? null,
        'visitorConsent' => ($in['visitor_consent'] ?? false) === true,
        'ip'             => $in['ip'] ?? null,
        'userAgent'      => $in['ua'] ?? null,
        'acceptLanguage' => $in['accept_language'] ?? null,
        'referrer'       => $in['referrer'] ?? null,
        'gclid'          => $clicks['gclid'],
        'gbraid'         => $clicks['gbraid'],
        'wbraid'         => $clicks['wbraid'],
        'gadCampaignId'  => $clicks['gadCampaignId'],
        'fbclid'         => $clicks['fbclid'],
        'landingUrl'     => $in['landing_url'],
    ];
    // Drop only the id fields that are absent; nulls elsewhere are accepted by the authority.
    foreach (['proposedKidSid', 'threadedKidSid', 'cookieKidSid', 'cookieKidVid'] as $k) {
        if ($body[$k] === null) {
            unset($body[$k]);
        }
    }
    return $body;
}

/** POST the reconcile after the response, never blocking. */
function kismet_telemetry_reconcile(array $body): void {
    $key = kismet_telemetry_tracking_key();
    if ($key === '') {
        return;
    }
    wp_remote_post(KISMET_TELEMETRY_RESOLVE_URL, [
        'timeout'  => 3,
        'blocking' => false,
        'headers'  => ['Content-Type' => 'application/json', 'X-Kismet-Tracking-Key' => $key],
        'body'     => wp_json_encode($body),
    ]);
}

/** One Set-Cookie per the contract: dotted domain, Path=/, SameSite=Lax, Secure on HTTPS, never HttpOnly. */
function kismet_telemetry_set_cookie(string $name, string $value, int $max_age): void {
    $domain = kismet_telemetry_cookie_domain();
    $opts = [
        'expires'  => time() + $max_age,
        'path'     => '/',
        'secure'   => kismet_telemetry_is_https(),
        'httponly' => false,
        'samesite' => 'Lax',
    ];
    if ($domain !== '') {
        $opts['domain'] = $domain;
    }
    setcookie($name, $value, $opts);
}

/**
 * The page URL the bootstrap passed, accepted only when it is on this site.
 */
function kismet_telemetry_page_url_from_request(): string {
    $u = isset($_GET['u']) ? (string) wp_unslash($_GET['u']) : '';
    if ($u !== '') {
        $p = wp_parse_url($u);
        $site = kismet_telemetry_normalize_serving_domain((string) wp_parse_url(home_url(), PHP_URL_HOST));
        $host = kismet_telemetry_normalize_serving_domain((string) ($p['host'] ?? ''));
        if ($host !== '' && ($host === $site || substr($host, -strlen('.' . $site)) === '.' . $site) && in_array($p['scheme'] ?? '', ['http', 'https'], true)) {
            return $u;
        }
    }
    return (string) (wp_get_referer() ?: home_url('/'));
}

// ── The never-cached endpoint ────────────────────────────────────────────────

function kismet_telemetry_anchor_ajax(): void {
    nocache_headers();
    if (!kismet_telemetry_enabled()) {
        wp_send_json(['disabled' => 1], 200);
    }
    kismet_telemetry_rate_limit('kismet_telemetry_anchor', 60);

    $ua        = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    $page_url  = kismet_telemetry_page_url_from_request();
    $page_q    = (string) (wp_parse_url($page_url)['query'] ?? '');
    parse_str($page_q, $pq);
    $threaded  = isset($pq['kid_sid']) && is_string($pq['kid_sid']) ? $pq['kid_sid'] : null;
    $is_bot    = kismet_telemetry_is_bot($ua);
    $consented = $is_bot ? false : kismet_telemetry_should_set_cookies();

    $r = kismet_telemetry_resolve([
        'threaded'   => $threaded,
        'cookie_sid' => isset($_COOKIE['_kid_sid']) ? (string) $_COOKIE['_kid_sid'] : null,
        'cookie_vid' => isset($_COOKIE['_kid_vid']) ? (string) $_COOKIE['_kid_vid'] : null,
        'is_bot'     => $is_bot,
        'consented'  => $consented,
    ]);

    if ($r['suppressed']) {
        kismet_telemetry_set_cookie('_kid_vid', '', 0);
        kismet_telemetry_set_cookie('_kid_sid', '', 0);
        wp_send_json(['suppressed' => 1], 200);
    }
    if ($r['set_sid'] && $r['kid_sid'] !== null) {
        kismet_telemetry_set_cookie('_kid_sid', $r['kid_sid'], KISMET_TELEMETRY_SID_MAX_AGE);
    }
    // This AJAX request runs after page rendering. Await only its bounded authority call.
    $recognition = defined('KISMET_TELEMETRY_VISITOR_RECOGNITION') && KISMET_TELEMETRY_VISITOR_RECOGNITION === true;
    $explicit_consent = kismet_telemetry_opt('consent_mode', 'geo') === 'cookie' || has_filter('kismet_telemetry_should_set_cookies');
    if ($recognition && $explicit_consent && $consented) {
        $response = wp_remote_post(KISMET_TELEMETRY_RESOLVE_URL, [
            'timeout' => 1, 'blocking' => true,
            'headers' => ['Content-Type' => 'application/json', 'X-Kismet-Tracking-Key' => kismet_telemetry_tracking_key()],
            'body' => wp_json_encode(kismet_telemetry_resolve_body([
                'collection' => kismet_telemetry_collection(),
                'origin' => (kismet_telemetry_is_https() ? 'https://' : 'http://') . kismet_telemetry_request_host(),
                'landing_url' => $page_url, 'proposed' => $r['kid_sid'],
                'cookie_vid' => $r['kid_vid'], 'visitor_consent' => true, 'ua' => $ua,
            ])),
        ]);
        if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
            $resolved = json_decode(wp_remote_retrieve_body($response), true);
            if (is_array($resolved) && ($resolved['kid_sid'] ?? null) === $r['kid_sid']) {
                $vid = kismet_telemetry_valid_vid($resolved['kid_vid'] ?? null);
                if ($vid !== null) {
                    $r['kid_vid'] = $vid;
                    kismet_telemetry_set_cookie('_kid_vid', $vid, KISMET_TELEMETRY_VID_MAX_AGE);
                }
            }
        }
    }
    if ($r['reconcile'] !== null) {
        kismet_telemetry_reconcile(kismet_telemetry_resolve_body([
            'collection'      => kismet_telemetry_collection(),
            'origin'          => (kismet_telemetry_is_https() ? 'https://' : 'http://') . kismet_telemetry_request_host(),
            'landing_url'     => $page_url,
            'ip'              => kismet_telemetry_client_ip(),
            'ua'              => $ua !== '' ? $ua : null,
            'accept_language' => isset($_SERVER['HTTP_ACCEPT_LANGUAGE']) ? (string) $_SERVER['HTTP_ACCEPT_LANGUAGE'] : null,
            'referrer'        => isset($_SERVER['HTTP_REFERER']) ? (string) $_SERVER['HTTP_REFERER'] : null,
            'proposed'        => $r['reconcile'] === 'proposed' ? $r['kid_sid'] : null,
            'threaded'        => $r['reconcile'] === 'threaded' ? $r['kid_sid'] : null,
            'cookie_sid'      => $r['reconcile'] === 'threaded' ? kismet_telemetry_valid_kid(isset($_COOKIE['_kid_sid']) ? (string) $_COOKIE['_kid_sid'] : null) : null,
            'cookie_vid'      => $r['kid_vid'],
        ]));
    }
    wp_send_json(['kid_sid' => $r['kid_sid'], 'kid_vid' => $r['kid_vid'], 'tier' => $r['tier']], 200);
}

// ── The cache-safe head bootstrap ────────────────────────────────────────────

/** The inline bootstrap JS, pure given the config. Exported for tests. */
function kismet_telemetry_bootstrap_js(string $ajax_url, string $kjs_url, string $collection): string {
    $cfg = wp_json_encode(['ajax' => $ajax_url, 'kjs' => $kjs_url, 'c' => $collection], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT);
    return "/* Kismet Telemetry */(function(){\n"
        . "var K=" . $cfg . ";var RE=/^kid_[A-Za-z0-9]{6,40}$/;\n"
        . "window.Kismet=window.Kismet||{};\n"
        . "function load(){if(window.__kismetTelemetryTag)return;window.__kismetTelemetryTag=1;"
        . "var s=document.createElement('script');s.async=true;s.src=K.kjs+'?c='+encodeURIComponent(K.c);"
        . "(document.head||document.documentElement).appendChild(s);}\n"
        // Always consult current consent, including on cached pages with an old cookie.
        . "var done=false;function go(d){if(done)return;done=true;"
        . "if(d&&!d.suppressed&&d.kid_sid&&RE.test(d.kid_sid)){window.Kismet._sidSuppressed=0;window.Kismet._kidSid=d.kid_sid;}"
        . "else{window.Kismet._sidSuppressed=1;delete window.Kismet._kidSid;return;}load();}\n"
        . "var t=setTimeout(function(){go(null);},1500);\n"
        . "try{fetch(K.ajax+'?action=kismet_telemetry_anchor&u='+encodeURIComponent(location.href),{credentials:'include',cache:'no-store'})"
        . ".then(function(r){return r.json();}).then(function(d){clearTimeout(t);go(d);})"
        . ".catch(function(){clearTimeout(t);go(null);});}catch(e){clearTimeout(t);go(null);}\n"
        . "})();";
}

function kismet_telemetry_head_bootstrap(): void {
    if (is_admin() || is_feed() || (defined('REST_REQUEST') && REST_REQUEST) || wp_doing_ajax()) {
        return;
    }
    if (!kismet_telemetry_enabled()) {
        return;
    }
    echo '<script>' . kismet_telemetry_bootstrap_js(admin_url('admin-ajax.php'), KISMET_TELEMETRY_KJS_URL, kismet_telemetry_collection()) . "</script>\n";
}
