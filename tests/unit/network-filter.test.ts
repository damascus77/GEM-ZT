import { describe, it, expect } from 'vitest';
import { filterAndSortNetworks, type FilterableNetwork } from '@/lib/util/networkFilter';

function n(over: Partial<FilterableNetwork>): FilterableNetwork {
  return { nwid: '0000000000000000', name: '', private: true, memberCount: 0, ...over };
}

const nets = [
  n({ nwid: 'aaaa000000000001', name: 'home-lan', private: true, memberCount: 3 }),
  n({ nwid: 'bbbb000000000002', name: 'guest', private: false, memberCount: 10 }),
  n({ nwid: 'cccc000000000003', name: 'lab', private: true, memberCount: 1 }),
];

describe('filterAndSortNetworks', () => {
  it('searches by name or nwid (case-insensitive)', () => {
    expect(filterAndSortNetworks(nets, { search: 'HOME' }).map(x => x.name)).toEqual(['home-lan']);
    expect(filterAndSortNetworks(nets, { search: 'cccc0000' }).map(x => x.name)).toEqual(['lab']);
  });

  it('filters by visibility', () => {
    expect(filterAndSortNetworks(nets, { visibility: 'public' }).map(x => x.name)).toEqual([
      'guest',
    ]);
    expect(
      filterAndSortNetworks(nets, { visibility: 'private' })
        .map(x => x.name)
        .sort()
    ).toEqual(['home-lan', 'lab']);
  });

  it('sorts by name and by member count', () => {
    expect(filterAndSortNetworks(nets, { sort: 'name', dir: 'asc' }).map(x => x.name)).toEqual([
      'guest',
      'home-lan',
      'lab',
    ]);
    expect(
      filterAndSortNetworks(nets, { sort: 'members', dir: 'desc' }).map(x => x.memberCount)
    ).toEqual([10, 3, 1]);
  });

  it('does not mutate the input', () => {
    const copy = [...nets];
    filterAndSortNetworks(nets, { sort: 'name' });
    expect(nets).toEqual(copy);
  });
});
