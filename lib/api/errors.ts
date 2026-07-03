import { ZodError } from 'zod';
import { ControllerApiError, ControllerUnreachableError } from '@/lib/controller/client';
import { AuthTokenError } from '@/lib/controller/token';

export function apiError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function handleRouteError(e: unknown): Response {
  if (e instanceof ZodError) {
    const message = e.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    return apiError('VALIDATION_ERROR', message, 400);
  }
  if (e instanceof ControllerUnreachableError) {
    return apiError('CONTROLLER_UNREACHABLE', 'ZeroTier controller is unreachable.', 502);
  }
  if (e instanceof AuthTokenError) {
    return apiError('CONTROLLER_UNREACHABLE', e.message, 502);
  }
  if (e instanceof ControllerApiError && e.status === 404) {
    return apiError('NOT_FOUND', 'Resource not found on the controller.', 404);
  }
  console.error('[gem-zt] unhandled route error:', e);
  return apiError('INTERNAL', 'Internal server error.', 500);
}
