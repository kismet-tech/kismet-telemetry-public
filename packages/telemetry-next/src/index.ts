// @kismet-tech/telemetry-next: the Next.js adapter over @kismet-tech/telemetry.
//
// createKismetMiddleware(config) returns a Next middleware that does the whole
// contract on every page request: resolve the visitor (threaded, cookie,
// suppressed, cold with a local mint and an after-response reconcile), emit the
// server-plane event, set the first-party cookies on the dotted serving domain,
// mark the response private, and hand the seed to the render layer through
// request headers. The root layout renders <KismetSeed /> (from ./seed).
//
// Edge-runtime safe: web-platform APIs only. No node: imports.

import {
    buildCookie,
    classifyRequest,
    cookieDomainFor,
    fireContentEvent,
    isHttps,
    normalizeServingDomain,
    postBookingBridge,
    postQuoteCapture,
    publicUrl,
    readCountry,
    resolveVisitor,
    resolveVisitorCookie,
    SEED_HEADERS,
    SID_COOKIE,
    SID_MAX_AGE,
    VID_COOKIE,
    VID_MAX_AGE,
    visitorIp,
} from '@kismet-tech/telemetry';
import type {
    BookingBridgeBody,
    Classification,
    ConsentHook,
    ConversionResult,
    QuoteCaptureBody,
    ResolveResult,
    RouteProfile,
} from '@kismet-tech/telemetry';
import { NextResponse } from 'next/server.js';
import type { NextFetchEvent, NextRequest } from 'next/server.js';

export const CONTRACT_VERSION = '1.0';

/**
 * The matcher to export from middleware.ts. Pages and the two agent index files;
 * never assets, never your own API routes.
 */
export const KISMET_MATCHER = [
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|css|js|map|txt|xml|json|woff2?)$).*)',
    '/llms.txt',
    '/.well-known/llm-index.json',
];

export interface KismetTelemetryConfig {
    /** The collection this site's pages belong to. */
    collectionSlug: string;
    /** Enable the same-origin visitor-cookie follow-up. Requires a consent hook. */
    visitorRecognition?: boolean;
    /** The collection's `ctk_` tracking key. Server-side only; read it from the environment. */
    trackingKey: string;
    /** Which URLs are properties, search, the checkout path, agent surfaces. */
    profile?: RouteProfile;
    /**
     * The site's consent decision. Without it the country default applies, which
     * off Cloudflare and Vercel sets cookies for everyone. Wire your consent
     * manager here (`consentFromCookie` covers the common case).
     */
    consent?: ConsentHook | null;
    /** Override the dotted-domain rule, e.g. '.example.com' for a deeper serving host. */
    cookieDomain?: string | null;
    /** Ask the authority before responding on a cold visit (1.5 s cap). Off by default. */
    authorityFirst?: boolean;
    /** Suppress generic clients (curl, headless browsers) as well as the bot vocabulary. Default true. */
    suppressGenericClients?: boolean;
    /** Overrides for lab and staging. */
    endpoints?: { resolveAnchor?: string; track?: string; apiOrigin?: string };
    /**
     * Your own middleware, run after telemetry resolves the visitor. Return the
     * response you want; telemetry adds its cookies and headers to it. Default is
     * `NextResponse.next()` with the seed headers on the request.
     */
    next?: (
        request: NextRequest,
        event: NextFetchEvent,
        visitor: KismetVisitor
    ) => NextResponse | Promise<NextResponse>;
}

export interface KismetVisitor extends ResolveResult {
    /** What the request was classified as by the route profile. */
    classification: Classification;
}

function eventEnv(cfg: KismetTelemetryConfig) {
    return {
        COLLECTION_KEY: cfg.trackingKey,
        ...(cfg.endpoints?.track ? { TRACKING_ENDPOINT: cfg.endpoints.track } : {}),
    };
}

function apiEnv(cfg: KismetTelemetryConfig) {
    return {
        COLLECTION_KEY: cfg.trackingKey,
        ...(cfg.endpoints?.apiOrigin ? { KISMET_API_ORIGIN: cfg.endpoints.apiOrigin } : {}),
    };
}

/**
 * Build the Next middleware. Export its return value as `middleware` and
 * `KISMET_MATCHER` as `config.matcher` in middleware.ts.
 */
