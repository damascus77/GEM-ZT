import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import { getDb } from '@/lib/db/client';
import {
  createNetworkFromConfig,
  toPortableConfig,
  type NetworkDetail,
  type PortableNetworkConfig,
  type WriteResult,
} from './networks';

export interface TemplateSummary {
  id: string;
  name: string;
  createdAt: Date;
}

// Stored JSON shape for a template's `config` column.
interface StoredTemplate {
  config: PortableNetworkConfig;
  description: string;
  tags: string;
  rulesSource: string;
}

/**
 * Thrown by `createTemplate` when a template with the same name already
 * exists in the same scope (org, or the null/global scope). The DB no longer
 * enforces a unique constraint on `NetworkTemplate.name` (orgs need their own
 * namespaces), so uniqueness is enforced here instead.
 */
export class TemplateNameTakenError extends Error {
  constructor(name: string) {
    super(`A template named "${name}" already exists.`);
    this.name = 'TemplateNameTakenError';
  }
}

export function listTemplates(): Promise<TemplateSummary[]> {
  return getDb().networkTemplate.findMany({
    select: { id: true, name: true, createdAt: true },
    orderBy: { name: 'asc' },
  });
}

/** Templates belonging to a specific org. */
export function listTemplatesForOrg(orgId: string): Promise<TemplateSummary[]> {
  return getDb().networkTemplate.findMany({
    where: { orgId },
    select: { id: true, name: true, createdAt: true },
    orderBy: { name: 'asc' },
  });
}

/** Fetch a single template, scoped to an org (null if it belongs to a different org). */
export async function getTemplateForOrg(
  id: string,
  orgId: string,
): Promise<TemplateSummary | null> {
  const template = await getDb().networkTemplate.findUnique({
    where: { id },
    select: { id: true, name: true, createdAt: true, orgId: true },
  });
  if (!template || template.orgId !== orgId) return null;
  const { orgId: _orgId, ...summary } = template;
  return summary;
}

/**
 * Create a template directly from a portable config (as opposed to
 * `saveTemplateFromNetwork`, which snapshots a live controller network).
 * Name uniqueness is enforced per scope: two orgs (or org vs. global) may
 * reuse the same name, but not within the same scope.
 */
export async function createTemplate(
  input: {
    name: string;
    config: PortableNetworkConfig;
    description?: string;
    tags?: string;
    rulesSource?: string;
  },
  orgId?: string,
): Promise<TemplateSummary> {
  const scope = orgId ?? null;
  const existing = await getDb().networkTemplate.findFirst({
    where: { orgId: scope, name: input.name },
  });
  if (existing) throw new TemplateNameTakenError(input.name);
  const stored: StoredTemplate = {
    config: input.config,
    description: input.description ?? '',
    tags: input.tags ?? '[]',
    rulesSource: input.rulesSource ?? '',
  };
  return getDb().networkTemplate.create({
    data: { name: input.name, config: JSON.stringify(stored), orgId },
    select: { id: true, name: true, createdAt: true },
  });
}

/**
 * Snapshot a network's portable config + GEM-ZT metadata as a named, reusable
 * template. Returns null if the source network doesn't exist on the controller.
 */
export async function saveTemplateFromNetwork(
  nwid: string,
  name: string,
): Promise<TemplateSummary | null> {
  const client = await getControllerClient();
  let config;
  try {
    config = await client.getNetwork(nwid);
  } catch (e) {
    if (e instanceof ControllerApiError && e.status === 404) return null;
    throw e;
  }
  const meta = await getDb().networkMeta.findUnique({ where: { nwid } }).catch(() => null);
  const stored: StoredTemplate = {
    config: toPortableConfig(config),
    description: meta?.description ?? '',
    tags: meta?.tags ?? '[]',
    rulesSource: meta?.rulesSource ?? '',
  };
  return getDb().networkTemplate.create({
    data: { name, config: JSON.stringify(stored) },
    select: { id: true, name: true, createdAt: true },
  });
}

/** Create a new network from a stored template. Returns null if the template is gone. */
export async function createNetworkFromTemplate(
  id: string,
): Promise<WriteResult<NetworkDetail> | null> {
  const template = await getDb().networkTemplate.findUnique({ where: { id } });
  if (!template) return null;
  const stored = JSON.parse(template.config) as StoredTemplate;
  return createNetworkFromConfig({
    config: stored.config,
    name: template.name,
    description: stored.description,
    tags: stored.tags,
    rulesSource: stored.rulesSource,
  });
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const { count } = await getDb().networkTemplate.deleteMany({ where: { id } });
  return count === 1;
}
