export type InstanceRole = 'superadmin' | 'user';
export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

export const SUPERADMIN: InstanceRole = 'superadmin';
export const USER: InstanceRole = 'user';

export const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'editor', 'viewer'];

export const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export function isOrgRole(x: string): x is OrgRole {
  return (ORG_ROLES as string[]).includes(x);
}
