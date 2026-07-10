import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgRole } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import { getWebhookConfig, setWebhookConfig } from '@/lib/services/webhooks';
import { isSafeWebhookUrl } from '@/lib/util/ssrf';

const putWebhookSchema = z
  .object({
    newMemberUrl: z
      .string()
      .url()
      .refine(isSafeWebhookUrl, {
        message: 'must be an http(s) URL that is not a private, loopback, or link-local address',
      })
      .nullable(),
  })
  .strict();

export async function GET(req: Request) {
  const auth = await requireOrgRole(req, 'webhook:manage');
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json(await getWebhookConfig(auth.orgId!));
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PUT(req: Request) {
  const auth = await requireOrgRole(req, 'webhook:manage');
  if (auth instanceof Response) return auth;
  try {
    const body = putWebhookSchema.parse(await req.json());
    await setWebhookConfig(auth.orgId!, body);
    return NextResponse.json(await getWebhookConfig(auth.orgId!));
  } catch (e) {
    return handleRouteError(e);
  }
}
