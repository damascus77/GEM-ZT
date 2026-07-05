import { ZodError } from 'zod';
import {
  ControllerApiError,
  ControllerUnreachableError,
  InvalidControllerIdError,
} from '@/lib/controller/client';
import { invalidateControllerClient } from '@/lib/controller';
import { AuthTokenError } from '@/lib/controller/token';
import { RulesCompileError } from '@/lib/rules/compiler';
import { TemplateNameTakenError } from '@/lib/services/templates';
import { OrgNotEmptyError } from '@/lib/services/orgs';

export function apiError(
  code: string,
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export function handleRouteError(e: unknown): Response {
  if (e instanceof ZodError) {
    const message = e.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    return apiError('VALIDATION_ERROR', message, 400);
  }
  if (e instanceof InvalidControllerIdError) {
    return apiError('VALIDATION_ERROR', e.message, 400);
  }
  if (e instanceof ControllerUnreachableError) {
    return apiError('CONTROLLER_UNREACHABLE', 'ZeroTier controller is unreachable.', 502);
  }
  if (e instanceof AuthTokenError) {
    return apiError('CONTROLLER_UNREACHABLE', e.message, 502);
  }
  if (e instanceof RulesCompileError) {
    return apiError('RULES_COMPILE_ERROR', e.message, 422);
  }
  if (e instanceof TemplateNameTakenError) {
    return apiError('TEMPLATE_NAME_TAKEN', e.message, 409);
  }
  if (e instanceof OrgNotEmptyError) {
    return apiError('ORG_NOT_EMPTY', e.message, 409);
  }
  if (e instanceof ControllerApiError && e.status === 404) {
    return apiError('NOT_FOUND', 'Resource not found on the controller.', 404);
  }
  // A controller auth failure (misconfigured/rotated authtoken.secret) is a
  // degraded-connectivity condition, not a caller error — surface it as 502 so
  // the "controller degraded" UI trips instead of throwing a raw 500. Drop the
  // cached client so the next request re-reads the token (recovers post-rotate).
  if (e instanceof ControllerApiError && (e.status === 401 || e.status === 403)) {
    invalidateControllerClient();
    return apiError(
      'CONTROLLER_UNREACHABLE',
      'ZeroTier controller rejected our credentials — it may be misconfigured or its auth ' +
        'token may have changed. Check the controller and restart if needed.',
      502,
    );
  }
  console.error('[gem-zt] unhandled route error:', e);
  return apiError('INTERNAL', 'Internal server error.', 500);
}
