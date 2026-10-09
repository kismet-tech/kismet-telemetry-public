// Optional real-browser test against the disposable PostgreSQL recognition lab.
// No hosted collection, account, credential or booking is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const adapter = process.env.TELEMETRY_PACKAGE_ROOT;
const { NextRequest } = await import(
    pathToFileURL(require.resolve('next/server.js', adapter ? { paths: [adapter] } : undefined))
        .href
);
const { createKismetMiddleware, readKismetSeed } = await import(
    adapter ? pathToFileURL(join(adapter, 'dist/index.js')).href : '../../dist/index.js'
);
const { kismetSeedInline } = await import(
    adapter ? pathToFileURL(join(adapter, 'dist/seed.js')).href : '../../dist/seed.js'
);
const release = process.env.KISMET_BROWSER_RELEASE_DIR;
assert.ok(
    release,
    'KISMET_BROWSER_RELEASE_DIR must contain the reviewed 1.3.0 manifest and assets'
);
const manifest = JSON.parse(readFileSync(join(release, 'manifest.json')));
const tracker = readFileSync(join(release, manifest.sha256, 'k.js'), 'utf8');
const bridge = readFileSync(join(release, manifest.consent.sha256, 'consent.js'), 'utf8');
const lab = process.env.VISITOR_LAB_ORIGIN || 'http://127.0.0.1:8798';
assert.match(lab, /^http:\/\/127\.0\.0\.1:\d+$/, 'local authority only');
const profile = mkdtempSync(join(tmpdir(), 'kismet-visitor-browser-'));
const tlsKey = join(profile, 'fixture-key.pem');
const tlsCert = join(profile, 'fixture-cert.pem');
execFileSync(
    'openssl',
    [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        tlsKey,
        '-out',
        tlsCert,
        '-days',
        '1',
        '-subj',
        '/CN=www.telemetry.test',
    ],
    { stdio: 'ignore' }
);
const checks = [];
const clientEvents = [];
const errors = [];
let context;
const middleware = createKismetMiddleware({
    collectionSlug: 'example-collection',
    trackingKey: 'ctk_local_validation_only',
    visitorRecognition: true,
    essentialIdentity: 'account-owned-sid',
    consent: ({ headers }) =>
        /(?:^|;\s*)analytics=granted(?:;|$)/.test(headers.get('cookie') || ''),
    endpoints: { resolveAnchor: `${lab}/v1/identity/resolve-anchor`, track: `${lab}/track` },
});
const server = createServer(
    { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) },
    async (req, res) => {
        try {
            const url = new URL(req.url, `https://${req.headers.host}`);
            if (url.pathname === '/consent.js') {
                res.setHeader('content-type', 'application/javascript');
                return res.end(bridge);
            }
            const response = await middleware(new NextRequest(url, { headers: req.headers }), {
                waitUntil: (p) => p.catch((error) => errors.push(error.message)),
            });
            res.setHeader('cache-control', response.headers.get('cache-control') || 'no-store');
            res.setHeader('set-cookie', response.headers.getSetCookie());
            res.statusCode = response.status;
            if (url.pathname === '/__kismet/visitor') {
                res.setHeader('content-type', 'application/json');
                return res.end(await response.text());
            }
            const seed = readKismetSeed({
                get: (name) => response.headers.get('x-middleware-request-' + name),
            });
            const inline = kismetSeedInline({
                ...seed,
                collectionSlug: 'example-collection',
                visitorRecognition: true,
                kjsUrl: manifest.url,
            });
            res.setHeader('content-type', 'text/html');
            res.end(`<!doctype html><html><head><script src="/consent.js"></script></head><body>
<h1>Visitor recognition fixture</h1><script>
window.KismetConsent.configure({essentialIdentity:'account-owned-sid',vendorMode:'kismet-only',
 routePolicy:{allowedPaths:['/stays/home'],allowedQueryKeys:[],allowedHashIds:[]},
 getConsent:()=>({analytics:/(?:^|;\\s*)analytics=granted(?:;|$)/.test(document.cookie),advertising:false})
}).then(()=>{${inline};window.fixtureReady=true});
</script></body></html>`);
        } catch (error) {
            errors.push(error.message);
            res.statusCode = 500;
            res.end('fixture failure');
        }
    }
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `https://www.telemetry.test:${server.address().port}`;
const state = async () => (await fetch(`${lab}/lab/state`)).json();
const initialEventCount = (await state()).events.length;
async function launch(dir = profile) {
    const c = await chromium.launchPersistentContext(dir, {
        executablePath:
            process.env.CHROME_PATH ||
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
        ignoreHTTPSErrors: true,
        userAgent: 'Mozilla/5.0 Chrome/150 Safari/537.36',
        args: ['--host-resolver-rules=MAP www.telemetry.test 127.0.0.1', '--no-proxy-server'],
    });
    await c.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        if (url.href === `${manifest.url}?c=example-collection`)
            return route.fulfill({ contentType: 'application/javascript', body: tracker });
        if (url.pathname === '/api/k/config')
            return route.fulfill({
                headers: { 'access-control-allow-origin': '*' },
                json: { countryCode: 'GB' },
            });
        // Capture tracker output locally; never contact a hosted receiver.
        if (url.pathname === '/api/track') clientEvents.push(route.request().postData());
        else errors.push(`unexpected outbound request: ${url.origin}${url.pathname}`);
        return route.fulfill({
            headers: { 'access-control-allow-origin': '*' },
            json: { ok: true },
        });
    });
    c.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    return c;
}
const cookies = async () =>
    Object.fromEntries((await context.cookies()).map((c) => [c.name, c.value]));
