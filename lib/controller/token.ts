import { readFile } from 'node:fs/promises';

export class AuthTokenError extends Error {
  readonly code = 'AUTH_TOKEN_MISSING';
}

const DEFAULT_TOKEN_PATH = '/controller/authtoken.secret';

export async function readAuthToken(): Promise<string> {
  const fromEnv = process.env.ZT_AUTH_TOKEN;
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  const path = process.env.ZT_TOKEN_PATH ?? DEFAULT_TOKEN_PATH;
  let token = '';
  try {
    token = (await readFile(path, 'utf8')).trim();
  } catch {
    throw new AuthTokenError(
      `Cannot read ZeroTier auth token at ${path}. Check that the controller_data volume ` +
        `is mounted read-only at /controller, that the zerotier-controller service has ` +
        `started at least once, or set ZT_AUTH_TOKEN directly.`,
    );
  }
  if (token === '') {
    throw new AuthTokenError(
      `ZeroTier auth token file at ${path} is empty. The controller_data volume may not ` +
        `be initialized yet; start the zerotier-controller service and retry.`,
    );
  }
  return token;
}