export function createKismetMiddleware(cfg: KismetTelemetryConfig) {
    if (!cfg.collectionSlug)
        throw new Error('@kismet-tech/telemetry-next: collectionSlug is required');
    if (!cfg.trackingKey) {
        console.warn(
            '[kismet-telemetry] trackingKey is empty: sessions resolve locally, nothing is sent to Kismet'
        );
    }

    return async function kismetMiddleware(
        request: NextRequest,
        event: NextFetchEvent
    ): Promise<NextResponse> {
        try {
            const headers = request.headers;
            const url = publicUrl(headers, request.nextUrl);
            if (request.nextUrl.pathname === '/__kismet/visitor') {
                const noStore = { 'cache-control': 'private, no-store' };
                if (!cfg.visitorRecognition)
                    return new NextResponse(null, { status: 404, headers: noStore });
                if (
                    request.method !== 'GET' ||
                    headers.get('x-kismet-visitor') !== '1' ||
                    (headers.get('origin') && headers.get('origin') !== url.origin) ||
                    (headers.get('sec-fetch-site') &&
                        headers.get('sec-fetch-site') !== 'same-origin')
                ) {
                    return new NextResponse(null, { status: 403, headers: noStore });
                }
                const visitor = await resolveVisitorCookie({
                    url,
                    headers,
                    collectionSlug: cfg.collectionSlug,
                    trackingKey: cfg.trackingKey,
                    consent: cfg.consent,
                    suppressGenericClients: cfg.suppressGenericClients,
                    resolveEndpoint: cfg.endpoints?.resolveAnchor,
                    apiOrigin: cfg.endpoints?.apiOrigin,
                });
                const response = NextResponse.json({ ok: true }, { headers: noStore });
                const domain = cookieDomainFor(url.host, cfg.cookieDomain ?? null);
                const secure = isHttps(headers, url);
                if (visitor.kidSid && visitor.setSid)
                    response.headers.append(
                        'set-cookie',
                        buildCookie(SID_COOKIE, visitor.kidSid, {
                            maxAge: SID_MAX_AGE,
                            domain,
                            secure,
                        })
                    );
                if (visitor.kidVid && visitor.setVid)
                    response.headers.append(
                        'set-cookie',
                        buildCookie(VID_COOKIE, visitor.kidVid, {
                            maxAge: VID_MAX_AGE,
                            domain,
                            secure,
                        })
                    );
                if (visitor.suppressed) {
                    response.headers.append(
                        'set-cookie',
                        buildCookie(VID_COOKIE, '', { maxAge: 0, domain, secure })
                    );
                    response.headers.append(
                        'set-cookie',
                        buildCookie(SID_COOKIE, '', { maxAge: 0, domain, secure })
                    );
                }
                return response;
            }
            const classification = classifyRequest(url, cfg.profile, {
                accept: headers.get('accept'),
                method: request.method,
            });

            if (classification.kind === 'excluded') return NextResponse.next();

            const env = eventEnv(cfg);
            const common = {
                pageUrl: url.toString(),
                domain: normalizeServingDomain(url.host),
                collectionSlug: cfg.collectionSlug,
                userAgent: headers.get('user-agent'),
                clientIp: visitorIp(headers),
                country: readCountry(headers),
                referrer: headers.get('referer'),
            };

            if (classification.kind === 'agent') {
                fireContentEvent(event, env, {
                    ...common,
                    vrSlug: null,
                    clientSessionId: null,
                    agentFetch: true,
                });
                return NextResponse.next();
            }

            const resolved = await resolveVisitor({
                url,
                headers,
                collectionSlug: cfg.collectionSlug,
                trackingKey: cfg.trackingKey,
                consent: cfg.consent ?? null,
                authorityFirst: cfg.authorityFirst,
                suppressGenericClients: cfg.suppressGenericClients,
                resolveEndpoint: cfg.endpoints?.resolveAnchor ?? null,
                apiOrigin: cfg.endpoints?.apiOrigin ?? null,
                waitUntil: (p) => event.waitUntil(p),
            });
            const visitor: KismetVisitor = { ...resolved, classification };

            fireContentEvent(event, env, {
                ...common,
                vrSlug: classification.vrSlug,
                ...(classification.externalListingId
                    ? { externalListingId: classification.externalListingId }
                    : {}),
                clientSessionId: visitor.isBot ? null : visitor.kidSid,
                ctaIntent: classification.kind === 'intent',
                stayCheckIn: classification.stayCheckIn,
                stayCheckOut: classification.stayCheckOut,
                guestCount: classification.guestCount,
                promoCode: classification.promoCode,
            });

            // The seed reaches the layout as request headers.
            const requestHeaders = new Headers(headers);
            requestHeaders.delete(SEED_HEADERS.kidSid);
            requestHeaders.delete(SEED_HEADERS.suppressed);
            requestHeaders.delete('x-kismet-visitor-recognition');
            if (cfg.visitorRecognition)
                requestHeaders.set(
                    'x-kismet-visitor-recognition',
                    `${request.nextUrl.basePath || ''}/__kismet/visitor`
                );
            if (visitor.kidSid) requestHeaders.set(SEED_HEADERS.kidSid, visitor.kidSid);
            if (visitor.suppressed) requestHeaders.set(SEED_HEADERS.suppressed, '1');
            requestHeaders.set(SEED_HEADERS.tier, visitor.tier);

            let response: NextResponse;
            if (cfg.next) {
                const patched = new Request(request.url, {
                    headers: requestHeaders,
                    method: request.method,
                });
                response = await cfg.next(
                    Object.assign(request, { headers: patched.headers }) as NextRequest,
                    event,
                    visitor
                );
            } else {
                response = NextResponse.next({ request: { headers: requestHeaders } });
            }

            // A response that carries a per-visitor seed must never be cached by a shared cache.
            response.headers.set('cache-control', 'private, no-store');
            response.headers.set(SEED_HEADERS.tier, visitor.tier);

            const domain = cookieDomainFor(url.host, cfg.cookieDomain ?? null);
            const secure = isHttps(headers, url);
            if (visitor.kidSid && visitor.setSid) {
                response.headers.append(
                    'set-cookie',
                    buildCookie(SID_COOKIE, visitor.kidSid, { maxAge: SID_MAX_AGE, domain, secure })
                );
            }
            if (visitor.kidVid && visitor.setVid) {
                response.headers.append(
                    'set-cookie',
                    buildCookie(VID_COOKIE, visitor.kidVid, { maxAge: VID_MAX_AGE, domain, secure })
                );
            }
            if (cfg.visitorRecognition && visitor.suppressed) {
                response.headers.append(
                    'set-cookie',
                    buildCookie(VID_COOKIE, '', { maxAge: 0, domain, secure })
                );
                response.headers.append(
                    'set-cookie',
                    buildCookie(SID_COOKIE, '', { maxAge: 0, domain, secure })
                );
            }
            return response;
        } catch (err) {
            // The page is always served. Telemetry degrades to "nothing on this request".
            console.warn(
                '[kismet-telemetry] middleware error, serving without telemetry:',
                err instanceof Error ? err.message : err
            );
            return NextResponse.next();
        }
    };
}

