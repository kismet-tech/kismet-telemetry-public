/* Compare the browser's submitted consent configuration with the rendered readback.
 * The server cannot see a value that an upstream WAF removed. No keys are stored. */
(function () {
    var form = document.getElementById('kismet-telemetry-settings');
    if (!form) return;
    var pattern = form.elements.kismet_telemetry_consent_pattern;
    var cookie = form.elements.kismet_telemetry_consent_cookie;
    var mode = form.elements.kismet_telemetry_consent_mode;
    var key = 'kismet-consent-save:' + location.pathname;
    function values() { return JSON.stringify([mode.value, cookie.value.trim(), pattern.value.trim()]); }
    function required() { cookie.required = pattern.required = mode.value === 'cookie'; }
    required();
    form.addEventListener('change', required);
    try {
        var previous = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
        if (previous !== null && previous !== values()) {
            var warning = document.createElement('div');
            warning.className = 'notice notice-error';
            warning.setAttribute('role', 'alert');
            warning.textContent = 'Your saved consent settings differ from what you submitted. A firewall may have changed the form. Review the stored values below before testing. For CookieYes, try analytics:yes.';
            form.before(warning);
        }
    } catch (_) { /* Server-side validation still fails closed without storage. */ }
    form.addEventListener('submit', function () {
        try { sessionStorage.setItem(key, values()); } catch (_) {}
    });
})();
