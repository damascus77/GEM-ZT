/**
 * Runtime environment validation.
 * Fails fast on invalid configuration before the server accepts requests.
 */

export function validateRateLimitEnv(): void {
  // Validate per-IP login rate limit
  const ipMaxAttemptsRaw = process.env.GEMZT_LOGIN_IP_MAX_ATTEMPTS;
  if (ipMaxAttemptsRaw !== undefined) {
    const parsed = Number(ipMaxAttemptsRaw);
    if (Number.isNaN(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
      throw new Error(
        `Invalid GEMZT_LOGIN_IP_MAX_ATTEMPTS: "${ipMaxAttemptsRaw}" — must be a positive integer`
      );
    }
  }

  // Validate per-username login rate limit
  const userMaxAttemptsRaw = process.env.GEMZT_LOGIN_MAX_ATTEMPTS;
  if (userMaxAttemptsRaw !== undefined) {
    const parsed = Number(userMaxAttemptsRaw);
    if (Number.isNaN(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
      throw new Error(
        `Invalid GEMZT_LOGIN_MAX_ATTEMPTS: "${userMaxAttemptsRaw}" — must be a positive integer`
      );
    }
  }

  // Validate login rate limit window
  const windowMsRaw = process.env.GEMZT_LOGIN_WINDOW_MS;
  if (windowMsRaw !== undefined) {
    const parsed = Number(windowMsRaw);
    if (Number.isNaN(parsed) || parsed < 1000 || !Number.isInteger(parsed)) {
      throw new Error(
        `Invalid GEMZT_LOGIN_WINDOW_MS: "${windowMsRaw}" — must be an integer >= 1000 (milliseconds)`
      );
    }
  }

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
