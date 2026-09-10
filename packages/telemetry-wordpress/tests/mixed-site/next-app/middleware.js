import {createKismetMiddleware,consentFromCookie} from '@kismet-tech/telemetry-next';
export const middleware=createKismetMiddleware({collectionSlug:'example-collection',trackingKey:'ctk_local_validation_only',consent:consentFromCookie('lab_consent',/^yes$/),endpoints:{resolveAnchor:'http://127.0.0.1:8797/v1/identity/resolve-anchor',track:'http://127.0.0.1:8797/api/track',apiOrigin:'http://127.0.0.1:8797'},profile:{property:{pattern:/^\/(?:app\/)?stays\/([^/]+)/,as:'externalListingId'},intent:{path:'/checkout'}}});
export const config={matcher:['/stays/:path*','/checkout','/']};
