<?php
// Bot detection from the shared vocabulary (generated) plus the generic-client
// suppression policy. Ingest re-classifies from the raw user agent; this decides
// only whether a session rides along and whether the anchor mints.

defined('ABSPATH') || exit;

/**
 * Match the shared vocabulary.
 * @return array{isBot:bool,botName:?string,botCategory:?string}
 */
function kismet_telemetry_detect_bot(string $ua): array {
    if ($ua === '') {
        return ['isBot' => false, 'botName' => null, 'botCategory' => null];
    }
    foreach (kismet_telemetry_bot_patterns() as $row) {
        if (stripos($ua, $row['pattern']) !== false) {
            return ['isBot' => true, 'botName' => $row['name'], 'botCategory' => $row['category']];
        }
    }
    return ['isBot' => false, 'botName' => null, 'botCategory' => null];
}

/**
 * The anchor's gate: the vocabulary, plus generic clients that are not guests
 * (curl, headless browsers, monitors, link previews). A missing UA is a bot.
 */
function kismet_telemetry_is_bot(string $ua): bool {
    if ($ua === '') {
        return true;
    }
    if (kismet_telemetry_detect_bot($ua)['isBot']) {
        return true;
    }
    return (bool) preg_match(
        '~bot|crawl|spider|slurp|fetch|scrape|curl|wget|python-requests|headless|lighthouse|pagespeed|preview|monitor|embedly|quora link preview|showyoubot|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegrambot|discordbot|anthropic-ai|yandex|semrush|ahrefs|mj12bot|dotbot|petalbot~i',
        $ua
    );
}
