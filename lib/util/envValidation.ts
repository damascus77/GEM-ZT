/**
 * Runtime environment validation.
 * Fails fast on invalid configuration before the server accepts requests.
 */

export function validateRateLimitEnv(): void {
  validatePositiveIntEnv('GEMZT_LOGIN_IP_MAX_ATTEMPTS');
  validatePositiveIntEnv('GEMZT_LOGIN_MAX_ATTEMPTS');
  validateWindowMsEnv('GEMZT_LOGIN_WINDOW_MS');
  validatePositiveIntEnv('GEMZT_SELF_AUTHORIZE_MAX_ATTEMPTS');
  validateWindowMsEnv('GEMZT_SELF_AUTHORIZE_WINDOW_MS');

  // Validate audit retention days
  const auditRetentionRaw = process.env.GEMZT_AUDIT_RETENTION_DAYS;
  if (auditRetentionRaw !== undefined) {
    const parsed = Number(auditRetentionRaw);
    if (Number.isNaN(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
      throw new Error(
        `Invalid GEMZT_AUDIT_RETENTION_DAYS: "${auditRetentionRaw}" — must be a positive integer`
      );
    }
  }

  // Validate trust proxy flag
  const trustProxyRaw = process.env.GEMZT_TRUST_PROXY;
  if (trustProxyRaw !== undefined && !['true', 'false'].includes(trustProxyRaw.toLowerCase())) {
    throw new Error(`Invalid GEMZT_TRUST_PROXY: "${trustProxyRaw}" — must be "true" or "false"`);
  }
}

function validatePositiveIntEnv(name: string): void {
  const raw = process.env[name];
  if (raw === undefined) return;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
    throw new Error(`Invalid ${name}: "${raw}" — must be a positive integer`);
  }
}

function validateWindowMsEnv(name: string): void {
  const raw = process.env[name];
  if (raw === undefined) return;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 1000 || !Number.isInteger(parsed)) {
    throw new Error(`Invalid ${name}: "${raw}" — must be an integer >= 1000 (milliseconds)`);
  }
}
