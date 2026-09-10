// Browser helpers, re-exported from the core so a Next app imports one package.
//   import { createTracker } from '@kismet-tech/telemetry-next/client';
export {
    createTracker,
    currentKidSid,
    emitVisitorEvent,
    postBookingBridgeFromBrowser,
} from '@kismet-tech/telemetry/client';
