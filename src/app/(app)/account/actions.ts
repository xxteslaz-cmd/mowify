"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { hashSecret, verifySecret } from "@/lib/auth/password";
import { readSessionToken, deleteOtherSessionsForUser } from "@/lib/auth/session";
import { issueToken, isWithinCooldown } from "@/lib/auth/token";
import { sendEmail, appUrl } from "@/lib/email/client";
import {
  verifyEmailEmail,
  changeEmailEmail,
  emailChangeWarningEmail,
  resetPasswordEmail,
} from "@/lib/email/templates";
import {
  isLocked,
  lockoutMessage,
  nextLockoutState,
  priorFailures,
} from "@/lib/auth/lockout";

const ChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "Use at least 8 characters"),
  })
  .strict();

// A Server Component/Action error thrown in a production build reaches the
// client only as an opaque digest — React redacts the real message. Expected
// failures (wrong password, weak password) are therefore modeled as a return
// value, the same shape login/signup/completeReset already use, not a throw.
export type ChangePasswordState = { error?: string } | undefined;

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ChangePasswordState> {
  const { userId } = await requireOwner();
  const parsed = ChangeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (isLocked(user)) return { error: lockoutMessage(user.lockedUntil!) };

  // A stolen session should not be enough to guess the current password
  // unthrottled: a correct guess is a permanent takeover, since it lets the
  // attacker set a new password and evict the real owner's other sessions.
  // Throttled the same way login throttles a wrong password.
  if (
    !user.passwordHash ||
    !(await verifySecret(user.passwordHash, parsed.data.currentPassword))
  ) {
    const next = nextLockoutState(priorFailures(user));
    await prisma.user.update({ where: { id: userId }, data: next });
    return next.lockedUntil
      ? { error: lockoutMessage(next.lockedUntil) }
      : { error: "Current password is incorrect" };
  }

  const passwordHash = await hashSecret(parsed.data.newPassword);

  // A password change is exactly the moment the email-change warning tells a
  // real owner to act if it wasn't them. That advice only works if it
  // actually stops the in-flight move: an attacker who requested a change and
  // already holds the new address's confirmation link must not be able to
  // use it after the owner "fixes" things this way. Clearing pendingEmail and
  // burning any outstanding EMAIL_CHANGE token here closes that window.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
        pendingEmail: null,
      },
    }),
    prisma.token.updateMany({
      where: { userId, purpose: "EMAIL_CHANGE", consumedAt: null },
      data: { consumedAt: new Date() },
    }),
  ]);

  // Sign out everywhere else, but not the tab doing the changing.
  const current = await readSessionToken();
  if (current) await deleteOtherSessionsForUser(userId, current);

  revalidatePath("/account");
}

const EmailChangeSchema = z
  .object({
    newEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
    currentPassword: z.string().min(1, "Enter your current password"),
  })
  .strict();

export type EmailChangeState = { error?: string } | undefined;

