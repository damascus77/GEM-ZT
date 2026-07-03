import { getControllerClient } from '@/lib/controller';
import type { ControllerNetwork } from '@/lib/controller/types';
import { getDb } from '@/lib/db/client';
import {
  compileRules,
  DEFAULT_RULES_SOURCE,
  RulesCompileError,
} from '@/lib/rules/compiler';
import type { WriteResult } from './networks';

const META_UPSERT_WARNING =
  'Rules were applied to the controller, but saving the rules source failed. ' +
  'The network enforces the new rules; re-save to keep the editable source.';

export async function getRules(nwid: string): Promise<{ source: string; rules: unknown[] }> {
  const client = await getControllerClient();
  const network = await client.getNetwork(nwid);
  const meta = await getDb()
    .networkMeta.findUnique({ where: { nwid } })
    .catch(() => null);
  return {
    source: meta?.rulesSource || DEFAULT_RULES_SOURCE,
    rules: network.rules,
  };
}

export async function setRules(
  nwid: string,
  source: string,
): Promise<WriteResult<{ source: string; rules: unknown[] }>> {
  const compiled = compileRules(source);
  if (!compiled.ok) {
    throw new RulesCompileError(
      compiled.error.line,
      compiled.error.col,
      compiled.error.message,
    );
  }
  const client = await getControllerClient();
  const updated = await client.updateNetwork(nwid, {
    rules: compiled.rules,
    capabilities: Object.values(compiled.caps),
    tags: Object.values(compiled.tags),
  } as Partial<ControllerNetwork>);
  let metaWarning: string | null = null;
  try {
    await getDb().networkMeta.upsert({
      where: { nwid },
      create: { nwid, rulesSource: source },
      update: { rulesSource: source },
    });
  } catch (e) {
    console.error('[gem-zt] rulesSource upsert failed:', e);
    metaWarning = META_UPSERT_WARNING;
  }
  return { data: { source, rules: updated.rules }, metaWarning };
}
