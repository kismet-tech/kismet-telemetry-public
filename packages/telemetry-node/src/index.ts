// @kismet-tech/telemetry-node: the Node server adapter over @kismet-tech/telemetry.
//
// kismetTelemetry(config) returns an Express or Connect middleware (req, res, next)
// that does the whole contract on every page request: resolve the visitor
// (threaded, cookie, suppressed, cold with a local mint and an after-response
// reconcile), emit the server-plane event, set the first-party cookies on the
// dotted serving domain, mark the response private, and leave the seed on
// `req.kismet` and `res.locals.kismet` for the template. It works on the raw
// node:http request and response, so Fastify (`req.raw`, `reply.raw`), Koa
// (`ctx.req`, `ctx.res`) and a plain `createServer` handler use it too.
//
// resolveKismetRequest(config) is the same decision as a function of a web
// `Request`, for frameworks that speak Request and Response (Hono, Workers,
// Deno) and want to apply the headers themselves.

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
    buildCookie,
    classifyRequest,
    cookieDomainFor,
    DEFAULT_KJS_URL,
    fireContentEvent,
    isHttps,
    normalizeServingDomain,
    postBookingBridge,
    postQuoteCapture,
    publicUrl,
    readCountry,
    renderSeedScript,
    resolveVisitor,
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

export const CONTRACT_VERSION = '1.0';

export interface KismetTelemetryConfig {
    /** The collection this site's pages belong to. */
    collectionSlug: string;
    /** The collection's `ctk_` tracking key. Server-side only; read it from the environment. */
    trackingKey: string;
    /** Which URLs are properties, search, the checkout path, agent surfaces. */
    profile?: RouteProfile;
    /**
     * The site's consent decision. Without it the country default applies, which
     * reads a Cloudflare or Vercel country header; a Node server behind Apache or
     * nginx has neither, so the default would set cookies for everyone. Wire your
     * consent manager here (`consentFromCookie` covers the common case).
     */
    consent?: ConsentHook | null;
    /** Override the dotted-domain rule, e.g. '.example.com' for a deeper serving host. */
    cookieDomain?: string | null;
    /** Ask the authority before responding on a cold visit (1.5 s cap). Off by default. */
    authorityFirst?: boolean;
    /** Suppress generic clients (curl, headless browsers) as well as the bot vocabulary. Default true. */
    suppressGenericClients?: boolean;
    /**
     * Your own country source when the platform sets one under a different header
     * (a GeoIP module, a load balancer). Return null when unknown. Default reads
     * `cf-ipcountry` then `x-vercel-ip-country`.
     */
    country?: (headers: Headers) => string | null | undefined;
    /** Overrides for lab and staging. */
    endpoints?: { resolveAnchor?: string; track?: string; apiOrigin?: string; kjs?: string };
}

export interface KismetVisitor extends ResolveResult {
    /** What the request was classified as by the route profile. */
    classification: Classification;
}

/** What the middleware leaves on `req.kismet` and `res.locals.kismet`. */
export interface KismetRequestState {
    kidSid: string | null;
    kidVid: string | null;
    suppressed: boolean;
    isBot: boolean;
    tier: string;
    classification: Classification;
    /**
     * One inline `<script>` for `<head>`: the seed assignment, then the k.js tag
     * appended by the script itself. Empty when there is nothing to seed. Print it
     * verbatim before any other script in the head.
     */
    seed: string;
}

export type KismetDecision =
    | { kind: 'excluded' }
    | { kind: 'agent' }
    | {
          kind: 'page';
          visitor: KismetVisitor;
          state: KismetRequestState;
          /** Response headers to set: cache-control, the tier header. */
          headers: Record<string, string>;
          /** Set-Cookie lines to append, zero to two. */
          setCookies: string[];
      };

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
 * The seed as one inline script: the assignment, then the k.js tag appended by
 * the script itself, so no template engine or renderer can reorder them
 * (contract section 7). Empty when there is neither an id nor a suppression.
 */
