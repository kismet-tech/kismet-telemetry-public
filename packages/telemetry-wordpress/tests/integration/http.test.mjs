import assert from 'node:assert/strict';
import test from 'node:test';

const origin = 'http://127.0.0.1:8496';
const site = 'http://telemetry.test:8496';
const collector = 'http://127.0.0.1:8797';
const sid = 'kid_Ab3dE9xZ';
const human = 'Mozilla/5.0 TelemetryValidation';
const headers = { Host: 'telemetry.test:8496', 'User-Agent': human };
async function request(path, extra = {}) {
  return fetch(origin + path, { headers: { ...headers, ...extra }, redirect: 'manual' });
}
async function anchor(cookie = '', page = '/stays/property-42', extra = {}) {
  return request('/wp-admin/admin-ajax.php?action=kismet_telemetry_anchor&u=' + encodeURIComponent(site + page), { Cookie: cookie, ...extra });
}
async function events() { return (await fetch(collector + '/events')).json(); }
async function reset() { await fetch(collector + '/events', { method: 'DELETE' }); }
async function received(path) {
  for (let i = 0; i < 30; i++) {
    const found = (await events()).filter(event => event.path === path);
    if (found.length) return found;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('Collector received no ' + path);
}

test('real WordPress HTTP integration', async t => {
  await t.test('cache-safe HTML does not embed a visitor ID or tracking key', async () => {
    const response = await request('/', { Cookie: 'lab_consent=yes; _kid_sid=' + sid });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Kismet Telemetry/);
    assert.ok(!html.includes(sid));
    assert.ok(!html.includes('ctk_local_validation_only'));
  });
  await t.test('cold consented visitor gets dotted-domain cookie and attributed reconcile', async () => {
    await reset();
    const response = await anchor('lab_consent=yes', '/?gclid=lab-click&utm_source=example');
    const body = await response.json();
    assert.match(body.kid_sid, /^kid_[A-Za-z0-9]{8}$/);
    assert.equal(body.tier, 'minted');
    assert.match(response.headers.get('set-cookie'), /domain=\.telemetry\.test/i);
    assert.match(response.headers.get('set-cookie'), /SameSite=Lax/i);
    assert.match(response.headers.get('cache-control'), /no-cache|no-store/);
    const [event] = await received('/v1/identity/resolve-anchor');
    assert.equal(event.key, 'ctk_local_validation_only');
    assert.equal(event.body.proposedKidSid, body.kid_sid);
    assert.equal(event.body.gclid, 'lab-click');
  });
  await t.test('warm cookie adopts identity without contacting authority', async () => {
    await reset();
    const response = await anchor('lab_consent=yes; _kid_sid=' + sid);
    assert.equal((await response.json()).kid_sid, sid);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await events()).length, 0);
  });
  await t.test('threaded identity is adopted and reconciled', async () => {
    await reset();
    const response = await anchor('lab_consent=yes', '/?kid_sid=' + sid);
    assert.equal((await response.json()).tier, 'threaded');
    assert.equal((await received('/v1/identity/resolve-anchor'))[0].body.threadedKidSid, sid);
  });
  await t.test('unconsented cold visitor is suppressed', async () => {
    await reset();
    const response = await anchor();
    assert.deepEqual(await response.json(), { suppressed: 1 });
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await events()).length, 0);
  });
  await t.test('revoked consent suppresses existing and threaded identities', async () => {
    for (const [cookie, page] of [['_kid_sid=' + sid, '/'], ['', '/?kid_sid=' + sid]]) {
      const response = await anchor(cookie, page);
      assert.deepEqual(await response.json(), { suppressed: 1 });
      assert.equal(response.headers.get('set-cookie'), null);
    }
  });
  await t.test('crawler is anonymous even with a threaded identity', async () => {
    const response = await anchor('lab_consent=yes; _kid_sid=' + sid, '/?kid_sid=' + sid, { 'User-Agent': 'GPTBot/1.2' });
    assert.deepEqual(await response.json(), { suppressed: 1 });
    assert.equal(response.headers.get('set-cookie'), null);
  });
  await t.test('property visit reaches the collector with route mapping', async () => {
    await reset();
    const response = await request('/stays/property-42', { Cookie: 'lab_consent=yes; _kid_sid=' + sid });
    assert.equal(response.status, 200);
    const [event] = await received('/api/track');
    assert.equal(event.body.externalListingId, 'property-42');
    assert.equal(event.body.actionType, 'property_view');
    assert.equal(event.body.clientSessionId, sid);
  });
  await t.test('revoked consent keeps property event anonymous', async () => {
    await reset();
    await request('/stays/property-42', { Cookie: '_kid_sid=' + sid });
    assert.equal((await received('/api/track'))[0].body.clientSessionId, null);
  });
  await t.test('simulated completed booking bridges the visitor to a confirmation', async () => {
    await reset();
    const response = await request('/wp-admin/admin-ajax.php?action=telemetry_lab_booking', { Cookie: 'lab_consent=yes; _kid_sid=' + sid });
    const body = await response.json();
    assert.equal(body.testBookingConfirmed, true);
    assert.equal(body.bridge.ok, true);
    const [event] = await received('/v1/booking-bridge');
    assert.equal(event.body.kidSid, sid);
    assert.equal(event.body.confirmationCode, 'EX-48213');
    assert.equal(event.body.domain, 'telemetry.test');
  });
});
