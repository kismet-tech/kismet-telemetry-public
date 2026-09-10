import {KismetSeed} from '@kismet-tech/telemetry-next/seed';
export default function Layout({children}) {return <html><head><KismetSeed collectionSlug="example-collection" kjsUrl="/lab-k.js"/></head><body>{children}</body></html>}
