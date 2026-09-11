// <KismetSeed />: the page seed and the k.js tag for the App Router root layout.
//
//   import { KismetSeed } from '@kismet-tech/telemetry-next/seed';
//   <head><KismetSeed collectionSlug={process.env.KISMET_COLLECTION_SLUG!} /></head>
//
// Reads the headers the middleware attached (next/headers), so the layout
// becomes dynamic, which is what a seeded page must be: never statically cached.
// `KismetSeedScripts` is the pure half for tests and for frameworks that already
// hold the values.
//
// Why ONE inline script: React 19 hoists <script async src> elements ahead of
// other head content, so a separate k.js tag would render BEFORE the seed and
// break the contract's load-bearing order (section 7). The inline script sets the
// seed and then injects the k.js tag itself, the same pattern the WordPress
// plugin's bootstrap uses, which no renderer can reorder. k.js's own
// double-load guard is untouched; the anchor never sets a reserved global.

import { DEFAULT_KJS_URL, renderSeedScript, SEED_HEADERS } from '@kismet-tech/telemetry';
import { headers } from 'next/headers.js';
import type { JSX } from 'react';

export interface KismetSeedScriptsProps {
    collectionSlug: string;
    kidSid: string | null;
    suppressed: boolean;
    kjsUrl?: string;
    visitorRecognition?: boolean;
    visitorEndpoint?: string;
}

/**
 * The inline code: the seed assignment, then a k.js tag appended to <head>.
 * Exported so other React renderers can reuse it.
 */
export function kismetSeedInline({
    collectionSlug,
    kidSid,
    suppressed,
    kjsUrl,
    visitorRecognition,
    visitorEndpoint = '/__kismet/visitor',
}: KismetSeedScriptsProps): string {
    const seed = renderSeedScript({ kidSid, suppressed });
    if (!seed) return '';
    const assignment = seed.replace(/^<script>/, '').replace(/<\/script>$/, '');
    if (suppressed) return assignment;
    const src = `${kjsUrl || DEFAULT_KJS_URL}?c=${encodeURIComponent(collectionSlug)}`;
    return (
        assignment +
        (visitorRecognition && /^\/(?!\/)[A-Za-z0-9/_-]+$/.test(visitorEndpoint)
            ? `(function(){fetch(${JSON.stringify(visitorEndpoint).replace(/</g, '\\u003c')},{credentials:'same-origin',cache:'no-store',headers:{'x-kismet-visitor':'1'}}).catch(function(){});})();`
            : '') +
        `(function(){var s=document.createElement('script');s.async=true;s.src=${JSON.stringify(src)};` +
        `(document.head||document.documentElement).appendChild(s);})();`
    );
}

/** Pure: one inline script (seed, then the k.js tag), or nothing when there is neither id nor suppression. */
export function KismetSeedScripts(props: KismetSeedScriptsProps): JSX.Element | null {
    const inline = kismetSeedInline(props);
    if (!inline) return null;
    return <script dangerouslySetInnerHTML={{ __html: inline }} />;
}

/** Server component: reads the middleware's headers and renders the script. */
export async function KismetSeed({
    collectionSlug,
    kjsUrl,
}: {
    collectionSlug: string;
    kjsUrl?: string;
}): Promise<JSX.Element | null> {
    const h = await headers();
    return (
        <KismetSeedScripts
            collectionSlug={collectionSlug}
            kidSid={h.get(SEED_HEADERS.kidSid)}
            suppressed={h.get(SEED_HEADERS.suppressed) === '1'}
            kjsUrl={kjsUrl}
            visitorRecognition={!!h.get('x-kismet-visitor-recognition')}
            visitorEndpoint={h.get('x-kismet-visitor-recognition') || undefined}
        />
    );
}
