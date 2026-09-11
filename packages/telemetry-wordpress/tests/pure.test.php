<?php
// Pure-function tests for the WordPress adapter, runnable without WordPress:
//   php tests/pure.test.php
// Stubs the handful of WordPress functions the pure paths touch, then asserts
// the contract rules the conformance suite checks over HTTP. The HTTP run of the
// suite against a real WordPress (docker rig or a staging site) is the other half.

declare(strict_types=1);

define('ABSPATH', '/stub/');
$GLOBALS['__opts'] = [];
function get_option($k, $d = '') { return $GLOBALS['__opts'][$k] ?? $d; }
function update_option($k, $v, $a = null) { $GLOBALS['__opts'][$k] = $v; return true; }
function delete_option($k) { unset($GLOBALS['__opts'][$k]); return true; }
function apply_filters($h, $v, ...$a) { return $v; }
function add_filter(...$a) { return true; }
function add_action(...$a) { return true; }
function remove_action(...$a) { return true; }
function home_url($p = '') { return 'https://www.example.co.uk' . $p; }
function get_site_url() { return 'https://www.example.co.uk'; }
function wp_parse_url($u, $c = -1) { return $c === -1 ? parse_url($u) : parse_url($u, $c); }
function wp_json_encode($v, $f = 0) { return json_encode($v, $f); }
function is_ssl() { return false; }
function get_query_var($k) { return ''; }
function wp_unslash($v) { return $v; }
function sanitize_text_field($v) { return trim((string) $v); }

require __DIR__ . '/../includes/request.php';
require __DIR__ . '/../includes/consent.php';
require __DIR__ . '/../includes/bot-patterns.generated.php';
require __DIR__ . '/../includes/bot-detect.php';
require __DIR__ . '/../includes/route-profile.php';
require __DIR__ . '/../includes/settings.php';
require __DIR__ . '/../includes/anchor.php';
require __DIR__ . '/../includes/beacon.php';
require __DIR__ . '/../includes/conversion.php';

$fails = 0; $count = 0;
function ok(bool $c, string $name): void { global $fails, $count; $count++; if (!$c) { $fails++; echo "FAIL  $name\n"; } else { echo "ok    $name\n"; } }

// Identifiers and the mint
$ids = [];
for ($i = 0; $i < 500; $i++) { $ids[kismet_telemetry_mint()] = true; }
ok(count($ids) === 500 && count(array_filter(array_keys($ids), fn($k) => !preg_match(KISMET_TELEMETRY_KID_MINT_RE, $k))) === 0, 'mint: 500 distinct ids in ^kid_[A-Za-z0-9]{8}$');
ok(kismet_telemetry_valid_kid('kid_Ab3dE9xZ') === 'kid_Ab3dE9xZ' && kismet_telemetry_valid_kid('nope') === null && kismet_telemetry_valid_kid('kid_"><script>') === null, 'read grammar');

// Cookie domain rule
ok(kismet_telemetry_cookie_domain_for('www.example.co.uk') === '.example.co.uk', 'domain: dotted, www stripped');
ok(kismet_telemetry_cookie_domain_for('example.com:8443') === '.example.com', 'domain: port stripped');
ok(kismet_telemetry_cookie_domain_for('localhost') === '' && kismet_telemetry_cookie_domain_for('127.0.0.1') === '', 'domain: host-only for single label and IP');
ok(kismet_telemetry_cookie_domain_for('book.example.com', 'example.com') === '.example.com', 'domain: override wins');

// Consent
$cookies = ['CookieConsent' => 'statistics%3Atrue'];
ok(kismet_telemetry_consent_decision('geo', '', [], '', '') === true, 'consent geo: unknown country allowed');
ok(kismet_telemetry_consent_decision('geo', 'GB', [], '', '') === false, 'consent geo: GB denied');
ok(kismet_telemetry_consent_decision('geo', 'US', [], '', '') === true, 'consent geo: US allowed');
ok(kismet_telemetry_consent_decision('always', 'GB', [], '', '') === true, 'consent always');
ok(kismet_telemetry_consent_decision('cookie', 'GB', $cookies, 'CookieConsent', 'statistics:true') === true, 'consent cookie: pattern on the decoded value');
ok(kismet_telemetry_consent_decision('cookie', 'GB', $cookies, 'CookieConsent', 'statistics:false') === false, 'consent cookie: pattern miss');
ok(kismet_telemetry_consent_decision('cookie', 'GB', [], 'CookieConsent', '') === false, 'consent cookie: absent cookie is no');
ok(kismet_telemetry_consent_decision('cookie', 'GB', $cookies, '', '') === false, 'consent cookie: unnamed cookie is no (fail-closed)');

