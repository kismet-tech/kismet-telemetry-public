<?php
// Local-only collector. The compose service has no production credentials.
$file = '/tmp/telemetry-events.jsonl';
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
header('Content-Type: application/json');
if ($path === '/events') {
    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        file_put_contents($file, '');
        echo '{}';
    } else {
        $lines = file_exists($file) ? file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
        echo json_encode(array_map(fn($line) => json_decode($line, true), $lines));
    }
    return;
}
file_put_contents($file, json_encode([
    'path' => $path,
    'key' => $_SERVER['HTTP_X_KISMET_TRACKING_KEY'] ?? null,
    'body' => json_decode(file_get_contents('php://input'), true),
]) . "\n", FILE_APPEND | LOCK_EX);
http_response_code($path === '/v1/booking-bridge' ? 201 : 200);
echo json_encode(['ok' => true, 'success' => true, 'bridgeId' => 'lab-only']);
