import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('../includes/settings-validation.js', import.meta.url), 'utf8');
function render(stored, submitted = null, blocked = false) {
  const callbacks = {}, notices = [];
  let saved = submitted;
  const elements = {
    kismet_telemetry_consent_mode: { value: 'cookie' },
    kismet_telemetry_consent_cookie: { value: 'cookieyes-consent' },
    kismet_telemetry_consent_pattern: { value: stored },
  };
  const form = { elements, addEventListener: (name, fn) => { callbacks[name] = fn; }, before: n => notices.push(n) };
  vm.runInNewContext(source, {
    document: { getElementById: () => form, createElement: () => ({ setAttribute() {} }) },
    location: { pathname: '/wp-admin/options-general.php' },
    sessionStorage: {
      getItem: () => { if (blocked) throw Error('blocked'); return saved; },
      removeItem: () => { saved = null; },
      setItem: (_, value) => { saved = value; },
    },
  });
  return { elements, callbacks, notices, saved: () => saved };
}
const submitted = JSON.stringify(['cookie', 'cookieyes-consent', '(?:^|,)analytics:yes(?:,|$)']);
test('WAF stripping or changing the pattern produces a visible readback warning', () => {
  for (const stored of ['', 'analytics:no']) assert.equal(render(stored, submitted).notices.length, 1);
});
test('unchanged save does not warn and comparison is consumed once', () => {
  const b = render('(?:^|,)analytics:yes(?:,|$)', submitted);
  assert.equal(b.notices.length, 0);
  assert.equal(b.saved(), null);
});
test('cookie mode requires both fields; other modes do not', () => {
  const b = render('analytics:yes');
  assert.equal(b.elements.kismet_telemetry_consent_pattern.required, true);
  assert.equal(b.elements.kismet_telemetry_consent_cookie.required, true);
  b.elements.kismet_telemetry_consent_mode.value = 'geo';
  b.callbacks.change();
  assert.equal(b.elements.kismet_telemetry_consent_pattern.required, false);
});
test('submission stores only consent fields, not tracking credentials', () => {
  const b = render('analytics:yes');
  b.callbacks.submit();
  assert.equal(b.saved(), JSON.stringify(['cookie', 'cookieyes-consent', 'analytics:yes']));
});
test('unavailable session storage does not break required validation', () => {
  const b = render('', null, true);
  assert.equal(b.elements.kismet_telemetry_consent_pattern.required, true);
});
