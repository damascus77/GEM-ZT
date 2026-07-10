import { getDb } from '@/lib/db/client';
import { createOrg, addMembership, getMembership } from '@/lib/services/orgs';
import { getWebhookConfig, setWebhookConfig } from '@/lib/services/webhooks';

export const DEFAULT_ORG_SLUG = 'default';

// Pre-org-scoping (v1) global webhook Setting key. Superseded by the
// `webhook:{orgId}` config (see lib/services/webhooks.ts), but an upgraded
// install may still have this row; migrate it into the default org below.
const LEGACY_WEBHOOK_URL_KEY = 'webhook.new_member_url';

/**
 * Idempotently ensure a "Default" org exists and every pre-multi-user row is
 * attributed to it. Safe to call on every boot. Returns the default org id, or
 * null when there are no users yet (fresh install — first-run setup will create
 * the org instead).
 */
export async function ensureDefaultOrgAndBackfill(): Promise<{ orgId: string } | null> {
  const db = getDb();
  if ((await db.user.count()) === 0) return null;

  let org = await db.organization.findUnique({ where: { slug: DEFAULT_ORG_SLUG } });
  if (!org) {
    const firstUser = await db.user.findFirst({ orderBy: { createdAt: 'asc' } });
    // createOrg makes firstUser an owner; we normalize the rest below.
    org = await createOrg({ name: 'Default', createdById: firstUser!.id });
    // createOrg forced slug from name ("default"); assert it matched the constant.
    if (org.slug !== DEFAULT_ORG_SLUG) {
      org = await db.organization.update({
        where: { id: org.id },
        data: { slug: DEFAULT_ORG_SLUG },
      });
    }
  }
  const orgId = org.id;

  // Legacy instance role "admin" (the v1 default) => super-admin.
  await db.user.updateMany({ where: { role: 'admin' }, data: { role: 'superadmin' } });

  // Every user gets an owner membership in the default org if they have none.
  const users = await db.user.findMany({ select: { id: true } });
  for (const u of users) {
    if (!(await getMembership(u.id, orgId))) {
      await addMembership(orgId, u.id, 'owner');
    }
  }

  // Attribute ownerless rows to the default org.
  await db.networkMeta.updateMany({ where: { orgId: null }, data: { orgId } });
  await db.apiKey.updateMany({ where: { orgId: null }, data: { orgId, role: 'owner' } });
  await db.auditLog.updateMany({ where: { orgId: null }, data: { orgId } });
  await db.networkTemplate.updateMany({ where: { orgId: null }, data: { orgId } });

  // Migrate the legacy (pre-org-scoping) global webhook Setting into the
  // default org's webhook config, if one exists and the org doesn't already
  // have a config of its own (idempotent, and won't clobber a config set
  // after upgrade via the settings route). The legacy row is left in place;
  // it's inert once dispatch reads the org-scoped config exclusively.
  const legacy = await db.setting.findUnique({ where: { key: LEGACY_WEBHOOK_URL_KEY } });
  if (legacy?.value) {
    const existing = await getWebhookConfig(orgId);
    if (!existing.newMemberUrl) {
      await setWebhookConfig(orgId, { newMemberUrl: legacy.value });
    }
  }

  return { orgId };
}