// Requests a move to a new address. The move does not happen here — only
// once the new address confirms — so a typo can never strand the account
// somewhere unreachable, which is the exact failure this feature exists to
// prevent. See requireOwner()/lockout above: the same current-password check
// and throttle as changePassword, because a stolen session must not be
// enough on its own to move the account.
export async function requestEmailChange(input: {
  newEmail: string;
  currentPassword: string;
}): Promise<EmailChangeState> {
  const { userId } = await requireOwner();
  const parsed = EmailChangeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (isLocked(user)) return { error: lockoutMessage(user.lockedUntil!) };

  if (parsed.data.newEmail === user.email) {
    return { error: "That's already your email address" };
  }

  // Same reasoning as changePassword: a correct guess here would let an
  // attacker holding a stolen session move the account to an address they
  // control, so wrong guesses are throttled identically.
  if (
    !user.passwordHash ||
    !(await verifySecret(user.passwordHash, parsed.data.currentPassword))
  ) {
    const next = nextLockoutState(priorFailures(user));
    await prisma.user.update({ where: { id: userId }, data: next });
    return next.lockedUntil
      ? { error: lockoutMessage(next.lockedUntil) }
      : { error: "Current password is incorrect" };
  }

  // The address being taken is not a secret worth protecting here: signup
  // already rejects duplicates visibly for the same address.
  const taken = await prisma.user.findUnique({
    where: { email: parsed.data.newEmail },
  });
  if (taken) return { error: "That email is already registered" };

  // The same abuse the reset-request cooldown exists for, aimed at an
  // attacker-chosen address instead of an unknown one: any owner account
  // (free to create via signup) could otherwise mail an arbitrary inbox as
  // fast as this action is invoked. Checked before pendingEmail is touched,
  // so a request inside the cooldown leaves no half-set state behind.
  if (await isWithinCooldown(userId, "EMAIL_CHANGE")) {
    return {
      error: "You already requested a change recently. Wait a minute and try again.",
    };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      pendingEmail: parsed.data.newEmail,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  // issueToken supersedes any earlier EMAIL_CHANGE token for this user, which
  // is what makes requesting a new change also cancel a prior one.
  const raw = await issueToken(userId, "EMAIL_CHANGE");
  const { subject, html } = changeEmailEmail(
    appUrl(`/account/change-email/${raw}`),
  );
  await sendEmail({ to: parsed.data.newEmail, subject, html });

  // The only signal the real owner gets if someone with a stolen session is
  // moving their account elsewhere, sent while they can still react.
  if (user.email) {
    const warning = emailChangeWarningEmail(parsed.data.newEmail);
    await sendEmail({ to: user.email, subject: warning.subject, html: warning.html });
  }

  revalidatePath("/account");
}

// Requesting a new change already supersedes a prior one (issueToken marks
// the earlier token consumed), so this exists only for the case where the
// owner wants to back out without picking a replacement address.
export async function cancelEmailChange() {
  const { userId } = await requireOwner();

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { pendingEmail: null } }),
    prisma.token.updateMany({
      where: { userId, purpose: "EMAIL_CHANGE", consumedAt: null },
      data: { consumedAt: new Date() },
    }),
  ]);

  revalidatePath("/account");
}

export async function resendVerification() {
  const { userId } = await requireOwner();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.email || user.emailVerifiedAt) return;

  // Lower risk than the email-change cooldown, since this only ever mails the
  // account's own address rather than one an attacker picks — but the same
  // shape of abuse (a button mashed as fast as the click handler allows)
  // applies, so it gets the same throttle.
  if (await isWithinCooldown(userId, "EMAIL_VERIFICATION")) return;

  const raw = await issueToken(userId, "EMAIL_VERIFICATION");
  const { subject, html } = verifyEmailEmail(appUrl(`/verify-email/${raw}`));
  await sendEmail({ to: user.email, subject, html });
  revalidatePath("/account");
}

export type ResetLinkState = { error?: string; sent?: boolean } | undefined;

/**
 * Emails the signed-in owner a password reset link.
 *
 * This is how someone who has forgotten their current password changes it
 * without knowing it. It deliberately goes through the inbox rather than
 * letting a session set a new password directly: a stolen session must not be
 * enough to take the account, which is the same reason changePassword demands
 * the current password.
 */
export async function emailMyResetLink(): Promise<ResetLinkState> {
  const { userId } = await requireOwner();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.email) return { error: "This account has no email address." };

  if (await isWithinCooldown(userId, "PASSWORD_RESET")) {
    // Report it plainly here, unlike the public form: the caller is already
    // authenticated, so there is no account to reveal the existence of.
    return { error: "A link was just sent. Check your inbox, or try again in a minute." };
  }

  const raw = await issueToken(userId, "PASSWORD_RESET");
  const { subject, html } = resetPasswordEmail(appUrl(`/reset-password/${raw}`));
  const ok = await sendEmail({ to: user.email, subject, html });

  return ok
    ? { sent: true }
    : { error: "We could not send the email just now. Try again shortly." };
}
