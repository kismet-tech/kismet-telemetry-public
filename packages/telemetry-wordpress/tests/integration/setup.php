<?php
foreach ([
    'enabled' => '1', 'collection_slug' => 'example-collection',
    'consent_mode' => 'cookie', 'consent_cookie' => 'lab_consent', 'consent_pattern' => '^yes$',
    'property_pattern' => '^/stays/([^/]+)', 'property_id_kind' => 'externalListingId',
    'search_paths' => '/search', 'intent_path' => '/checkout',
] as $name => $value) {
    update_option('kismet_telemetry_' . $name, $value);
}
kismet_telemetry_set_tracking_key('ctk_local_validation_only');
echo 'Telemetry fixture configured.';
