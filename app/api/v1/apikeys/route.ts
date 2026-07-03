import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { createApiKey, listApiKeys } from '@/lib/services/apiKeys';

const createKeySchema = z
  .object({
    name: z.string().min(1).max(64),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ apiKeys: await listApiKeys(auth.user.id) });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = createKeySchema.parse(await req.json());
    const { apiKey, fullKey } = await createApiKey(
      auth.user.id,
      body.name,
      body.expiresAt ? new Date(body.expiresAt) : undefined,
    );
    await logAudit({
      userId: auth.user.id,
      action: 'apikey.create',
      targetType: 'apikey',
      targetId: apiKey.id,
      detail: { name: body.name },
    });
    return NextResponse.json({ apiKey, fullKey }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
