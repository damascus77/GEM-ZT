import { describe, it, expect } from 'vitest';
import { filterAndSortMembers, type FilterableMember } from '@/lib/util/memberFilter';

function m(over: Partial<FilterableMember>): FilterableMember {
  return {
    memberId: '0000000000',
    name: '',
    ipAssignments: [],
    authorized: false,
    online: null,
    lastAuthorizedTime: 0,
    ...over,
  };
}

const members = [
  m({
    memberId: 'aaaa000001',
    name: 'laptop',
    ipAssignments: ['10.0.0.5'],
    authorized: true,
    online: true,
    lastAuthorizedTime: 300,
  }),
  m({
    memberId: 'bbbb000002',
    name: 'phone',
    ipAssignments: ['10.0.0.6'],
    authorized: false,
    online: false,
    lastAuthorizedTime: 100,
  }),
  m({
    memberId: 'cccc000003',
    name: 'server',
    ipAssignments: ['10.0.0.7'],
    authorized: true,
    online: null,
    lastAuthorizedTime: 200,
  }),
];

describe('filterAndSortMembers', () => {
  it('free-text search matches name, id, or IP (case-insensitive)', () => {
    expect(filterAndSortMembers(members, { search: 'LAPTOP' }).map(x => x.name)).toEqual([
      'laptop',
    ]);
    expect(filterAndSortMembers(members, { search: 'bbbb0000' }).map(x => x.name)).toEqual([
      'phone',
    ]);
    expect(filterAndSortMembers(members, { search: '10.0.0.7' }).map(x => x.name)).toEqual([
      'server',
    ]);
  });

  it('filters by authorization state', () => {
    expect(
      filterAndSortMembers(members, { authorized: 'authorized' })
        .map(x => x.name)
        .sort()
    ).toEqual(['laptop', 'server']);
    expect(filterAndSortMembers(members, { authorized: 'pending' }).map(x => x.name)).toEqual([
      'phone',
    ]);
  });

  it('filters by online state (unknown excluded from online/offline)', () => {
    expect(filterAndSortMembers(members, { online: 'online' }).map(x => x.name)).toEqual([
      'laptop',
    ]);
    expect(filterAndSortMembers(members, { online: 'offline' }).map(x => x.name)).toEqual([
      'phone',
    ]);
  });

  it('sorts by name asc/desc', () => {
    expect(filterAndSortMembers(members, { sort: 'name', dir: 'asc' }).map(x => x.name)).toEqual([
      'laptop',
      'phone',
      'server',
    ]);
    expect(filterAndSortMembers(members, { sort: 'name', dir: 'desc' }).map(x => x.name)).toEqual([
      'server',
      'phone',
      'laptop',
    ]);
  });

  it('sorts by lastAuthorized', () => {
    expect(
      filterAndSortMembers(members, { sort: 'lastAuthorized', dir: 'desc' }).map(
        x => x.lastAuthorizedTime
      )
    ).toEqual([300, 200, 100]);
  });

  it('does not mutate the input array', () => {
    const copy = [...members];
    filterAndSortMembers(members, { sort: 'name' });
    expect(members).toEqual(copy);
  });
});