// Bots
ok(kismet_telemetry_detect_bot('Mozilla/5.0 AppleWebKit/537.36; compatible; GPTBot/1.2')['botName'] === 'GPTBot', 'vocabulary: GPTBot');
ok(kismet_telemetry_detect_bot('ClaudeBot/1.0')['botCategory'] !== null, 'vocabulary: ClaudeBot has a category');
ok(kismet_telemetry_is_bot('curl/8.4') && kismet_telemetry_is_bot('') && !kismet_telemetry_is_bot('Mozilla/5.0 (Macintosh) Chrome/128 Safari/537.36'), 'is_bot: generic clients and missing UA, not humans');

// Resolution order
$r = kismet_telemetry_resolve(['threaded' => 'kid_Thread01', 'cookie_sid' => 'kid_Cook0001', 'cookie_vid' => null, 'is_bot' => false, 'consented' => true]);
ok($r['tier'] === 'threaded' && $r['kid_sid'] === 'kid_Thread01' && $r['set_sid'] === true && $r['reconcile'] === 'threaded', 'resolve: threaded adopted, cookie differs, back-stitch');
$r = kismet_telemetry_resolve(['threaded' => null, 'cookie_sid' => 'kid_Cook0001', 'cookie_vid' => 'vid_abcdef', 'is_bot' => false, 'consented' => true]);
ok($r['tier'] === 'cookie' && $r['set_sid'] === false && $r['reconcile'] === null && $r['kid_vid'] === 'vid_abcdef', 'resolve: cookie, no network');
$r = kismet_telemetry_resolve(['threaded' => 'kid_Thread01', 'cookie_sid' => null, 'cookie_vid' => null, 'is_bot' => true, 'consented' => false]);
ok($r['suppressed'] && $r['kid_sid'] === null, 'resolve: bot echoing a threaded id is suppressed');
$r = kismet_telemetry_resolve(['threaded' => null, 'cookie_sid' => null, 'cookie_vid' => null, 'is_bot' => false, 'consented' => false]);
ok($r['suppressed'] && $r['reconcile'] === null, 'resolve: no consent is suppressed');
$r = kismet_telemetry_resolve(['threaded' => 'kid_Thread01', 'cookie_sid' => 'kid_Cook0001', 'cookie_vid' => 'vid_abcdef', 'is_bot' => false, 'consented' => false]);
ok($r['suppressed'] && $r['kid_sid'] === null && $r['kid_vid'] === null && !$r['set_sid'] && $r['reconcile'] === null, 'resolve: consent withdrawal overrides existing carriers');
$r = kismet_telemetry_resolve(['threaded' => null, 'cookie_sid' => 'nope', 'cookie_vid' => null, 'is_bot' => false, 'consented' => true]);
ok($r['tier'] === 'minted' && preg_match(KISMET_TELEMETRY_KID_MINT_RE, $r['kid_sid']) && $r['reconcile'] === 'proposed', 'resolve: bad cookie grammar falls through to a mint');

// Resolve body: declared names, click ids, landing URL, no ipHash
$b = kismet_telemetry_resolve_body(['collection' => 'sea-view-stays', 'origin' => 'https://www.example.co.uk', 'landing_url' => 'https://www.example.co.uk/about?gclid=Cj0abc&fbclid=IwAR0x&utm_source=chatgpt', 'ip' => '203.0.113.7', 'ua' => 'UA', 'accept_language' => 'en-GB', 'referrer' => 'https://chatgpt.com/', 'proposed' => 'kid_Ab3dE9xZ', 'threaded' => null, 'cookie_sid' => null, 'cookie_vid' => null]);
$allowed = ['visitorConsent','collectionSlug','vrSlug','origin','proposedKidSid','threadedKidSid','cookieKidSid','cookieKidVid','ip','userAgent','acceptLanguage','referrer','gclid','gbraid','wbraid','gadCampaignId','fbclid','landingUrl'];
ok(count(array_diff(array_keys($b), $allowed)) === 0, 'resolve body: only declared names');
ok($b['gclid'] === 'Cj0abc' && $b['fbclid'] === 'IwAR0x' && $b['proposedKidSid'] === 'kid_Ab3dE9xZ' && !array_key_exists('threadedKidSid', $b) && !isset($b['ipHash']), 'resolve body: click ids, proposed id, no ipHash');
ok(kismet_telemetry_click_ids('gclid=' . str_repeat('a', 600))['gclid'] === null, 'click ids: length guard');

