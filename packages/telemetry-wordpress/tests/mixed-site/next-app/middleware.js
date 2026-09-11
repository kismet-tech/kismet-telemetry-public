const labOrigin = process.env.VISITOR_LAB === '1' ? 'http://127.0.0.1:8798' : 'http://127.0.0.1:8797';
import {createKismetMiddleware,consentFromCookie} from '@kismet-tech/telemetry-next';
export const middleware=createKismetMiddleware({visitorRecognition:process.env.VISITOR_LAB === '1',collectionSlug:'example-collection',trackingKey:'ctk_local_validation_only',consent:consentFromCookie('lab_consent',/^yes$/),endpoints:{resolveAnchor:labOrigin+'/v1/identity/resolve-anchor',track:labOrigin+'/api/track',apiOrigin:labOrigin+''},profile:{property:{pattern:/^\/(?:app\/)?stays\/([^/]+)/,as:'externalListingId'},intent:{path:'/checkout'}}});
export const config={matcher:['/stays/:path*','/checkout','/','/__kismet/visitor']};
