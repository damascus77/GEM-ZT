import { describe, it, expect } from 'vitest';
import { ORG_ROLES, ROLE_RANK, isOrgRole } from '@/lib/authz/roles';

describe('roles', () => {
  it('orders roles viewer < editor < admin < owner', () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.owner);
  });
  it('validates org roles', () => {
    expect(isOrgRole('owner')).toBe(true);
    expect(isOrgRole('superadmin')).toBe(false);
    expect(ORG_ROLES).toEqual(['owner', 'admin', 'editor', 'viewer']);
  });
});
