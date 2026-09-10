<?php
// Options, accessors, and the Settings screen (Settings → Kismet Telemetry).
//
// Options (all prefixed kismet_telemetry_):
//   enabled            '1' | ''
//   collection_slug    string
//   tracking_key       encrypted ctk_/mtk_ key (never echoed back to the form)
//   cookie_domain      optional override, e.g. .example.com
//   consent_mode       'geo' (default) | 'always' | 'cookie'
//   consent_cookie     cookie name the consent manager sets (consent_mode=cookie)
//   consent_pattern    optional regex the cookie value must match (consent_mode=cookie)
//   property_pattern   optional PCRE on the request path; first capture group = listing id
//   property_id_kind   'externalListingId' (default) | 'vrSlug'
//   search_paths       newline list; a trailing * is a prefix match
//   intent_path        the book-now / checkout path
//   checkin_param, checkout_param, guests_param  query names on the intent path
//
// When Kismet Elements is active and our slug or key is empty, its values are used
// (elements-compat.php), so installing on an Elements site needs no re-entry.

defined('ABSPATH') || exit;

function kismet_telemetry_opt(string $name, $default = '') {
    return get_option('kismet_telemetry_' . $name, $default);
}

function kismet_telemetry_enabled(): bool {
    if (empty(kismet_telemetry_opt('enabled'))) {
        return false;
    }
    return kismet_telemetry_tracking_key() !== '' && kismet_telemetry_collection() !== '';
}

function kismet_telemetry_collection(): string {
    $own = trim((string) kismet_telemetry_opt('collection_slug', ''));
    if ($own !== '') {
        return $own;
    }
    return (string) apply_filters('kismet_telemetry_collection_fallback', '');
}

/** The decrypted tracking key; '' when unset or undecryptable (unless it is a plaintext key). */
function kismet_telemetry_tracking_key(): string {
    $stored = (string) kismet_telemetry_opt('tracking_key', '');
    if ($stored === '') {
        return (string) apply_filters('kismet_telemetry_tracking_key_fallback', '');
    }
    $plain = kismet_telemetry_decrypt($stored);
    if (is_string($plain) && $plain !== '') {
        return $plain;
    }
    return preg_match('/^(ctk|mtk)_[A-Za-z0-9_-]+$/', $stored) ? $stored : '';
}

function kismet_telemetry_set_tracking_key(string $key): void {
    $key = trim($key);
    if ($key === '') {
        delete_option('kismet_telemetry_tracking_key');
        return;
    }
    $enc = kismet_telemetry_encrypt($key);
    update_option('kismet_telemetry_tracking_key', $enc !== false ? $enc : $key, false);
}

// ── Admin screen ───────────────────────────────────────────────────────────────

function kismet_telemetry_admin_menu(): void {
    add_options_page('Kismet Telemetry', 'Kismet Telemetry', 'manage_options', 'kismet-telemetry', 'kismet_telemetry_admin_page');
}

function kismet_telemetry_admin_save(): void {
    if (!isset($_POST['kismet_telemetry_save'])) {
        return;
    }
    if (!current_user_can('manage_options') || !check_admin_referer('kismet_telemetry_settings')) {
        return;
    }
    $text = static function (string $name): string {
        return sanitize_text_field(wp_unslash((string) ($_POST[$name] ?? '')));
    };
    update_option('kismet_telemetry_enabled', isset($_POST['kismet_telemetry_enabled']) ? '1' : '', false);
    update_option('kismet_telemetry_collection_slug', $text('kismet_telemetry_collection_slug'), false);
    $posted_key = trim((string) wp_unslash((string) ($_POST['kismet_telemetry_tracking_key'] ?? '')));
    if ($posted_key !== '') {
        if (preg_match('/^(ctk|mtk)_[A-Za-z0-9_-]+$/', $posted_key)) {
            kismet_telemetry_set_tracking_key($posted_key);
        } else {
            add_settings_error('kismet_telemetry', 'key', 'Tracking key must look like ctk_… or mtk_…; left unchanged.');
        }
    }
    $domain = $text('kismet_telemetry_cookie_domain');
    update_option('kismet_telemetry_cookie_domain', $domain === '' ? '' : ('.' . ltrim($domain, '.')), false);
    $mode = $text('kismet_telemetry_consent_mode');
    update_option('kismet_telemetry_consent_mode', in_array($mode, ['geo', 'always', 'cookie'], true) ? $mode : 'geo', false);
    update_option('kismet_telemetry_consent_cookie', $text('kismet_telemetry_consent_cookie'), false);
    $pattern = trim((string) wp_unslash((string) ($_POST['kismet_telemetry_consent_pattern'] ?? '')));
    update_option('kismet_telemetry_consent_pattern', kismet_telemetry_valid_regex($pattern) ? $pattern : '', false);
    $prop = trim((string) wp_unslash((string) ($_POST['kismet_telemetry_property_pattern'] ?? '')));
    if ($prop !== '' && !kismet_telemetry_valid_regex($prop)) {
        add_settings_error('kismet_telemetry', 'property_pattern', 'Property pattern is not a valid regular expression; left unchanged.');
    } else {
        update_option('kismet_telemetry_property_pattern', $prop, false);
    }
    $kind = $text('kismet_telemetry_property_id_kind');
    update_option('kismet_telemetry_property_id_kind', $kind === 'vrSlug' ? 'vrSlug' : 'externalListingId', false);
    update_option('kismet_telemetry_search_paths', sanitize_textarea_field(wp_unslash((string) ($_POST['kismet_telemetry_search_paths'] ?? ''))), false);
    update_option('kismet_telemetry_intent_path', $text('kismet_telemetry_intent_path'), false);
    update_option('kismet_telemetry_checkin_param', $text('kismet_telemetry_checkin_param') ?: 'checkin', false);
    update_option('kismet_telemetry_checkout_param', $text('kismet_telemetry_checkout_param') ?: 'checkout', false);
    update_option('kismet_telemetry_guests_param', $text('kismet_telemetry_guests_param') ?: 'guests', false);
    add_settings_error('kismet_telemetry', 'saved', 'Settings saved.', 'updated');
}

