// Browser helpers, re-exported from the core so a Node app imports one package.
//   import { createTracker } from '@kismet-tech/telemetry-node/client';
export {
    createTracker,
    currentKidSid,
    emitVisitorEvent,
    postBookingBridgeFromBrowser,
} from '@kismet-tech/telemetry/client';