/**
 * Read the seed the middleware attached, from a server component or route handler.
 * Pass `await headers()` (next/headers) or any Headers-like.
 */
export function readKismetSeed(headers: { get(name: string): string | null }): {
    kidSid: string | null;
    suppressed: boolean;
    tier: string | null;
} {
    return {
        kidSid: headers.get(SEED_HEADERS.kidSid),
        suppressed: headers.get(SEED_HEADERS.suppressed) === '1',
        tier: headers.get(SEED_HEADERS.tier),
    };
}

/**
 * A render-time server event for a property page whose identifier is only
 * known at render (the middleware saw a slug-only URL). Call it from the page's
 * server component with the seed headers and the listing id; pass the returned
 * promise to Next's `after()` or let it float. Adds `property_view` (or
 * `cta_click` when `intent` is set) with the stay, under the visitor's session.
 */
export function trackServerPropertyView(
    cfg: KismetTelemetryConfig,
    input: {
        headers: { get(name: string): string | null };
        url: string | URL;
        externalListingId?: string | null;
        vrSlug?: string | null;
        checkIn?: string | null;
        checkOut?: string | null;
        guests?: number | null;
        intent?: boolean;
    }
): Promise<void> {
    const seed = readKismetSeed(input.headers);
    const url = typeof input.url === 'string' ? new URL(input.url) : input.url;
    return new Promise((resolve) => {
        fireContentEvent(
            {
                waitUntil: (p: Promise<unknown>) =>
                    void p.then(
                        () => resolve(),
                        () => resolve()
                    ),
            },
            eventEnv(cfg),
            {
                pageUrl: url.toString(),
                domain: normalizeServingDomain(url.host),
                collectionSlug: cfg.collectionSlug,
                vrSlug: input.vrSlug ?? null,
                ...(input.externalListingId ? { externalListingId: input.externalListingId } : {}),
                userAgent: input.headers.get('user-agent'),
                clientIp: visitorIp(input.headers),
                country: readCountry(input.headers),
                referrer: input.headers.get('referer'),
                clientSessionId: seed.suppressed ? null : seed.kidSid,
                ctaIntent: input.intent === true,
                stayCheckIn: input.checkIn ?? null,
                stayCheckOut: input.checkOut ?? null,
                guestCount: input.guests ?? null,
            }
        );
    });
}

/** The conversion join, from the server code that knows the booking succeeded. */
export function bookingBridge(
    cfg: KismetTelemetryConfig,
    body: BookingBridgeBody
): Promise<ConversionResult> {
    return postBookingBridge(apiEnv(cfg), body);
}

/** A quote the guest saw, for the fallback match on property and dates. */
export function quoteCapture(
    cfg: KismetTelemetryConfig,
    body: QuoteCaptureBody
): Promise<ConversionResult> {
    return postQuoteCapture(apiEnv(cfg), { collectionSlug: cfg.collectionSlug, ...body });
}

export { consentFromCookie, countryAllowsCookies, SEED_HEADERS } from '@kismet-tech/telemetry';
export type {
    RouteProfile,
    ConsentHook,
    Classification,
    BookingBridgeBody,
    QuoteCaptureBody,
    ConversionResult,
} from '@kismet-tech/telemetry';
