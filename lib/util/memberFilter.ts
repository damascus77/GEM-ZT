export interface FilterableMember {
  memberId: string;
  name: string;
  ipAssignments: string[];
  authorized: boolean;
  online: boolean | null;
  lastAuthorizedTime: number;
}

export type MemberSort = 'name' | 'id' | 'status' | 'lastAuthorized';
export type AuthorizedFilter = 'all' | 'authorized' | 'pending';
export type OnlineFilter = 'all' | 'online' | 'offline';

export interface MemberFilterOptions {
  search?: string;
  authorized?: AuthorizedFilter;
  online?: OnlineFilter;
  sort?: MemberSort;
  dir?: 'asc' | 'desc';
}

function matchesSearch(m: FilterableMember, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  return (
    m.name.toLowerCase().includes(needle) ||
    m.memberId.toLowerCase().includes(needle) ||
    m.ipAssignments.some(ip => ip.toLowerCase().includes(needle))
  );
}

/**
 * Client-side search + filter + sort for the member table. Pure and
 * non-mutating. "Unknown" presence (online === null) is excluded from both the
 * online and offline filters.
 */
export function filterAndSortMembers<T extends FilterableMember>(
  members: T[],
  opts: MemberFilterOptions = {}
): T[] {
  const { search = '', authorized = 'all', online = 'all', sort, dir = 'asc' } = opts;

  let out = members.filter(m => {
    if (!matchesSearch(m, search)) return false;
    if (authorized === 'authorized' && !m.authorized) return false;
    if (authorized === 'pending' && m.authorized) return false;
    if (online === 'online' && m.online !== true) return false;
    if (online === 'offline' && m.online !== false) return false;
    return true;
  });

  if (sort) {
    const factor = dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case 'name':
          cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        case 'id':
          cmp = a.memberId.localeCompare(b.memberId);
          break;
        case 'status':
          cmp = Number(a.authorized) - Number(b.authorized);
          break;
        case 'lastAuthorized':
          cmp = a.lastAuthorizedTime - b.lastAuthorizedTime;
          break;
      }
      return cmp * factor;
    });
  }

  return out;
}
