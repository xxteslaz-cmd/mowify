import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  hashToken,
  readSessionToken,
  sessionDuration,
} from "./session";

export type SessionUser = {
  userId: string;
  orgId: string;
  role: Role;
  crewId: string | null;
  name: string;
};

/**
 * Resolves the current user, or null when signed out.
 *
 * Wrapped in React's cache so a render pass costs one query no matter how many
 * data functions call it.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Clear it out on encounter rather than accumulating dead rows.
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  // A deactivated crew member keeps their cookie until it expires, so the
  // active flag has to be checked on every request, not only at login.
  if (!session.user.active) return null;

  await refreshIfStale(session.id, session.expiresAt, session.user.role, token);

  return {
    userId: session.user.id,
    orgId: session.user.orgId,
    role: session.user.role,
    crewId: session.user.crewId,
    name: session.user.name,
  };
});

/**
 * Sliding expiry, extended only past the halfway mark so an active user is
 * never logged out mid-route without writing on every single request.
 */
async function refreshIfStale(
  sessionId: string,
  expiresAt: Date,
  role: Role,
  token: string,
): Promise<void> {
  const duration = sessionDuration(role);
  const remaining = expiresAt.getTime() - Date.now();
  if (remaining > duration / 2) return;

  const next = new Date(Date.now() + duration);

  try {
    await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: next },
    });
  } catch {
    // The session can be deleted concurrently — a second tab, or a sign-out on
    // another device — between the lookup above and this write. Losing a
    // refresh is harmless; throwing here would 500 an otherwise fine page.
    return;
  }

  // Only Server Actions and Route Handlers may write cookies. During a page
  // render cookies() is read-only and set() throws, so this has to be allowed
  // to fail. The database row is the authority on whether a session is still
  // valid, so extending it is the part that matters; the cookie catches up the
  // next time the user performs a mutation, which in this app is constant.
  try {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: next,
      path: "/",
    });
  } catch {
    // Rendering a page cannot refresh the cookie. Not an error.
  }
}

export async function verifySession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireOwner(): Promise<SessionUser> {
  const user = await verifySession();
  if (user.role !== "OWNER") redirect("/login");
  return user;
}

export async function requireCrew(): Promise<SessionUser> {
  const user = await verifySession();
  if (user.role !== "CREW") redirect("/login");
  return user;
}
