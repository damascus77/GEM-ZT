import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { getNotificationConfig } from '@/lib/services/notifications';
import { isEmailEnabled, sendMail } from '@/lib/services/email';

// Sends a test email to the org's configured notification recipients so an
// operator can confirm SMTP + recipient config actually works before relying on
// it for real alerts. Same auth as the webhook/notifications settings routes.
export async function POST(req: Request) {
  const auth = await requireOrgRole(req, 'webhook:manage');
  if (auth instanceof Response) return auth;
  try {
    if (!isEmailEnabled()) {
      return apiError(
        'EMAIL_NOT_CONFIGURED',
        'Email is not configured. Set SMTP_HOST (and related SMTP_* env vars) to enable email.',
        400
      );
    }

    const { emailRecipients } = await getNotificationConfig(auth.orgId!);
    if (emailRecipients.length === 0) {
      return apiError(
        'NO_RECIPIENTS',
        'No email recipients configured. Add recipients before sending a test email.',
        400
      );
    }

    const sent = await sendMail({
      to: emailRecipients,
      subject: '[gem-zt] Test notification email',
      text: 'This is a test email from GEM-ZT confirming your notification email configuration works.',
    });

    if (!sent) {
      return apiError(
        'EMAIL_SEND_FAILED',
        'Failed to send the test email. Check the server logs and your SMTP configuration.',
        502
      );
    }

    return NextResponse.json({ sent: true, recipients: emailRecipients });
  } catch (e) {
    return handleRouteError(e);
  }
}
