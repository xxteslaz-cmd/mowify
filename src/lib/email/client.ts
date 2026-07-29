import "server-only";
import { Resend } from "resend";

/**
 * Builds an absolute URL for an email link. Emails have no request context, so
 * the origin has to come from configuration rather than headers.
 */
export function appUrl(path: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

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
    console.error("Email not sent:", err);
    return false;
  }
}
