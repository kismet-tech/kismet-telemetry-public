// ── The reference adapter ───────────────────────────────────────────────────
//
// The smallest complete adapter: a fetch handler (Request → Response) built only
// on the core. It exists for three reasons: it proves the core against its own
// conformance suite, it is the base the framework adapters wrap (Next middleware
// is this plus NextResponse plumbing), and it is the worked example on the
// "wire it yourself" docs page. Web-platform APIs only.

import { fireContentEvent, normalizeServingDomain } from '../content-event.js';
import {
    buildCookie,
    cookieDomainFor,
    isHttps,
    publicUrl,
    SID_COOKIE,
    SID_MAX_AGE,
    VID_COOKIE,
    VID_MAX_AGE,
} from '../cookies.js';
import { classifyRequest } from '../route-profile.js';
import { readCountry } from '../consent.js';
import { resolveVisitor, visitorIp } from '../resolve.js';
import { renderSeed, SEED_HEADERS } from '../seed.js';

/**
 * @typedef {object} ReferenceAdapterConfig
 * @property {string} collectionSlug
 * @property {string} trackingKey
 * @property {import('../route-profile.js').RouteProfile} [profile]
 * @property {import('../consent.js').ConsentHook | null} [consent]
 * @property {string | null} [cookieDomain] Override the dotted-domain rule.
 * @property {string} [resolveEndpoint] Authority URL override (the suite passes its stub).
 * @property {string} [trackingEndpoint] Relay URL override (the suite passes its stub).
 * @property {boolean} [authorityFirst]
 * @property {(ctx: { seed: string, kind: string, path: string }) => string} [renderPage] Page HTML; default a minimal document.
 */

/**
 * @param {ReferenceAdapterConfig} config
 */
export function createReferenceAdapter(config) {
    /** @type {Promise<unknown>[]} */
    let pending = [];
    /** @type {{ waitUntil(p: Promise<unknown>): void }} */
    const ctx = {
        waitUntil(p) {
            pending.push(p.catch(() => undefined));
        },
    };
    const env = {
        COLLECTION_KEY: config.trackingKey,
        ...(config.trackingEndpoint ? { TRACKING_ENDPOINT: config.trackingEndpoint } : {}),
    };
    const renderPage =
        config.renderPage ||
        ((c) =>
            `<!doctype html><html><head>${c.seed}<title>${c.kind}</title></head><body><main data-kind="${c.kind}">${c.path}</main></body></html>`);

    /**
     * @param {Request} request
     * @returns {Promise<Response>}
     */
    async function handle(request) {
        const headers = request.headers;
        const url = publicUrl(headers, new URL(request.url));
        const cls = classifyRequest(url, config.profile, {
            accept: headers.get('accept'),
            method: request.method,
        });
        const ua = headers.get('user-agent');
        const common = {
            pageUrl: url.toString(),
            domain: normalizeServingDomain(url.host),
            collectionSlug: config.collectionSlug,
            userAgent: ua,
            clientIp: visitorIp(headers),
            country: readCountry(headers),
            referrer: headers.get('referer'),
        };

        if (cls.kind === 'excluded') {
            return new Response('', { status: 204 });
        }

        if (cls.kind === 'agent') {
            fireContentEvent(ctx, env, {
                ...common,
                vrSlug: null,
                clientSessionId: null,
                agentFetch: true,
            });
            return new Response(`# ${url.pathname}\n`, {
                status: 200,
                headers: {
                    'content-type': 'text/markdown; charset=utf-8',
                    'cache-control': 'public, max-age=300',
                },
            });
        }

        const visitor = await resolveVisitor({
            url,
            headers,
            collectionSlug: config.collectionSlug,
            trackingKey: config.trackingKey,
            consent: config.consent ?? null,
            authorityFirst: config.authorityFirst,
            resolveEndpoint: config.resolveEndpoint ?? null,
            waitUntil: ctx.waitUntil,
        });

        fireContentEvent(ctx, env, {
            ...common,
            vrSlug: cls.vrSlug,
            ...(cls.externalListingId ? { externalListingId: cls.externalListingId } : {}),
            clientSessionId: visitor.isBot ? null : visitor.kidSid,
            ctaIntent: cls.kind === 'intent',
            stayCheckIn: cls.stayCheckIn,
            stayCheckOut: cls.stayCheckOut,
            guestCount: cls.guestCount,
            promoCode: cls.promoCode,
        });

        const seed = renderSeed({
            kidSid: visitor.kidSid,
            suppressed: visitor.suppressed,
            collectionSlug: config.collectionSlug,
        });
        const html = renderPage({ seed, kind: cls.kind, path: url.pathname });
        const out = new Headers({
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'private, no-store',
            [SEED_HEADERS.tier]: visitor.tier,
        });
        if (visitor.kidSid) out.set(SEED_HEADERS.kidSid, visitor.kidSid);
        if (visitor.suppressed) out.set(SEED_HEADERS.suppressed, '1');
        const domain = cookieDomainFor(url.host, config.cookieDomain ?? null);
        const secure = isHttps(headers, url);
        if (visitor.kidSid && visitor.setSid) {
            out.append(
                'set-cookie',
                buildCookie(SID_COOKIE, visitor.kidSid, { maxAge: SID_MAX_AGE, domain, secure })
            );
        }
        if (visitor.kidVid && visitor.setVid) {
            out.append(
                'set-cookie',
                buildCookie(VID_COOKIE, visitor.kidVid, { maxAge: VID_MAX_AGE, domain, secure })
            );
        }
        return new Response(html, { status: 200, headers: out });
    }

    async function flush() {
        const p = pending;
        pending = [];
        await Promise.allSettled(p);
    }

    return { handle, flush };
}
