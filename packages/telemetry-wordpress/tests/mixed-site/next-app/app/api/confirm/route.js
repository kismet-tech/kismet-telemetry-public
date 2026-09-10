import {bookingBridge} from '@kismet-tech/telemetry-next';
import {cookies} from 'next/headers';
export async function POST(){const c=await cookies();const result=await bookingBridge({collectionSlug:'example-collection',trackingKey:'ctk_local_validation_only',endpoints:{apiOrigin:'http://127.0.0.1:8797'}},{kidSid:c.get('_kid_sid')?.value,confirmationCode:'EX-48213',bookingEngine:'custom',domain:'telemetry.test'});return Response.json({simulatedBookingConfirmed:true,bridge:result})}
