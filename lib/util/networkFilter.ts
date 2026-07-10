export interface FilterableNetwork {
  nwid: string;
  name: string;
  private: boolean;
  memberCount: number;
}

export type NetworkSort = 'name' | 'members';
export type VisibilityFilter = 'all' | 'private' | 'public';

export interface NetworkFilterOptions {
  search?: string;
  visibility?: VisibilityFilter;
  sort?: NetworkSort;
  dir?: 'asc' | 'desc';
}

/** Client-side search + filter + sort for the networks list. Pure, non-mutating. */
export function filterAndSortNetworks<T extends FilterableNetwork>(
  networks: T[],
  opts: NetworkFilterOptions = {}
): T[] {
  const { search = '', visibility = 'all', sort, dir = 'asc' } = opts;
  const needle = search.trim().toLowerCase();

  let out = networks.filter(netw => {
    if (
      needle !== '' &&
      !netw.name.toLowerCase().includes(needle) &&
      !netw.nwid.toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (visibility === 'private' && !netw.private) return false;
    if (visibility === 'public' && netw.private) return false;
    return true;
  });

  if (sort) {
    const factor = dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      const cmp =
        sort === 'name'
          ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
          : a.memberCount - b.memberCount;
      return cmp * factor;
    });
  }

  return out;
}