const page = () => context.pages()[0];
const visit = async () => {
    assert.equal((await page().goto(`${origin}/stays/home`)).status(), 200);
    await page().waitForFunction(() => window.fixtureReady);
};
const choice = async (value) => {
    const currentPage = page();
    await Promise.all([
        currentPage.waitForEvent('framenavigated', (frame) => frame === currentPage.mainFrame()),
        currentPage.evaluate((value) => {
            document.cookie = `analytics=${value}; Path=/; Max-Age=86400; SameSite=Lax`;
            window.KismetConsent.update({ analytics: value === 'granted', advertising: false });
            // Exercise the closed gate in the same task, before the bridge reloads.
            if (value === 'denied') window.Kismet.track('must-not-send');
        }, value),
    ]);
    await currentPage.waitForFunction(() => window.fixtureReady);
};
const waitVid = async () => {
    await page().waitForFunction(() => /(?:^|;\s*)_kid_vid=vid_[a-f0-9]{64}/.test(document.cookie));
    return cookies();
};
const check = async (name, fn) => {
    await fn();
    checks.push({ name, passed: true });
    console.log(`PASS ${name}`);
};
try {
    context = await launch();
    const accountSid = 'kid_' + randomBytes(4).toString('hex');
    await context.addCookies([
        {
            name: '_kid_sid',
            value: accountSid,
            url: origin,
            expires: Math.floor(Date.now() / 1000) + 86400,
        },
    ]);
    await check('denied page retains account carrier and emits no analytics identity', async () => {
        await visit();
        assert.equal((await cookies())._kid_sid, accountSid);
        assert.equal((await cookies())._kid_vid, undefined);
        assert.equal(clientEvents.length, 0);
        assert.ok(
            (await state()).events
                .slice(initialEventCount)
                .every((e) => e.body.clientSessionId === null)
        );
    });
    let first, second;
    await check('grant adopts account SID and issues authority-backed VID', async () => {
        await choice('granted');
        await visit();
        first = await waitVid();
        assert.equal(first._kid_sid, accountSid);
        assert.match(first._kid_vid, /^vid_[a-f0-9]{64}$/);
        await page().waitForFunction(() => !!window.Kismet?._config);
        await page().evaluate(() => window.Kismet.track('recognition-validation'));
        await page().waitForTimeout(100);
        assert.ok(clientEvents.some((body) => body?.includes(accountSid)));
    });
    await check('browser restart keeps the visitor token', async () => {
        await context.close();
        context = await launch();
        assert.equal((await cookies())._kid_vid, first._kid_vid);
    });
    await check('new SID joins the same stored visitor after SID-only loss', async () => {
        await context.clearCookies({ name: '_kid_sid' });
        await visit();
        second = await waitVid();
        assert.notEqual(second._kid_sid, first._kid_sid);
        assert.equal(second._kid_vid, first._kid_vid);
        const links = (await state()).links;
        const oldVisitor = links.find((link) => link.session_id === first._kid_sid)?.visitor_id;
        const newVisitor = links.find((link) => link.session_id === second._kid_sid)?.visitor_id;
        assert.ok(oldVisitor && newVisitor);
        assert.equal(newVisitor, oldVisitor);
    });
    await check(
        'withdrawal immediately removes VID, stops client events and preserves SID',
        async () => {
            await page().waitForFunction(() => !!window.Kismet?._config);
            await page().waitForTimeout(100);
            const count = clientEvents.length;
            await choice('denied');
            assert.equal((await cookies())._kid_vid, undefined);
            assert.equal((await cookies())._kid_sid, second._kid_sid);
            await page().waitForTimeout(100);
            assert.equal(clientEvents.length, count);
            await visit();
            assert.equal((await cookies())._kid_sid, second._kid_sid);
            assert.equal((await cookies())._kid_vid, undefined);
            const linksBefore = (await state()).links.length;
            await page().evaluate(() =>
                fetch('/__kismet/visitor', { headers: { 'x-kismet-visitor': '1' } })
            );
            assert.equal((await state()).links.length, linksBefore);
            assert.equal((await cookies())._kid_sid, second._kid_sid);
        }
    );
    await check('renewed grant is required before recognition resumes', async () => {
        await choice('granted');
        await visit();
        const renewed = await waitVid();
        assert.equal(renewed._kid_sid, second._kid_sid);
        assert.notEqual(
            renewed._kid_vid,
            first._kid_vid,
            'withdrawn token is not silently restored'
        );
    });
    await check('independent browser receives a distinct stored visitor', async () => {
        await context.close();
        context = await launch(mkdtempSync(join(tmpdir(), 'kismet-visitor-independent-')));
        await context.addCookies([{ name: 'analytics', value: 'granted', url: origin }]);
        await visit();
        const third = await waitVid();
        assert.notEqual(third._kid_vid, first._kid_vid);
        const links = (await state()).links;
        assert.notEqual(
            links.find((x) => x.session_id === third._kid_sid)?.visitor_id,
            links.find((x) => x.session_id === first._kid_sid)?.visitor_id
        );
    });
    await check('authority outage leaves the page and existing session usable', async () => {
        await fetch(`${lab}/lab/outage`, { method: 'POST', body: '{"enabled":true}' });
        const before = (await cookies())._kid_sid;
        await visit();
        assert.equal((await cookies())._kid_sid, before);
        await fetch(`${lab}/lab/outage`, { method: 'POST', body: '{"enabled":false}' });
    });
    assert.deepEqual(errors, []);
} finally {
    if (process.env.VISITOR_RESULTS_PATH)
        writeFileSync(
            process.env.VISITOR_RESULTS_PATH,
            JSON.stringify(
                {
                    checks,
                    errors,
                    backend:
                        'real recognition store, disposable PostgreSQL; local HTTP and receiver fixtures',
                    tracker: manifest.sha256,
                    bridge: manifest.consent.sha256,
                },
                null,
                2
            )
        );
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
}
