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

export function changeEmailEmail(link: string) {
  return {
    subject: "Confirm your new Mowify email",
    html: WRAP(
      `<p>Someone asked to move this Mowify account to this email address.</p>` +
        BUTTON(link, "Confirm my new email") +
        `<p>This link works once and expires in an hour. Nothing changes until you confirm.</p>` +
        `<p>If this wasn't you, ignore this email — your account will stay as it is.</p>`,
    ),
  };
}

// Sent to the CURRENT address, not the new one, so the real owner has a
// chance to react before the account moves anywhere: it is the only signal
// they get if someone with a stolen session (and a guessed or leaked
// password) is behind the change.
export function emailChangeWarningEmail(newEmail: string) {
  return {
    subject: "Your Mowify account email is changing",
    html: WRAP(
      `<p>Someone requested to change the email on this Mowify account to <strong>${newEmail}</strong>.</p>` +
        `<p>Nothing has changed yet — the new address must confirm first, and the link expires in an hour.</p>` +
        `<p>If this wasn't you, sign in and change your password right away.</p>`,
    ),
  };
}
