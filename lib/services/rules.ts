import { getControllerClient } from '@/lib/controller';
import type { ControllerNetwork } from '@/lib/controller/types';
import { getDb } from '@/lib/db/client';
import {
  capabilityTagMaps,
  compileRules,
  DEFAULT_RULES_SOURCE,
  RulesCompileError,
} from '@/lib/rules/compiler';
import type { WriteResult } from './networks';

const META_UPSERT_WARNING =
  'Rules were applied to the controller, but saving the rules source failed. ' +
  'The network enforces the new rules; re-save to keep the editable source.';

export async function getRules(nwid: string): Promise<{
  source: string;
  rules: unknown[];
  sourceIsDefault: boolean;
  capabilities: Record<string, number>;
  tags: Record<string, number>;
}> {
  const client = await getControllerClient();
  const network = await client.getNetwork(nwid);
  const meta = await getDb()
    .networkMeta.findUnique({ where: { nwid } })
    .catch((e) => {
      // Don't let a DB failure masquerade as "no stored source" silently — that
      // would show the default template and risk overwriting live custom rules
      // on save. We still fall back (below) so the editor stays usable, but log
      // so the real cause is visible.
      console.error('[gem-zt] networkMeta read failed in getRules:', e);
      return null;
    });
  const stored = meta?.rulesSource;
  // When no source is on record (network predates GEM-ZT, or app_data was lost/
  // restored) we fall back to the default template. That template does NOT
  // necessarily match the rules the controller is actually enforcing, so callers
  // must warn before letting a save overwrite the live rules.
  const source = stored || DEFAULT_RULES_SOURCE;
  const { capabilities, tags } = capabilityTagMaps(source);
  return {
    source,
    rules: network.rules,
    sourceIsDefault: !stored,
    capabilities,
    tags,
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
  // GET-first: the controller upserts on POST, so a PUT of rules to a typo'd or
  // already-deleted nwid would resurrect the network as a rules-only shell
  // (no routes/pools/name). Confirm existence so the 404 propagates cleanly.
  await client.getNetwork(nwid);
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
