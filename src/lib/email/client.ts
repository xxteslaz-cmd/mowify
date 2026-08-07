import "server-only";
import { Resend } from "resend";

// Moved to src/lib/url.ts: the Stripe webhook route needs it too, and it's a
// Route Handler rather than a Server Action, so it can't import this module
// (see the no-restricted-imports rule in eslint.config.mjs). Re-exported here
// so existing callers of `appUrl` from "@/lib/email/client" are unchanged.
export { appUrl } from "@/lib/url";

/**
 * Sends an email and reports whether it worked.
 *
 * Deliberately never throws. No user-facing operation — signing up, requesting
 * a reset — should fail because an email provider is having a bad day. Callers
 * decide what to do with a false.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.error(
      "Email not sent: RESEND_API_KEY or EMAIL_FROM is not configured.",
    );
    return false;
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
    if (error) {
      console.error("Email not sent:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    // Narrowed rather than logging the whole error object: an unknown future
    // error shape (e.g. one that echoes the request body) could otherwise put
    // a reset or verification token into the logs.
    console.error(
      "Email not sent:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}
