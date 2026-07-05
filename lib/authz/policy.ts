import { ROLE_RANK, type OrgRole } from './roles';

export type Action =
  | 'org:read'
  | 'network:read'
  | 'network:write'
  | 'member:read'
  | 'member:write'
  | 'rules:write'
  | 'template:read'
  | 'template:write'
  | 'org:manage-members'
  | 'webhook:manage'
  | 'apikey:manage'
  | 'org:manage'
  | 'org:delete';

// Minimum org role required for each action. can() is a rank comparison.
export const ACTION_MIN_RANK: Record<Action, OrgRole> = {
  'org:read': 'viewer',
  'network:read': 'viewer',
  'member:read': 'viewer',
  'template:read': 'viewer',
  'network:write': 'editor',
  'member:write': 'editor',
  'rules:write': 'editor',
  'template:write': 'editor',
  'org:manage-members': 'admin',
  'webhook:manage': 'admin',
  'apikey:manage': 'admin',
  'org:manage': 'owner',
  'org:delete': 'owner',
};

export function can(role: OrgRole, action: Action): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[ACTION_MIN_RANK[action]];
}
