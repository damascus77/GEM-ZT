import { createHmac, randomBytes } from 'node:crypto';

// RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30s period) built only on node:crypto —
// no external otp library. RFC 4226 defines the underlying HOTP algorithm.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const PERIOD_SECONDS = 30;

/** RFC 4648 base32 encode (uppercase A-Z2-7, no padding). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/** RFC 4648 base32 decode. Accepts uppercase or lowercase; ignores '=' padding. */
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new random 160-bit (20-byte) TOTP secret, base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP: 6-digit code for the given secret bytes and counter. */
export function hotp(secretBytes: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  // Counter is a 64-bit big-endian integer; JS numbers are safe up to 2^53 so
  // split into high/low 32-bit halves.
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac('sha1', secretBytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = (binCode % 10 ** DIGITS).toString().padStart(DIGITS, '0');
  return code;
}

/** Current 6-digit TOTP code for a base32 secret, at the given time (ms, default now). */
export function totp(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Verify a submitted code against the current time step, tolerating +-1 step
 * of clock skew (i.e. the previous, current, and next 30s windows).
 */
export function verifyTotp(secretBase32: string, code: string, atMs: number = Date.now()): boolean {
  const secretBytes = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  for (let drift = -1; drift <= 1; drift++) {
    if (hotp(secretBytes, counter + drift) === code) return true;
  }
  return false;
}

/** otpauth:// URI for QR-code enrollment in authenticator apps. */
export function otpauthUri(secretBase32: string, account: string, issuer = 'GEM-ZT'): string {
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