export function kismetSeedHtml(
    input: { kidSid: string | null; suppressed: boolean },
    collectionSlug: string,
    kjsUrl?: string
): string {
    const seed = renderSeedScript({ kidSid: input.kidSid, suppressed: input.suppressed });
    if (!seed) return '';
    const assignment = seed.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const src = `${kjsUrl || DEFAULT_KJS_URL}?c=${encodeURIComponent(collectionSlug)}`;
    return (
        '<script>' +
        assignment +
        `(function(){var s=document.createElement('script');s.async=true;s.src=${JSON.stringify(src)};` +
        `(document.head||document.documentElement).appendChild(s);})();` +
        '</script>'
    );
}

/**
 * The contract as a function of a web `Request`. Returns what to do with the
 * response; applies nothing itself. `flush()` awaits the background work
 * (reconcile, events), for tests and for graceful shutdown.
 */
export function createKismetResolver(cfg: KismetTelemetryConfig) {
    if (!cfg.collectionSlug)
        throw new Error('@kismet-tech/telemetry-node: collectionSlug is required');
    if (!cfg.trackingKey) {
        console.warn(
            '[kismet-telemetry] trackingKey is empty: sessions resolve locally, nothing is sent to Kismet'
        );
    }
    let pending: Promise<unknown>[] = [];
    const ctx = {
        waitUntil(p: Promise<unknown>) {
            const tracked = Promise.resolve(p).catch(() => undefined);
            pending.push(tracked);
            void tracked.then(() => {
                pending = pending.filter((x) => x !== tracked);
            });
        },
    };
    const env = eventEnv(cfg);

    async function resolve(request: Request): Promise<KismetDecision> {
        const headers = request.headers;
        const url = publicUrl(headers, new URL(request.url));
        const classification = classifyRequest(url, cfg.profile, {
            accept: headers.get('accept'),
            method: request.method,
        });
        if (classification.kind === 'excluded') return { kind: 'excluded' };

        const country = cfg.country ? (cfg.country(headers) ?? null) : readCountry(headers);
        const common = {
            pageUrl: url.toString(),
            domain: normalizeServingDomain(url.host),
            collectionSlug: cfg.collectionSlug,
            userAgent: headers.get('user-agent'),
            clientIp: visitorIp(headers),
            country,
            referrer: headers.get('referer'),
        };

        if (classification.kind === 'agent') {
            fireContentEvent(ctx, env, {
                ...common,
                vrSlug: null,
                clientSessionId: null,
                agentFetch: true,
            });
            return { kind: 'agent' };
        }

        const resolved = await resolveVisitor({
            url,
            headers,
            collectionSlug: cfg.collectionSlug,
            trackingKey: cfg.trackingKey,
            consent: cfg.consent ?? null,
            country,
            authorityFirst: cfg.authorityFirst,
            suppressGenericClients: cfg.suppressGenericClients,
            resolveEndpoint: cfg.endpoints?.resolveAnchor ?? null,
            apiOrigin: cfg.endpoints?.apiOrigin ?? null,
            waitUntil: ctx.waitUntil,
        });
        const visitor: KismetVisitor = { ...resolved, classification };

        fireContentEvent(ctx, env, {
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

        const state: KismetRequestState = {
            kidSid: visitor.kidSid,
            kidVid: visitor.kidVid,
            suppressed: visitor.suppressed,
            isBot: visitor.isBot,
            tier: visitor.tier,
            classification,
            seed: kismetSeedHtml(visitor, cfg.collectionSlug, cfg.endpoints?.kjs),
        };

        // A response that carries a per-visitor seed must never be cached by a shared cache.
        const outHeaders: Record<string, string> = {
            'cache-control': 'private, no-store',
            [SEED_HEADERS.tier]: visitor.tier,
        };
        const domain = cookieDomainFor(url.host, cfg.cookieDomain ?? null);
        const secure = isHttps(headers, url);
        const setCookies: string[] = [];
        if (visitor.kidSid && visitor.setSid) {
            setCookies.push(
                buildCookie(SID_COOKIE, visitor.kidSid, { maxAge: SID_MAX_AGE, domain, secure })
            );
        }
        if (visitor.kidVid && visitor.setVid) {
            setCookies.push(
                buildCookie(VID_COOKIE, visitor.kidVid, { maxAge: VID_MAX_AGE, domain, secure })
            );
        }
        return { kind: 'page', visitor, state, headers: outHeaders, setCookies };
    }

    async function flush(): Promise<void> {
        while (pending.length) {
            const p = pending;
            pending = [];
            await Promise.allSettled(p);
        }
    }

    return { resolve, flush };
}

/** The request the middleware accepts: node:http, Express, Connect, Fastify raw, Koa raw. */
export type NodeRequest = IncomingMessage & {
    originalUrl?: string;
    kismet?: KismetRequestState;
};
export type NodeResponse = ServerResponse & { locals?: Record<string, unknown> };
export type NextFunction = (err?: unknown) => void;

/** Build a web `Request` from a Node request, with the public URL rebuilt from forwarded headers. */
export function toWebRequest(req: NodeRequest): Request {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const socket = req.socket as { encrypted?: boolean } | undefined;
    const scheme = socket?.encrypted ? 'https' : 'http';
    const host = headers.get('host') || 'localhost';
    const path = req.originalUrl || req.url || '/';
    return new Request(new URL(path, `${scheme}://${host}`), {
        method: req.method || 'GET',
        headers,
    });
}

/** Apply a page decision to a Node response and stash the state on the request. */
export function applyKismetDecision(
    req: NodeRequest,
    res: NodeResponse,
    decision: KismetDecision
): void {
    if (decision.kind !== 'page') return;
    req.kismet = decision.state;
    if (res.locals && typeof res.locals === 'object') res.locals.kismet = decision.state;
    for (const [name, value] of Object.entries(decision.headers)) res.setHeader(name, value);
    if (decision.setCookies.length) {
        const prev = res.getHeader('set-cookie');
        const existing = Array.isArray(prev) ? prev : typeof prev === 'string' ? [prev] : [];
        res.setHeader('Set-Cookie', [...existing, ...decision.setCookies]);
    }
}

export interface KismetMiddleware {
    (req: NodeRequest, res: NodeResponse, next: NextFunction): void;
    /** Await background work (reconcile, events). For tests and graceful shutdown. */
    flush(): Promise<void>;
    /** The decision as a function of a web Request, for frameworks that apply headers themselves. */
    resolve(request: Request): Promise<KismetDecision>;
}

/**
 * Build the middleware. `app.use(kismetTelemetry(config))` before your routes;
 * then print `res.locals.kismet.seed` (or `req.kismet.seed`) in `<head>`.
 */
export function kismetTelemetry(cfg: KismetTelemetryConfig): KismetMiddleware {
    const resolver = createKismetResolver(cfg);
    const middleware = function kismetTelemetryMiddleware(
        req: NodeRequest,
        res: NodeResponse,
        next: NextFunction
    ): void {
        let request: Request;
        try {
            request = toWebRequest(req);
        } catch (err) {
            warn(err);
            next();
            return;
        }
        resolver.resolve(request).then(
            (decision) => {
                try {
                    applyKismetDecision(req, res, decision);
                } catch (err) {
                    warn(err);
                }
                next();
            },
            (err) => {
                // The page is always served. Telemetry degrades to "nothing on this request".
                warn(err);
                next();
            }
        );
    } as KismetMiddleware;
    middleware.flush = resolver.flush;
    middleware.resolve = resolver.resolve;
    return middleware;
}

function warn(err: unknown): void {
    console.warn(
        '[kismet-telemetry] middleware error, serving without telemetry:',
        err instanceof Error ? err.message : err
    );
}

/** Read the state the middleware attached, from a route handler or template helper. */
export function readKismetState(req: NodeRequest): KismetRequestState | null {
    return req.kismet ?? null;
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
