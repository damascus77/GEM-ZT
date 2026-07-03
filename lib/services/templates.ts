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

export function listTemplates(): Promise<TemplateSummary[]> {
  return getDb().networkTemplate.findMany({
    select: { id: true, name: true, createdAt: true },
    orderBy: { name: 'asc' },
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
