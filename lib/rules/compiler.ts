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
