import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';

const source = execFileSync('php', ['-r', `
define('ABSPATH', '/stub/');
function wp_json_encode($v, $flags = 0) { return json_encode($v, $flags); }
require 'includes/anchor.php';
echo kismet_telemetry_bootstrap_js('/wp-admin/admin-ajax.php', '/lab-k.js', 'example-collection', 'cookieyes-consent');
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

function browser(fetch) {
  const scripts = [];

  const window = { Kismet: { _kidSid: 'kid_Old00001' } };
  const context = {
    window, fetch,
    document: {
      cookie: '_kid_sid=kid_Old00001; cookieyes-consent=analytics:yes',
      createElement: () => ({}),
      head: { appendChild: script => scripts.push(script) },
    },
    location: { href: 'https://example.com/stays/property-42', search: '' },
    setTimeout: () => { throw new Error('Bootstrap must not time out consent'); },
  };
  vm.runInNewContext(source, context);
  return { window, scripts, document: context.document };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('warm bootstrap consults current consent before loading the tracker', async () => {
  let calls = 0;
  const b = browser(async () => { calls++; return { ok: true, json: async () => ({ suppressed: 1 }) }; });
  assert.equal(calls, 1);
  assert.equal(b.scripts.length, 0);
  await flush();
  assert.equal(b.window.Kismet._sidSuppressed, 1);
  assert.equal(b.window.Kismet._kidSid, undefined);
  assert.equal(b.scripts.length, 0);
});

test('successful anchor sets the identity before loading the tracker', async () => {
  const b = browser(async () => ({ ok: true, json: async () => ({ kid_sid: 'kid_New00001' }) }));
  await flush();
  assert.equal(b.window.Kismet._kidSid, 'kid_New00001');
  assert.equal(b.window.Kismet._sidSuppressed, 0);
  assert.equal(b.scripts.length, 1);
});

test('network failure leaves consent unknown and does not load or destroy a seed', async () => {
  const b = browser(async () => { throw new Error('Local test failure'); });
  await flush();
  assert.equal(b.window.Kismet._sidSuppressed, undefined);
  assert.equal(b.window.Kismet._kidSid, 'kid_Old00001');
  assert.equal(b.scripts.length, 0);
});

test('slow anchor remains pending and a late grant loads the tracker once', async () => {
  let complete;
  const b = browser(() => new Promise(resolve => { complete = resolve; }));
  await flush();
  assert.equal(b.scripts.length, 0);
  assert.equal(b.window.Kismet._sidSuppressed, undefined);
  complete({ ok: true, json: async () => ({ kid_sid: 'kid_Late0001' }) });
  await flush();
  assert.equal(b.window.Kismet._sidSuppressed, 0);
  assert.equal(b.window.Kismet._kidSid, 'kid_Late0001');
  assert.equal(b.scripts.length, 1);
});

for (const withdrawal of ['cookie', 'bridge']) {
  test(`late grant cannot reverse ${withdrawal} withdrawal during the request`, async () => {
    let complete;
    const b = browser(() => new Promise(resolve => { complete = resolve; }));
    if (withdrawal === 'cookie') b.document.cookie = 'cookieyes-consent=analytics:no';
    else b.window.Kismet._sidSuppressed = 1;
    complete({ ok: true, json: async () => ({ kid_sid: 'kid_Late0001' }) });
    await flush();
    assert.equal(b.scripts.length, 0);
    assert.notEqual(b.window.Kismet._kidSid, 'kid_Late0001');
  });
}

for (const data of [{ disabled: 1 }, {}, { kid_sid: 'invalid' }]) {
  test(`invalid or disabled anchor does not load: ${JSON.stringify(data)}`, async () => {
    const b = browser(async () => ({ ok: true, json: async () => data }));
    await flush();
    assert.equal(b.scripts.length, 0);
    assert.equal(b.window.Kismet._sidSuppressed, undefined);
  });
}

test('HTTP failure cannot grant consent even if its body looks valid', async () => {
  const b = browser(async () => ({ ok: false, json: async () => ({ kid_sid: 'kid_New00001' }) }));
  await flush();
  assert.equal(b.scripts.length, 0);
});
