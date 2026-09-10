<?php
// Encryption at rest for the tracking key. Key material is SECURE_AUTH_KEY (or
// AUTH_KEY) plus the site URL, salted with AUTH_SALT: host-bound, so a bare
// wp_options leak alone does not expose the key, and a domain migration means the
// key is re-entered. Same posture as Kismet Elements' credential storage.

defined('ABSPATH') || exit;

const KISMET_TELEMETRY_CIPHER     = 'aes-256-gcm';
const KISMET_TELEMETRY_KEY_LENGTH = 32;

/** @return string|false */
function kismet_telemetry_derive_key() {
    if (defined('SECURE_AUTH_KEY') && SECURE_AUTH_KEY !== '') {
        $base = SECURE_AUTH_KEY;
    } elseif (defined('AUTH_KEY') && AUTH_KEY !== '') {
        $base = AUTH_KEY;
    } else {
        return false;
    }
    if (!defined('AUTH_SALT') || AUTH_SALT === '') {
        return false;
    }
    return hash_pbkdf2('sha256', $base . get_site_url() . 'kismet-telemetry-v1', AUTH_SALT, 100000, KISMET_TELEMETRY_KEY_LENGTH, true);
}

/** @return string|false base64(iv . tag . ciphertext) */
function kismet_telemetry_encrypt(string $plaintext) {
    $key = kismet_telemetry_derive_key();
    if ($key === false) {
        return false;
    }
    $iv  = random_bytes(openssl_cipher_iv_length(KISMET_TELEMETRY_CIPHER));
    $tag = '';
    $enc = openssl_encrypt($plaintext, KISMET_TELEMETRY_CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag);
    if ($enc === false) {
        return false;
    }
    return base64_encode($iv . $tag . $enc);
}

/** @return string|false */
function kismet_telemetry_decrypt(string $ciphertext_b64) {
    $key = kismet_telemetry_derive_key();
    if ($key === false) {
        return false;
    }
    $data = base64_decode($ciphertext_b64, true);
    if ($data === false) {
        return false;
    }
    $iv_len = openssl_cipher_iv_length(KISMET_TELEMETRY_CIPHER);
    $iv     = substr($data, 0, $iv_len);
    $tag    = substr($data, $iv_len, 16);
    $enc    = substr($data, $iv_len + 16);
    $plain  = openssl_decrypt($enc, KISMET_TELEMETRY_CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag);
    return $plain === false ? false : $plain;
}
