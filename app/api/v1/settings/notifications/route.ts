import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgRole } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import {
  getNotificationConfig,
  setNotificationConfig,
  type NotificationConfig,
} from '@/lib/services/notifications';
import type { EventType } from '@/lib/events/bus';

// Known event types that can be toggled per-org. Kept in sync with the AppEvent
// union in lib/events/bus.ts. Pure UI-refresh events (members.changed,
// metrics.changed) are not notifiable and so aren't offered as toggles.
const NOTIFIABLE_EVENTS = [
  'member.unauthorized',
  'member.deauthorized',
  'controller.degraded',
  'controller.recovered',
] as const satisfies readonly EventType[];

const MAX_RECIPIENTS = 50;

const putNotificationsSchema = z
  .object({
    emailRecipients: z.array(z.string().trim().min(1).email()).max(MAX_RECIPIENTS),
    events: z.record(z.enum(NOTIFIABLE_EVENTS), z.boolean()),
  })
  .strict();

export async function GET(req: Request) {
  const auth = await requireOrgRole(req, 'webhook:manage');
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json(await getNotificationConfig(auth.orgId!));
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PUT(req: Request) {
  const auth = await requireOrgRole(req, 'webhook:manage');
  if (auth instanceof Response) return auth;
  try {
    const body = putNotificationsSchema.parse(await req.json());
    const cfg: NotificationConfig = {
      emailRecipients: body.emailRecipients,
      events: body.events,
    };
    await setNotificationConfig(auth.orgId!, cfg);
    return NextResponse.json(await getNotificationConfig(auth.orgId!));
  } catch (e) {
    return handleRouteError(e);
  }
}
