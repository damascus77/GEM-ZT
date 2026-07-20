import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';

// Mock only the outbound I/O — the actual webhook POST and the email send — so
// the test exercises the real config resolution and the NotificationDelivery
// ledger against a real SQLite DB. getWebhookConfig stays real (reads a seeded
// Setting row).
vi.mock('@/lib/services/email', () => ({ sendMail: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/services/webhooks', async importActual => {
  const actual = await importActual<typeof import('@/lib/services/webhooks')>();
  return { ...actual, dispatchWebhook: vi.fn().mockResolvedValue(true) };
});

import { sendMail } from '@/lib/services/email';
import { dispatchWebhook, setWebhookConfig } from '@/lib/services/webhooks';
import { deliverEvent, eventKey, setNotificationConfig } from '@/lib/services/notifications';
import type { AppEvent } from '@/lib/events/bus';

const ORG_ID = 'org-1';
const dispatchMock = vi.mocked(dispatchWebhook);
const sendMailMock = vi.mocked(sendMail);

const memberEvent: AppEvent = {
  type: 'member.deauthorized',
  nwid: 'ntwk123',
  memberId: 'mem456',
  name: 'laptop',
  orgId: ORG_ID,
};

const unauthorizedEvent: AppEvent = {
  type: 'member.unauthorized',
  nwid: 'ntwk123',
  memberId: 'mem456',
  name: 'laptop',
  orgId: ORG_ID,
};

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

beforeEach(async () => {
  dispatchMock.mockClear().mockResolvedValue(true);
  sendMailMock.mockClear().mockResolvedValue(true);
  const db = getDb();
  await db.notificationDelivery.deleteMany();
  await db.setting.deleteMany();
  await db.organization.deleteMany();
});

describe('eventKey', () => {
  it('is stable for member.unauthorized (independent of time)', () => {
    expect(eventKey(unauthorizedEvent, 1000)).toBe(eventKey(unauthorizedEvent, 9999));
    expect(eventKey(unauthorizedEvent, 1000)).toBe('member.unauthorized:ntwk123:mem456');
  });

  it('keys member.deauthorized off the timestamp (each transition is distinct)', () => {
    expect(eventKey(memberEvent, 1000)).not.toBe(eventKey(memberEvent, 2000));
    expect(eventKey(memberEvent, 1000)).toBe('member.deauthorized:1000');
  });

  it('keys instance-wide controller events off the timestamp', () => {
    const ev: AppEvent = { type: 'controller.degraded' };
    expect(eventKey(ev, 1000)).not.toBe(eventKey(ev, 2000));
  });
});

describe('deliverEvent', () => {
  it('delivers to both channels once and is idempotent on replay', async () => {
    await setWebhookConfig(ORG_ID, { newMemberUrl: 'https://example.test/hook' });
    await setNotificationConfig(ORG_ID, { emailRecipients: ['ops@example.test'], events: {} });

    await deliverEvent(memberEvent, 1000);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    // Replay (e.g. scheduler re-fires the same transition): ledger blocks resend.
    await deliverEvent(memberEvent, 1000);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('delivers each distinct member.deauthorized occurrence (keyed by time)', async () => {
    await setWebhookConfig(ORG_ID, { newMemberUrl: 'https://example.test/hook' });

    // Two deauthorizations of the same member at different times (e.g.
    // deauthorize -> re-authorize -> deauthorize) must both alert.
    await deliverEvent(memberEvent, 1000);
    await deliverEvent(memberEvent, 2000);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it('dedups member.unauthorized to once even across ticks (permanent key)', async () => {
    await setWebhookConfig(ORG_ID, { newMemberUrl: 'https://example.test/hook' });

    // The webhook-check job re-publishes this every tick; the permanent key
    // dedups it to once-ever regardless of the timestamp.
    await deliverEvent(unauthorizedEvent, 1000);
    await deliverEvent(unauthorizedEvent, 2000);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('releases the claim on failure so a later tick retries', async () => {
    await setWebhookConfig(ORG_ID, { newMemberUrl: 'https://example.test/hook' });
    dispatchMock.mockResolvedValueOnce(false);

    await deliverEvent(memberEvent, 1000);
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    // Second attempt sees no surviving claim and retries (now succeeds).
    await deliverEvent(memberEvent, 1000);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it('skips a channel when the event type is disabled for the org', async () => {
    await setWebhookConfig(ORG_ID, { newMemberUrl: 'https://example.test/hook' });
    await setNotificationConfig(ORG_ID, {
      emailRecipients: ['ops@example.test'],
      events: { 'member.deauthorized': false },
    });

    await deliverEvent(memberEvent, 1000);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('fans instance-wide events out to every configured org', async () => {
    const db = getDb();
    await db.organization.createMany({
      data: [
        { id: 'org-a', name: 'A', slug: 'a', createdById: 'u1' },
        { id: 'org-b', name: 'B', slug: 'b', createdById: 'u1' },
      ],
    });
    await setWebhookConfig('org-a', { newMemberUrl: 'https://a.test/hook' });
    await setWebhookConfig('org-b', { newMemberUrl: 'https://b.test/hook' });

    await deliverEvent({ type: 'controller.degraded' }, 1000);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });
});
