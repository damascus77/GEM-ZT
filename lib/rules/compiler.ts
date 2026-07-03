// Wraps the vendored ZeroTier rules compiler (lib/rules/vendor/rule-compiler.js).
// Upstream API: compile(src, rules, caps, tags) -> null | [line, col, message]
import RuleCompiler from './vendor/rule-compiler.js';

export const DEFAULT_RULES_SOURCE = [
  '# Allow only IPv4, IPv4 ARP, and IPv6 Ethernet frames.',
  'drop',
  '  not ethertype ipv4',
  '  and not ethertype arp',
  '  and not ethertype ipv6',
  ';',
  '',
  '# Accept anything else.',
  'accept;',
  '',
].join('\n');

export type CompileResult =
  | {
      ok: true;
      rules: unknown[];
      caps: Record<string, unknown>;
      tags: Record<string, unknown>;
    }
  | { ok: false; error: { line: number; col: number; message: string } };

export class RulesCompileError extends Error {
  readonly code = 'RULES_COMPILE_ERROR';

  constructor(
    public readonly line: number,
    public readonly col: number,
    message: string,
  ) {
    super(`line ${line}: ${message}`);
  }
}

export function compileRules(source: string): CompileResult {
  const rules: unknown[] = [];
  const caps: Record<string, unknown> = {};
  const tags: Record<string, unknown> = {};
  const err = (
    RuleCompiler as { compile: (s: string, r: unknown[], c: object, t: object) => unknown }
  ).compile(source, rules, caps, tags) as [number, number, string] | null;
  if (err) {
    return { ok: false, error: { line: err[0], col: err[1], message: err[2] } };
  }
  return { ok: true, rules, caps, tags };
}

// Named cap/tag blocks in the rules source each compile to a numeric id
// (caps[name] = { id, default, rules }, tags[name] = { id, default, enums, flags }).
// The UI needs simple name->id maps to render per-member capability/tag controls.
// Pure and non-throwing: a source with a syntax error just yields empty maps
// rather than breaking whatever page called this.
export function capabilityTagMaps(
  source: string,
): { capabilities: Record<string, number>; tags: Record<string, number> } {
  const result = compileRules(source);
  if (!result.ok) {
    return { capabilities: {}, tags: {} };
  }
  const toIdMap = (entries: Record<string, unknown>): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const [name, value] of Object.entries(entries)) {
      map[name] = (value as { id: number }).id;
    }
    return map;
  };
  return { capabilities: toIdMap(result.caps), tags: toIdMap(result.tags) };
}
