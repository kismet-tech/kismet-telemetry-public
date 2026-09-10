<?php
// The server-plane event (contract section 8): one POST per PHP-served front-end
// GET, bots included, fire-and-forget. The only record of AI agents and crawlers.
//
// Known limit of PHP-tier capture: a request served entirely from a full-page
// cache never runs PHP and is invisible here. Coverage is "every request
// WordPress actually serves". Ingest classifies bots from the raw user agent; the
// local verdict is a hint and decides only whether a session rides along.

defined('ABSPATH') || exit;

/**
 * Build the event body. Pure given its inputs; matches the core builder's field
 * set (contract section 8).
 * @param array $in keys: page_url, serving_domain, collection, ua, ip, country, referrer, session (?string), cls (classification array), is_bot (bool)
 */
function kismet_telemetry_event_body(array $in): array {
    $cls   = $in['cls'];
    $kind  = $cls['kind'];
    $prop  = !empty($cls['vrSlug']) || !empty($cls['externalListingId']);
    $body  = [
        'trackingMode'    => 'server',
        'pageUrl'         => $in['page_url'],
        'clientSessionId' => $in['is_bot'] ? null : ($in['session'] ?? null),
        'resourceClass'   => $prop ? 'content_vr' : 'content_vrm',
        'actionType'      => $kind === 'agent' ? 'fetch' : ($kind === 'intent' ? 'cta_click' : ($prop ? 'property_view' : 'view')),
        'collectionSlug'  => $in['collection'],
        'vacationRentalSlug' => $cls['vrSlug'] ?? null,
    ];
    if (!empty($cls['externalListingId'])) {
        $body['externalListingId'] = $cls['externalListingId'];
    }
    foreach (['stayCheckIn', 'stayCheckOut', 'guestCount'] as $k) {
        if (!empty($cls[$k])) {
            $body[$k] = $cls[$k];
        }
    }
    $body['servingDomain'] = $in['serving_domain'];
    $body['isBot']         = (bool) $in['is_bot'];
    $body['botName']       = $in['bot_name'] ?? null;
    $body['botCategory']   = $in['bot_category'] ?? null;
    $body['verifiedBot']   = false;
    $body['userAgent']     = $in['ua'] !== '' ? $in['ua'] : null;
    $body['clientIp']      = $in['ip'];
    $body['country']       = $in['country'] !== '' ? $in['country'] : null;
    $body['referrer']      = $in['referrer'];
    return $body;
}

function kismet_telemetry_beacon_send(): void {
    if (is_admin() || wp_doing_ajax() || wp_doing_cron()) {
        return;
    }
    if (defined('REST_REQUEST') && REST_REQUEST) {
        return;
    }
    if (is_feed() || is_preview() || is_customize_preview() || is_robots() || is_trackback()) {
        return;
    }
    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
        return;
    }
    if (!kismet_telemetry_enabled() || !apply_filters('kismet_telemetry_beacon_enabled', true)) {
        return;
    }

    $cls = kismet_telemetry_classify_request();
    if ($cls['kind'] === 'excluded') {
        return;
    }
    $ua  = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    $bot = kismet_telemetry_detect_bot($ua);
    $is_bot = $bot['isBot'] || kismet_telemetry_is_bot($ua);

    $session = null;
    if (!$is_bot && $cls['kind'] !== 'agent') {
        $session = kismet_telemetry_valid_kid(isset($_COOKIE['_kid_sid']) ? (string) $_COOKIE['_kid_sid'] : null);
    }

    $body = kismet_telemetry_event_body([
        'page_url'       => kismet_telemetry_public_url(),
        'serving_domain' => kismet_telemetry_serving_host(),
        'collection'     => kismet_telemetry_collection(),
        'ua'             => substr($ua, 0, 512),
        'ip'             => kismet_telemetry_client_ip(),
        'country'        => kismet_telemetry_country(),
        'referrer'       => isset($_SERVER['HTTP_REFERER']) ? substr((string) $_SERVER['HTTP_REFERER'], 0, 2048) : null,
        'session'        => $session,
        'cls'            => $cls,
        'is_bot'         => $is_bot,
        'bot_name'       => $bot['botName'],
        'bot_category'   => $bot['botCategory'],
    ]);

    wp_remote_post(KISMET_TELEMETRY_TRACK_URL, [
        'timeout'  => 2,
        'blocking' => false,
        'headers'  => ['Content-Type' => 'application/json', 'X-Kismet-Tracking-Key' => kismet_telemetry_tracking_key()],
        'body'     => wp_json_encode($body),
    ]);
}
