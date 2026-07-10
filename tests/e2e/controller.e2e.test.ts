import { execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ControllerClient } from '@/lib/controller/client';

const run = process.env.E2E === '1' ? describe : describe.skip;

const COMPOSE = 'docker compose -f docker-compose.e2e.yml';

run('e2e: real zerotier-one controller', () => {
  let client: ControllerClient;

  beforeAll(async () => {
    execSync(`${COMPOSE} up -d`, { stdio: 'inherit' });
    let token = '';
    for (let i = 0; i < 30; i += 1) {
      try {
        token = execSync(
          `${COMPOSE} exec -T zerotier-controller cat /var/lib/zerotier-one/authtoken.secret`
        )
          .toString()
          .trim();
        if (token !== '') break;
      } catch {
        // container still starting
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    expect(token).not.toBe('');
    client = new ControllerClient({ baseUrl: 'http://127.0.0.1:19993', token });
    // wait for the HTTP API to answer
    for (let i = 0; i < 30; i += 1) {
      try {
        await client.getStatus();
        return;
      } catch {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    throw new Error('controller HTTP API never came up');
  }, 90_000);

  afterAll(() => {
    execSync(`${COMPOSE} down -v`, { stdio: 'inherit' });
  });

  it('create network -> authorize member -> assign IP -> verify -> delete', async () => {
    const status = await client.getStatus();
    expect(status.address).toMatch(/^[0-9a-f]{10}$/);

    const net = await client.createNetwork(status.address, {
      name: 'gemzt-e2e',
      private: true,
    });
    expect(net.id).toMatch(/^[0-9a-f]{16}$/);

    const configured = await client.updateNetwork(net.id, {
      ipAssignmentPools: [{ ipRangeStart: '10.147.17.1', ipRangeEnd: '10.147.17.254' }],
      routes: [{ target: '10.147.17.0/24' }],
      v4AssignMode: { zt: true },
    });
    expect(configured.ipAssignmentPools).toHaveLength(1);

    const member = await client.updateMember(net.id, 'deadbeef01', {
      authorized: true,
      ipAssignments: ['10.147.17.10'],
    });
    expect(member.authorized).toBe(true);
    expect(member.ipAssignments).toContain('10.147.17.10');

    const fetched = await client.getMember(net.id, 'deadbeef01');
    expect(fetched.authorized).toBe(true);
    expect(fetched.ipAssignments).toContain('10.147.17.10');

    const memberIds = await client.listMemberIds(net.id);
    expect(Object.keys(memberIds)).toContain('deadbeef01');

    await client.deleteMember(net.id, 'deadbeef01');
    await client.deleteNetwork(net.id);
    const remaining = await client.listNetworkIds();
    expect(remaining).not.toContain(net.id);
  }, 60_000);
});
