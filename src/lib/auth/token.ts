import "server-only";
import { randomBytes } from "crypto";
import type { TokenPurpose } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashToken } from "./session";

export const RESET_TOKEN_MS = 60 * 60 * 1000;
export const VERIFICATION_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;
// One cooldown window, shared by every purpose: whichever address a token
// gets emailed to, the abuse it prevents is the same shape — a script driving
// unlimited mail at that inbox as fast as the request can be repeated.
export const TOKEN_COOLDOWN_MS = 60 * 1000;

export function tokenLifetime(purpose: TokenPurpose): number {
  // EMAIL_CHANGE gets the same short lifetime as PASSWORD_RESET: it moves a
  // security-critical value, so it is treated as a credential rather than the
  // more forgiving week-long verification link.
  return purpose === "PASSWORD_RESET" || purpose === "EMAIL_CHANGE"
    ? RESET_TOKEN_MS
    : VERIFICATION_TOKEN_MS;
}

/**
 * Issues a token and returns the RAW value — the only moment it exists outside
 * the email. Only its hash is stored, so a database leak yields nothing usable.
 *
 * Prior unconsumed tokens of the same purpose are marked consumed rather than
 * deleted, so the older emailed link stops working while its createdAt still
 * survives for the cooldown check.
 */
export async function issueToken(
  userId: string,
  purpose: TokenPurpose,
): Promise<string> {
  await prisma.token.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const raw = randomBytes(32).toString("base64url");
  await prisma.token.create({
    data: {
      tokenHash: hashToken(raw),
      purpose,
      userId,
      expiresAt: new Date(Date.now() + tokenLifetime(purpose)),
    },
  });
  return raw;
}

/**
 * Redeems a token, or returns null if it is unknown, expired, already used, or
 * issued for a different purpose.
 *
 * The purpose is part of the lookup, not an afterthought: without it a
 * seven-day verification token would work as a password-reset token.
 */
/**
 * The single definition of what makes a token usable.
 *
 * Both `consumeToken` and the two pages that render a token's form go through
 * here, so a page can never disagree with the action about whether a link is
 * still good. Three hand-written copies of this predicate would drift the
 * moment anything is added to it.
 *
 * Read-only on purpose: a page must be able to check a token without spending
 * it, because mail scanners fetch every URL they find in an inbox.
 */
export async function findValidToken(
  raw: string,
  purpose: TokenPurpose,
): Promise<{ id: string; userId: string } | null> {
  return prisma.token.findFirst({
    where: {
      tokenHash: hashToken(raw),
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, userId: true },
  });
}

export async function consumeToken(
  raw: string,
  purpose: TokenPurpose,
): Promise<{ userId: string } | null> {
  const token = await findValidToken(raw, purpose);
  if (!token) return null;

  // Stamping by id with consumedAt still null makes redemption atomic: two
  // simultaneous clicks on the same link cannot both succeed.
  const claimed = await prisma.token.updateMany({
    where: { id: token.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  return { userId: token.userId };
}

/**
 * Anyone who can invoke the request action can do so repeatedly, so without
 * this it is an email-bomb aimed at whatever inbox the caller names — an
 * unknown address for a password reset, or an attacker-chosen one for an
 * email change. Purpose-scoped so a burst of password resets does not also
 * throttle an unrelated email-change request for the same user, or vice
 * versa.
 */
export async function isWithinCooldown(
  userId: string,
  purpose: TokenPurpose,
): Promise<boolean> {
  const recent = await prisma.token.findFirst({
    where: {
      userId,
      purpose,
      createdAt: { gt: new Date(Date.now() - TOKEN_COOLDOWN_MS) },
    },
  });
  return recent !== null;
}
