import "server-only";
import { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "./cookie";

export { SESSION_COOKIE };

const OWNER_DURATION = 7 * 24 * 60 * 60 * 1000;
const CREW_DURATION = 30 * 24 * 60 * 60 * 1000;

export function sessionDuration(role: Role): number {
  return role === "CREW" ? CREW_DURATION : OWNER_DURATION;
}

/**
 * The database stores only this hash, never the token in the cookie, so a
 * leaked database dump yields no usable sessions.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, role: Role): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDuration(role));

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function readSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function deleteSession(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Used when an owner deactivates a crew login or resets a PIN, so the change
 * takes effect on the crew member's phone immediately rather than whenever
 * their session happens to expire.
 */
export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/**
 * Signs a user out everywhere except the session performing the action.
 *
 * Used when changing a password: everywhere else should stop working, but the
 * tab doing the changing should not sign itself out mid-flow.
 */
export async function deleteOtherSessionsForUser(
  userId: string,
  keepRawToken: string,
): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId, tokenHash: { not: hashToken(keepRawToken) } },
  });
}
