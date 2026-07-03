import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import {
  ControllerApiError,
  ControllerUnreachableError,
  InvalidControllerIdError,
} from '@/lib/controller/client';
import { AuthTokenError } from '@/lib/controller/token';

describe('apiError', () => {
  it('returns the error envelope with the given status', async () => {
    const res = apiError('NOT_FOUND', 'nope', 404);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'nope' } });
  });
});

describe('handleRouteError', () => {
  it('maps ZodError to 400 VALIDATION_ERROR', async () => {
    const zerr = z.object({ name: z.string() }).safeParse({ name: 5 });
    const res = handleRouteError(!zerr.success ? zerr.error : new Error('unreachable'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('name');
  });

  it('maps ControllerUnreachableError to 502 CONTROLLER_UNREACHABLE', async () => {
    const res = handleRouteError(new ControllerUnreachableError('down'));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('CONTROLLER_UNREACHABLE');
  });

  it('maps AuthTokenError to 502 CONTROLLER_UNREACHABLE with guidance', async () => {
    const res = handleRouteError(new AuthTokenError('cannot read token; check controller_data'));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('CONTROLLER_UNREACHABLE');
    expect(body.error.message).toContain('controller_data');
  });

  it('maps controller 404 to 404 NOT_FOUND', async () => {
    const res = handleRouteError(new ControllerApiError(404, 'no such network'));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('maps a controller auth failure (401/403) to a 502 degraded state', async () => {
    for (const status of [401, 403]) {
      const res = handleRouteError(new ControllerApiError(status, 'unauthorized'));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.code).toBe('CONTROLLER_UNREACHABLE');
      expect(body.error.message).toMatch(/credentials/i);
    }
  });

  it('maps InvalidControllerIdError to 400 VALIDATION_ERROR', async () => {
    const res = handleRouteError(new InvalidControllerIdError('Invalid network id: ...'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('maps unknown errors to 500 INTERNAL', async () => {
    const res = handleRouteError(new Error('boom'));
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL');
  });
});
