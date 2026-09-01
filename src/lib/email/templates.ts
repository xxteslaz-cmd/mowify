// No external images, scripts, or stylesheets in these templates: a remote
// asset would cause the mail client to send a Referer header containing the
// token URL, leaking a live credential to whoever hosts that asset.
const WRAP = (body: string) =>
  `<div style="font-family:system-ui,sans-serif;max-width:480px;line-height:1.5">${body}</div>`;

const BUTTON = (href: string, label: string) =>
  `<p><a href="${href}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${label}</a></p>`;

export function resetPasswordEmail(link: string) {
  return {
    subject: "Reset your GroundsRoute password",
    html: WRAP(
      `<p>Someone asked to reset the password for this GroundsRoute account.</p>` +
        BUTTON(link, "Choose a new password") +
        `<p>This link works once and expires in an hour.</p>` +
        `<p>If this wasn't you, ignore this email — your password has not changed.</p>`,
    ),
  };
}

export function verifyEmailEmail(link: string) {
  return {
    subject: "Confirm your GroundsRoute email",
    html: WRAP(
      `<p>Confirm this address so you can recover your account if you ever forget your password.</p>` +
        BUTTON(link, "Confirm my email") +
        `<p>This link expires in seven days.</p>`,
    ),
  };
}

export function changeEmailEmail(link: string) {
  return {
    subject: "Confirm your new GroundsRoute email",
    html: WRAP(
      `<p>Someone asked to move this GroundsRoute account to this email address.</p>` +
        BUTTON(link, "Confirm my new email") +
        `<p>This link works once and expires in an hour. Nothing changes until you confirm.</p>` +
        `<p>If this wasn't you, ignore this email — your account will stay as it is.</p>`,
    ),
  };
}

/**
 * Written confirmation of the trial terms, sent once the account exists.
 *
 * Restating the negative option in writing after signup is what turns "they
 * ticked a box" into something the customer can find again in their inbox on
 * the day the charge lands. It is also the cheapest defence against a disputed
 * first charge there is.
 */
export function signupAcknowledgementEmail(input: {
  disclosure: string;
  chargeDate: string | null;
  billingUrl: string;
}) {
  return {
    subject: "Your GroundsRoute trial has started",
    html: WRAP(
      `<p>Your company is set up and your free trial has started. Here are the terms you agreed to, so you have them in writing:</p>` +
        `<p>${input.disclosure}</p>` +
        (input.chargeDate
          ? `<p>Your card will be charged on <strong>${input.chargeDate}</strong> unless you cancel before then.</p>`
          : "") +
        `<p>Cancelling is self-serve and takes a few clicks — you never need to contact us to stop a charge.</p>` +
        BUTTON(input.billingUrl, "View or cancel my subscription") +
        `<p>We'll also email you a reminder at least 7 days before the trial ends.</p>`,
    ),
  };
}

/**
 * The seven-day trial-end reminder.
 *
 * Terms section 3 commits to this in specific terms: a reminder "at least 7
 * days before the trial ends, telling you the date the charge will occur, the
 * amount, and how to cancel." All three are therefore required content, not
 * editorial choices — dropping any one of them breaks a published promise.
 *
 * It is also the single largest reducer of trial-conversion chargebacks, which
 * is the practical reason to write it plainly rather than to bury the charge.
 * A customer who is surprised by a charge disputes it; a dispute costs the
 * fee plus a ratio Stripe watches and can suspend an account over.
 */
export function trialEndingEmail(input: {
  chargeDate: string;
  amount: string;
  billingUrl: string;
}) {
  return {
    subject: "Your GroundsRoute trial ends in 7 days",
    html: WRAP(
      `<p>Your free trial of GroundsRoute ends on <strong>${input.chargeDate}</strong>.</p>` +
        `<p>On that date your subscription starts and the card on file is charged <strong>${input.amount}</strong>, then the same amount each month after that, until you cancel.</p>` +
        `<p>If you'd rather not continue, cancel before then and you will never be charged. Cancelling takes a few clicks on your billing page — you don't need to contact us.</p>` +
        BUTTON(input.billingUrl, "Manage or cancel my subscription") +
        `<p>If you're staying, there's nothing to do.</p>`,
    ),
  };
}

// Sent to the CURRENT address, not the new one, so the real owner has a
// chance to react before the account moves anywhere: it is the only signal
// they get if someone with a stolen session (and a guessed or leaked
// password) is behind the change.
export function emailChangeWarningEmail(newEmail: string) {
  return {
    subject: "Your GroundsRoute account email is changing",
    html: WRAP(
      `<p>Someone requested to change the email on this GroundsRoute account to <strong>${newEmail}</strong>.</p>` +
        `<p>Nothing has changed yet — the new address must confirm first, and the link expires in an hour.</p>` +
        `<p>If this wasn't you, sign in and change your password right away.</p>`,
    ),
  };
}
