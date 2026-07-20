// Transient OIDC login state (state / nonce / PKCE verifier) is stashed in a
// short-lived httpOnly cookie between the login redirect and the callback,
// rather than a DB table — it lives for one round trip only. The cookie is
// httpOnly + SameSite=Lax (Lax so it survives the top-level redirect back from
// the IdP) and Secure-gated by the same env flag as the session cookie.

export const OIDC_STATE_COOKIE = 'gemzt_oidc_state';
export const OIDC_STATE_TTL_S = 600; // 10 minutes

export interface OidcLoginState {
  state: string;
  nonce: string;
  codeVerifier: string;
}

function cookieSecure(): boolean {
  return process.env.GEMZT_COOKIE_SECURE === 'true';
}

export function oidcStateCookieOptions() {
  return {
    httpOnly: true as const,
    path: '/' as const,
    sameSite: 'lax' as const,
    maxAge: OIDC_STATE_TTL_S,
    secure: cookieSecure(),
  };
}

/** Serialized Set-Cookie value that clears the state cookie after callback. */
export function clearOidcStateCookieHeader(): string {
  const parts = [`${OIDC_STATE_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieSecure()) parts.push('Secure');
  return parts.join('; ');
}

export function encodeOidcState(s: OidcLoginState): string {
  return Buffer.from(JSON.stringify(s), 'utf8').toString('base64url');
}

export function decodeOidcState(raw: string | undefined): OidcLoginState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<OidcLoginState>;
    if (
      typeof parsed.state === 'string' &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.codeVerifier === 'string'
    ) {
      return { state: parsed.state, nonce: parsed.nonce, codeVerifier: parsed.codeVerifier };
    }
    return null;
  } catch {
    return null;
  }
}
