// No external images, scripts, or stylesheets in these templates: a remote
// asset would cause the mail client to send a Referer header containing the
// token URL, leaking a live credential to whoever hosts that asset.
const WRAP = (body: string) =>
  `<div style="font-family:system-ui,sans-serif;max-width:480px;line-height:1.5">${body}</div>`;

const BUTTON = (href: string, label: string) =>
  `<p><a href="${href}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${label}</a></p>`;

export function resetPasswordEmail(link: string) {
  return {
    subject: "Reset your Mowify password",
    html: WRAP(
      `<p>Someone asked to reset the password for this Mowify account.</p>` +
        BUTTON(link, "Choose a new password") +
        `<p>This link works once and expires in an hour.</p>` +
        `<p>If this wasn't you, ignore this email — your password has not changed.</p>`,
    ),
  };
}

export function verifyEmailEmail(link: string) {
  return {
    subject: "Confirm your Mowify email",
    html: WRAP(
      `<p>Confirm this address so you can recover your account if you ever forget your password.</p>` +
        BUTTON(link, "Confirm my email") +
        `<p>This link expires in seven days.</p>`,
    ),
  };
}