// Route profile
$profile = ['property_pattern' => '^/stays/[^/]+/([^/]+)/?$', 'property_id_kind' => 'externalListingId', 'search_paths' => "/stays\n/stays/in/*", 'intent_path' => '/stays/checkout', 'checkin_param' => 'checkin', 'checkout_param' => 'checkout', 'guests_param' => 'guests'];
ok(kismet_telemetry_classify('/llms.txt', '', $profile)['kind'] === 'agent', 'classify: llms.txt is agent');
ok(kismet_telemetry_classify('/stays/porthleven/x.md', '', $profile)['kind'] === 'agent', 'classify: .md is agent');
ok(kismet_telemetry_classify('/stays/porthleven/x', '', $profile, 'text/markdown, text/html;q=0.5')['kind'] === 'agent', 'classify: Accept prefers markdown');
ok(kismet_telemetry_classify('/images/a.png', '', $profile)['kind'] === 'excluded', 'classify: asset excluded');
ok(kismet_telemetry_classify('/stays', '', $profile)['kind'] === 'search', 'classify: search exact');
ok(kismet_telemetry_classify('/stays/in/falmouth', '', $profile)['kind'] === 'search', 'classify: search prefix beats loose property pattern');
$p = kismet_telemetry_classify('/stays/porthleven/harbour-house', 'in=2026-10-03&out=2026-10-06&party=4', $profile);
ok($p['kind'] === 'property' && $p['externalListingId'] === 'harbour-house' && $p['stayCheckIn'] === '2026-10-03' && $p['guestCount'] === 4, 'classify: property with stay');
$i = kismet_telemetry_classify('/stays/checkout', 'checkin=10/03/2026&checkout=10/06/2026&guests=2', $profile);
ok($i['kind'] === 'intent' && $i['stayCheckIn'] === '2026-10-03' && $i['stayCheckOut'] === '2026-10-06', 'classify: intent with US dates normalized');
ok(kismet_telemetry_classify('/about', '', $profile)['kind'] === 'page', 'classify: plain page');

// Event body
$ev = kismet_telemetry_event_body(['page_url' => 'https://www.example.co.uk/stays/porthleven/harbour-house', 'serving_domain' => 'example.co.uk', 'collection' => 'sea-view-stays', 'ua' => 'GPTBot/1.2', 'ip' => '203.0.113.7', 'country' => 'US', 'referrer' => null, 'session' => 'kid_Ab3dE9xZ', 'cls' => $p, 'is_bot' => true, 'bot_name' => 'GPTBot', 'bot_category' => 'training']);
ok($ev['trackingMode'] === 'server' && $ev['clientSessionId'] === null && $ev['isBot'] === true && $ev['actionType'] === 'property_view' && $ev['resourceClass'] === 'content_vr' && $ev['externalListingId'] === 'harbour-house' && $ev['servingDomain'] === 'example.co.uk', 'event: bot never carries a session; property fields');
$ev = kismet_telemetry_event_body(['page_url' => 'https://www.example.co.uk/about', 'serving_domain' => 'example.co.uk', 'collection' => 'sea-view-stays', 'ua' => 'Mozilla', 'ip' => null, 'country' => '', 'referrer' => 'https://chatgpt.com/', 'session' => 'kid_Ab3dE9xZ', 'cls' => kismet_telemetry_classify('/about', '', $profile), 'is_bot' => false, 'bot_name' => null, 'bot_category' => null]);
ok($ev['clientSessionId'] === 'kid_Ab3dE9xZ' && $ev['actionType'] === 'view' && !array_key_exists('externalListingId', $ev) && $ev['country'] === null, 'event: human view with session; conditional fields absent');
$ev = kismet_telemetry_event_body(['page_url' => 'https://www.example.co.uk/llms.txt', 'serving_domain' => 'example.co.uk', 'collection' => 'sea-view-stays', 'ua' => 'ClaudeBot', 'ip' => null, 'country' => '', 'referrer' => null, 'session' => null, 'cls' => kismet_telemetry_classify('/llms.txt', '', $profile), 'is_bot' => true, 'bot_name' => 'ClaudeBot', 'bot_category' => 'training']);
ok($ev['actionType'] === 'fetch' && $ev['clientSessionId'] === null, 'event: agent surface is fetch with null session');

// Bootstrap: seed before tag, suppression path, no reserved globals, 1.5 s fallback
$js = kismet_telemetry_bootstrap_js('https://www.example.co.uk/wp-admin/admin-ajax.php', 'https://kismet.travel/k.js', 'sea-view-stays');
ok(strpos($js, '_kidSid=') !== false && strpos($js, '_sidSuppressed=1') !== false && strpos($js, '1500') !== false, 'bootstrap: seeds id or suppression, 1.5 s fallback');
ok(strpos($js, '_kidSid=') < strpos($js, "s.src=K.kjs") || strpos($js, 'function load()') !== false, 'bootstrap: the tag is injected after the seed is set');
foreach (['__kismetKjs', '__kismetKjsEval', '__kismetKjsTag', '__kismetAnalyticsAdapterMounted'] as $g) { ok(strpos($js, $g) === false, "bootstrap: never touches reserved global $g"); }
ok(strpos($js, 'kismet_telemetry_anchor') !== false && strpos($js, 'ctk_') === false, 'bootstrap: calls our endpoint, carries no key');

// Conversion validation
ok(kismet_telemetry_valid_confirmation_code('EX-48213') && !kismet_telemetry_valid_confirmation_code('platform') && !kismet_telemetry_valid_confirmation_code('12345'), 'confirmation code rule');

ok(kismet_telemetry_valid_vid('vid_' . str_repeat('a', 64)) !== null, 'opaque visitor token grammar');

echo "\n$count checks, $fails failed\n";
exit($fails === 0 ? 0 : 1);
