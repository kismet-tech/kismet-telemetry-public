<?php
// Booking bridge and quote capture (contract sections 9 and 10), for themes and
// booking plugins to call server-side from the code that knows the booking
// succeeded. Both are bounded, never throw, and must not affect the booking.
//
//   kismet_telemetry_booking_bridge(['confirmationCode' => 'EX-48213', 'bookingEngine' => 'custom']);
//   kismet_telemetry_quote_capture(['checkIn' => '2026-10-03', 'checkOut' => '2026-10-06', 'totalAmountCents' => 57500, 'currency' => 'GBP']);
//
// kidSid defaults to the visitor's _kid_sid cookie on the current request; pass it
// explicitly from an asynchronous pipeline.

defined('ABSPATH') || exit;

function kismet_telemetry_valid_confirmation_code($s): bool {
    return is_string($s) && strlen($s) >= 6 && strlen($s) <= 64 && preg_match('/[0-9]/', $s) === 1;
}

/** @return array{ok:bool,status:?int,error:?string} */
function kismet_telemetry_booking_bridge(array $body): array {
    $kid = kismet_telemetry_valid_kid($body['kidSid'] ?? (isset($_COOKIE['_kid_sid']) ? (string) $_COOKIE['_kid_sid'] : null));
    if ($kid === null) {
        return ['ok' => false, 'status' => null, 'error' => 'no kidSid (no session on this visitor)'];
    }
    $code = $body['confirmationCode'] ?? null;
    $rid  = $body['reservationId'] ?? null;
    if (!$code && !$rid) {
        return ['ok' => false, 'status' => null, 'error' => 'confirmationCode or reservationId is required'];
    }
    if ($code && !kismet_telemetry_valid_confirmation_code($code)) {
        return ['ok' => false, 'status' => null, 'error' => 'confirmationCode must be 6 to 64 chars and contain a digit'];
    }
    $wire = ['kidSid' => $kid];
    if ($code) {
        $wire['confirmationCode'] = (string) $code;
    }
    if ($rid) {
        $wire['reservationId'] = (string) $rid;
    }
    if (!empty($body['bookingEngine'])) {
        $wire['bookingEngine'] = (string) $body['bookingEngine'];
    }
    $wire['domain'] = (string) ($body['domain'] ?? kismet_telemetry_serving_host());
    return kismet_telemetry_api_post('/v1/booking-bridge', $wire);
}

/** @return array{ok:bool,status:?int,error:?string} */
function kismet_telemetry_quote_capture(array $body): array {
    $kid = kismet_telemetry_valid_kid($body['kidSid'] ?? (isset($_COOKIE['_kid_sid']) ? (string) $_COOKIE['_kid_sid'] : null));
    if ($kid === null) {
        return ['ok' => false, 'status' => null, 'error' => 'no kidSid (no session on this visitor)'];
    }
    if (isset($body['totalAmountCents']) && !is_int($body['totalAmountCents'])) {
        return ['ok' => false, 'status' => null, 'error' => 'totalAmountCents must be an integer'];
    }
    $wire = array_merge(['collectionSlug' => kismet_telemetry_collection(), 'domain' => kismet_telemetry_serving_host()], $body, ['kidSid' => $kid]);
    return kismet_telemetry_api_post('/v1/quote-capture', $wire);
}

function kismet_telemetry_api_post(string $path, array $body): array {
    $res = wp_remote_post(KISMET_TELEMETRY_API_ORIGIN . $path, [
        'timeout' => 2,
        'headers' => ['Content-Type' => 'application/json', 'X-Kismet-Tracking-Key' => kismet_telemetry_tracking_key()],
        'body'    => wp_json_encode($body),
    ]);
    if (is_wp_error($res)) {
        return ['ok' => false, 'status' => null, 'error' => $res->get_error_message()];
    }
    $status = (int) wp_remote_retrieve_response_code($res);
    return ['ok' => $status >= 200 && $status < 300, 'status' => $status, 'error' => $status >= 200 && $status < 300 ? null : 'HTTP ' . $status];
}
