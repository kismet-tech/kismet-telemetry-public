import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';

const source = execFileSync('php', ['-r', `
define('ABSPATH', '/stub/');
function wp_json_encode($v, $flags = 0) { return json_encode($v, $flags); }
require 'includes/anchor.php';
echo kismet_telemetry_bootstrap_js('/wp-admin/admin-ajax.php', '/lab-k.js', 'example-collection');
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

function browser(fetch) {
  const scripts = [];
  let timeout;
  const window = { Kismet: { _kidSid: 'kid_Old00001' } };
  const context = {
    window, fetch,
    document: {
      cookie: '_kid_sid=kid_Old00001',
      createElement: () => ({}),
      head: { appendChild: script => scripts.push(script) },
    },
    location: { href: 'https://example.com/stays/property-42', search: '' },
    setTimeout: callback => { timeout = callback; return 1; },
    clearTimeout: () => {},
  };
  vm.runInNewContext(source, context);
  return { window, scripts, expire: () => timeout() };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('warm bootstrap consults current consent before loading the tracker', async () => {
  let calls = 0;
  const b = browser(async () => { calls++; return { json: async () => ({ suppressed: 1 }) }; });
  assert.equal(calls, 1);
  assert.equal(b.scripts.length, 0);
  await flush();
  assert.equal(b.window.Kismet._sidSuppressed, 1);
  assert.equal(b.window.Kismet._kidSid, undefined);
  assert.equal(b.scripts.length, 0);
});

test('successful anchor sets the identity before loading the tracker', async () => {
  const b = browser(async () => ({ json: async () => ({ kid_sid: 'kid_New00001' }) }));
  await flush();
  assert.equal(b.window.Kismet._kidSid, 'kid_New00001');
  assert.equal(b.window.Kismet._sidSuppressed, 0);
  assert.equal(b.scripts.length, 1);
});

test('failed anchor suppresses identity rather than reusing the warm cookie', async () => {
  const b = browser(async () => { throw new Error('Local test failure'); });
  await flush();
  assert.equal(b.window.Kismet._sidSuppressed, 1);
  assert.equal(b.window.Kismet._kidSid, undefined);
});

test('timeout suppresses identity and ignores late authority response', async () => {
  let complete;
  const b = browser(() => new Promise(resolve => { complete = resolve; }));
  b.expire();
  complete({ json: async () => ({ kid_sid: 'kid_Late0001' }) });
  await flush();
  assert.equal(b.window.Kismet._sidSuppressed, 1);
  assert.equal(b.window.Kismet._kidSid, undefined);
  assert.equal(b.scripts.length, 0);
});
