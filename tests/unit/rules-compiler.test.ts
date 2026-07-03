import { describe, it, expect } from 'vitest';
import {
  compileRules,
  capabilityTagMaps,
  DEFAULT_RULES_SOURCE,
  RulesCompileError,
} from '@/lib/rules/compiler';

describe('compileRules', () => {
  it('compiles the default rules source to ACTION_ rules JSON', () => {
    const result = compileRules(DEFAULT_RULES_SOURCE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rules.length).toBeGreaterThan(0);
      const types = result.rules.map((r) => (r as { type: string }).type);
      expect(types).toContain('ACTION_ACCEPT');
    }
  });

  it('compiles a simple accept-only policy', () => {
    const result = compileRules('accept;');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rules).toHaveLength(1);
      expect((result.rules[0] as { type: string }).type).toBe('ACTION_ACCEPT');
      expect(result.caps).toEqual({});
      expect(result.tags).toEqual({});
    }
  });

  it('compiles tags and caps sections', () => {
    const src = [
      'tag department',
      '  id 1000',
      '  enum 100 sales',
      '  enum 200 engineering',
      ';',
      'cap superuser',
      '  id 2000',
      '  accept;',
      ';',
      'accept;',
    ].join('\n');
    const result = compileRules(src);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.tags)).toContain('department');
      expect(Object.keys(result.caps)).toContain('superuser');
    }
  });

  it('returns a structured error with line info for bad source', () => {
    const result = compileRules('acceptt;');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.line).toBeGreaterThanOrEqual(0);
      expect(typeof result.error.message).toBe('string');
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  it('exposes RulesCompileError with line/col metadata', () => {
    const err = new RulesCompileError(3, 1, 'unrecognized keyword');
    expect(err.code).toBe('RULES_COMPILE_ERROR');
    expect(err.line).toBe(3);
    expect(err.col).toBe(1);
    expect(err.message).toBe('line 3: unrecognized keyword');
  });
});

describe('capabilityTagMaps', () => {
  it('maps named cap/tag blocks to their numeric ids', () => {
    const src = [
      'tag department',
      '  id 1000',
      '  enum 100 sales',
      '  enum 200 eng',
      ';',
      'cap superuser',
      '  id 2000',
      '  accept;',
      ';',
      'accept;',
    ].join('\n');
    expect(capabilityTagMaps(src)).toEqual({
      capabilities: { superuser: 2000 },
      tags: { department: 1000 },
    });
  });

  it('returns empty maps when the source has no caps or tags', () => {
    expect(capabilityTagMaps('accept;')).toEqual({ capabilities: {}, tags: {} });
  });

  it('returns empty maps on a compile failure instead of throwing', () => {
    expect(() => capabilityTagMaps('acceptt;')).not.toThrow();
    expect(capabilityTagMaps('acceptt;')).toEqual({ capabilities: {}, tags: {} });
  });
});