/** A regex the site typed is only used if PCRE accepts it (with a fixed delimiter). */
function kismet_telemetry_valid_regex(string $pattern): bool {
    if ($pattern === '') {
        return false;
    }
    return @preg_match('~' . str_replace('~', '\~', $pattern) . '~', '') !== false;
}

function kismet_telemetry_admin_page(): void {
    if (!current_user_can('manage_options')) {
        return;
    }
    $has_key   = kismet_telemetry_tracking_key() !== '';
    $own_key   = (string) kismet_telemetry_opt('tracking_key', '') !== '';
    $elements  = function_exists('kismet_elements_tracking_key');
    $mode      = (string) kismet_telemetry_opt('consent_mode', 'geo');
    $field     = static function (string $name, string $value, string $placeholder = '', string $type = 'text'): void {
        printf('<input type="%s" id="%s" name="%s" value="%s" class="regular-text" placeholder="%s" autocomplete="off" />', esc_attr($type), esc_attr($name), esc_attr($name), esc_attr($value), esc_attr($placeholder));
    };
    settings_errors('kismet_telemetry');
    ?>
    <div class="wrap">
        <h1>Kismet Telemetry <span style="font-size:12px;color:#666;">v<?php echo esc_html(KISMET_TELEMETRY_VERSION); ?>, contract <?php echo esc_html(KISMET_TELEMETRY_CONTRACT_VERSION); ?></span></h1>
        <p style="max-width:44em;">A first-party visitor session on your own domain, every page and AI crawler visit recorded server-side, and bookings joined to the visit. Nothing waits on Kismet; a cold visitor gets a locally minted session and the reconciliation runs after the page is served. Docs: <a href="https://developers.kismet.travel/telemetry/" target="_blank" rel="noopener">developers.kismet.travel/telemetry</a>.</p>
        <?php if ($elements): ?>
            <div class="notice notice-info inline"><p>Kismet Elements is active. This plugin now owns tracking; Elements' own anchor and beacon are switched off, and its collection slug and tracking key are used when the fields below are empty.</p></div>
        <?php endif; ?>
        <form method="post">
            <?php wp_nonce_field('kismet_telemetry_settings'); ?>
            <input type="hidden" name="kismet_telemetry_save" value="1" />
            <h2>Connection</h2>
            <table class="form-table">
                <tr><th scope="row">Enabled</th><td><label><input type="checkbox" name="kismet_telemetry_enabled" value="1" <?php checked(!empty(kismet_telemetry_opt('enabled'))); ?> /> Record visits and give consenting visitors a session</label><p class="description">Also needs a collection slug and a tracking key.</p></td></tr>
                <tr><th scope="row"><label for="kismet_telemetry_collection_slug">Collection slug</label></th><td><?php $field('kismet_telemetry_collection_slug', (string) kismet_telemetry_opt('collection_slug', ''), $elements ? 'inherited from Kismet Elements when empty' : 'your-collection'); ?></td></tr>
                <tr><th scope="row"><label for="kismet_telemetry_tracking_key">Tracking key</label></th><td><?php $field('kismet_telemetry_tracking_key', '', $has_key ? ($own_key ? 'configured (encrypted). Paste a new ctk_… to replace' : 'inherited from Kismet Elements. Paste a ctk_… to override') : 'ctk_…', 'password'); ?><p class="description">A server-side key from your Kismet account. Encrypted at rest, never sent to the browser.</p></td></tr>
                <tr><th scope="row"><label for="kismet_telemetry_cookie_domain">Cookie domain override</label></th><td><?php $field('kismet_telemetry_cookie_domain', (string) kismet_telemetry_opt('cookie_domain', ''), 'default: .' . kismet_telemetry_serving_host()); ?><p class="description">Only for a site whose registrable domain is deeper than this host.</p></td></tr>
            </table>
            <h2>Consent</h2>
            <p class="description" style="max-width:44em;">Consent gates the session (cookie, id, seed). Page views and crawler visits are recorded either way, without a session. The country default reads a Cloudflare or Vercel country header; most hosts do not send one, so wire your consent manager here.</p>
            <table class="form-table">
                <tr><th scope="row">Mode</th><td>
                    <label><input type="radio" name="kismet_telemetry_consent_mode" value="geo" <?php checked($mode, 'geo'); ?> /> Country default (EU, EEA, UK and Switzerland denied without a consent signal)</label><br/>
                    <label><input type="radio" name="kismet_telemetry_consent_mode" value="cookie" <?php checked($mode, 'cookie'); ?> /> Read my consent manager's cookie</label><br/>
                    <label><input type="radio" name="kismet_telemetry_consent_mode" value="always" <?php checked($mode, 'always'); ?> /> Always allow (sites with no consent obligation)</label>
                </td></tr>
                <tr><th scope="row"><label for="kismet_telemetry_consent_cookie">Consent cookie name</label></th><td><?php $field('kismet_telemetry_consent_cookie', (string) kismet_telemetry_opt('consent_cookie', ''), 'CookieConsent'); ?></td></tr>
                <tr><th scope="row"><label for="kismet_telemetry_consent_pattern">Value must match</label></th><td><?php $field('kismet_telemetry_consent_pattern', (string) kismet_telemetry_opt('consent_pattern', ''), 'statistics:true (regular expression, optional)'); ?></td></tr>
            </table>
            <h2>Route profile</h2>
            <p class="description" style="max-width:44em;">Which URLs are which, so the funnel stages light without any code: property pages, results pages, the checkout path. Developers can also use the <code>kismet_telemetry_property</code>, <code>kismet_telemetry_is_search</code> and <code>kismet_telemetry_intent</code> filters.</p>
            <table class="form-table">
                <tr><th scope="row"><label for="kismet_telemetry_property_pattern">Property page pattern</label></th><td><?php $field('kismet_telemetry_property_pattern', (string) kismet_telemetry_opt('property_pattern', ''), '^/stays/[^/]+/([^/]+)/?$'); ?><p class="description">Regular expression on the path; the first capture group is the listing identifier.</p></td></tr>
                <tr><th scope="row">Identifier kind</th><td><select name="kismet_telemetry_property_id_kind"><option value="externalListingId" <?php selected(kismet_telemetry_opt('property_id_kind', 'externalListingId'), 'externalListingId'); ?>>My own listing id (externalListingId)</option><option value="vrSlug" <?php selected(kismet_telemetry_opt('property_id_kind', 'externalListingId'), 'vrSlug'); ?>>Kismet property slug</option></select></td></tr>
                <tr><th scope="row"><label for="kismet_telemetry_search_paths">Results pages</label></th><td><textarea id="kismet_telemetry_search_paths" name="kismet_telemetry_search_paths" class="regular-text" rows="3" placeholder="/stays&#10;/stays/in/*"><?php echo esc_textarea((string) kismet_telemetry_opt('search_paths', '')); ?></textarea><p class="description">One path per line; a trailing * matches a prefix.</p></td></tr>
                <tr><th scope="row"><label for="kismet_telemetry_intent_path">Checkout path</label></th><td><?php $field('kismet_telemetry_intent_path', (string) kismet_telemetry_opt('intent_path', ''), '/checkout'); ?></td></tr>
                <tr><th scope="row">Stay parameters</th><td>
                    <?php $field('kismet_telemetry_checkin_param', (string) kismet_telemetry_opt('checkin_param', 'checkin'), 'checkin'); ?>
                    <?php $field('kismet_telemetry_checkout_param', (string) kismet_telemetry_opt('checkout_param', 'checkout'), 'checkout'); ?>
                    <?php $field('kismet_telemetry_guests_param', (string) kismet_telemetry_opt('guests_param', 'guests'), 'guests'); ?>
                </td></tr>
            </table>
            <?php submit_button('Save settings'); ?>
        </form>
        <h2>Verify</h2>
        <ol style="max-width:44em;">
            <li>Load the home page in a fresh browser. Expect a <code>_kid_sid</code> cookie on <code><?php echo esc_html('.' . kismet_telemetry_serving_host()); ?></code> and <code>window.Kismet._kidSid</code> equal to it.</li>
            <li>Reload. Same value, no new cookie.</li>
            <li><code>curl -A GPTBot <?php echo esc_html(home_url('/')); ?></code>: no cookie; Kismet records the crawler visit with no session.</li>
            <li>From a consent jurisdiction without consent: no cookie, the page view still recorded.</li>
        </ol>
    </div>
    <?php
}
