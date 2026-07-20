import nodemailer, { type Transporter } from 'nodemailer';

// SMTP email transport. Off unless SMTP_HOST is set, so instances that don't
// want email never construct a transport. Supports both connection styles:
//   - Implicit TLS (SMTPS), typically port 465: SMTP_SECURE=true
//   - STARTTLS upgrade, typically port 587: SMTP_SECURE=false + SMTP_STARTTLS=true
// (I7: ZTNET-style STARTTLS support.) requireTLS forces the STARTTLS upgrade and
// fails rather than silently sending in cleartext if the server won't upgrade.

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string | null;
  pass: string | null;
  from: string;
}

export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/** Read SMTP config from the environment, or null if email isn't configured. */
export function getEmailConfig(): EmailConfig | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  const secure = process.env.SMTP_SECURE === 'true';
  const portRaw = Number(process.env.SMTP_PORT);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : secure ? 465 : 587;
  const user = process.env.SMTP_USER || null;

  return {
    host,
    port,
    secure,
    // STARTTLS upgrade for non-implicit-TLS connections. Defaults on when not
    // using implicit TLS so cleartext SMTP is opt-in, not the default.
    requireTls: process.env.SMTP_STARTTLS ? process.env.SMTP_STARTTLS === 'true' : !secure,
    user,
    pass: process.env.SMTP_PASS || null,
    from: process.env.SMTP_FROM || (user ?? `gem-zt@${host}`),
  };
}

export function isEmailEnabled(): boolean {
  return getEmailConfig() !== null;
}

// Memoize the transport (and the config it was built from) so we don't rebuild
// a connection pool per send. Rebuilds if the config changes (e.g. in tests).
let cached: { config: EmailConfig; transport: Transporter } | null = null;

export function buildTransport(config: EmailConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
  });
}

function getTransport(config: EmailConfig): Transporter {
  if (!cached || JSON.stringify(cached.config) !== JSON.stringify(config)) {
    cached = { config, transport: buildTransport(config) };
  }
  return cached.transport;
}

/**
 * Send an email. Best-effort like webhook dispatch: returns false (and logs) on
 * any failure rather than throwing, so notification fan-out can treat it as one
 * channel among several. Returns false immediately if email isn't configured.
 */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  const config = getEmailConfig();
  if (!config) return false;
  try {
    await getTransport(config).sendMail({
      from: config.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return true;
  } catch (e) {
    console.error('[gem-zt] email send failed:', e);
    return false;
  }
}

/** Test-only: drop the memoized transport. */
export function resetEmailTransportForTests(): void {
  cached = null;
}
