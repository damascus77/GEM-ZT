import { describe, it, expect } from 'vitest';
import { can } from '@/lib/authz/policy';
import { ORG_ROLES } from '@/lib/authz/roles';

describe('policy', () => {
  it('viewers can only read', () => {
    expect(can('viewer', 'network:read')).toBe(true);
    expect(can('viewer', 'network:write')).toBe(false);
    expect(can('viewer', 'member:read')).toBe(true);
  });
  it('editors write networks/members/rules/templates but not org membership', () => {
    expect(can('editor', 'network:write')).toBe(true);
    expect(can('editor', 'rules:write')).toBe(true);
    expect(can('editor', 'template:write')).toBe(true);
    expect(can('editor', 'org:manage-members')).toBe(false);
    expect(can('editor', 'webhook:manage')).toBe(false);
    expect(can('editor', 'apikey:manage')).toBe(false);
  });
  it('admins manage members, webhooks, org api keys; not org rename/delete', () => {
    expect(can('admin', 'org:manage-members')).toBe(true);
    expect(can('admin', 'webhook:manage')).toBe(true);
    expect(can('admin', 'apikey:manage')).toBe(true);
    expect(can('admin', 'org:manage')).toBe(false);
    expect(can('admin', 'org:delete')).toBe(false);
  });
  it('only owners rename/delete/transfer the org', () => {
    expect(can('owner', 'org:manage')).toBe(true);
    expect(can('owner', 'org:delete')).toBe(true);
  });
  it('every role can read the org it belongs to', () => {
    for (const r of ORG_ROLES) expect(can(r, 'org:read')).toBe(true);
  });
});
