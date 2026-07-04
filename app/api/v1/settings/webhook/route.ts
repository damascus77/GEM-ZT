import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { getNewMemberWebhookUrl, setNewMemberWebhookUrl } from '@/lib/services/webhooks';
import { isSafeWebhookUrl } from '@/lib/util/ssrf';

const putWebhookSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine(isSafeWebhookUrl, {
        message:
          'must be an http(s) URL that is not a private, loopback, or link-local address',
      })
      .nullable(),
  })
  .strict();

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ url: await getNewMemberWebhookUrl() });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PUT(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = putWebhookSchema.parse(await req.json());
    await setNewMemberWebhookUrl(body.url);
    return NextResponse.json({ url: await getNewMemberWebhookUrl() });
  } catch (e) {
    return handleRouteError(e);
  }
}
