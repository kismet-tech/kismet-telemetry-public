<?php
// Loaded only into the disposable integration-test WordPress installation.
if (wp_get_environment_type() !== 'local') { return; }
add_action('template_redirect', function () {
    if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/lab-k.js') {
        header('Content-Type: application/javascript');
        echo 'window.__labTrackerLoaded = true;';
        exit;
    }
}, 0);
add_action('template_redirect', function () {
    status_header(200);
    echo '<!doctype html><html><head>'; wp_head();
    echo '</head><body><h1>Local telemetry validation</h1></body></html>';
    exit;
}, 100);
add_action('wp_ajax_nopriv_telemetry_lab_booking', function () {
    // Simulates the point AFTER a checkout has confirmed a test reservation.
    $result = kismet_telemetry_booking_bridge([
        'confirmationCode' => 'EX-48213', 'bookingEngine' => 'custom',
    ]);
    wp_send_json(['testBookingConfirmed' => true, 'bridge' => $result]);
});
