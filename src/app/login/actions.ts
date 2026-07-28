"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySecret } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { isLocked, lockoutMessage, nextLockoutState } from "@/lib/auth/lockout";

export type AuthFormState = { error?: string } | undefined;

// Deliberately identical whether the email is unknown or the password is
// wrong, so the form cannot be used to discover which accounts exist.
const GENERIC_ERROR = "Invalid email or password.";

const LoginSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(1),
});

export async function login(
  _state: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC_ERROR };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (!user || user.role !== "OWNER" || !user.passwordHash || !user.active) {
    return { error: GENERIC_ERROR };
  }

  if (isLocked(user)) return { error: lockoutMessage(user.lockedUntil!) };

  if (!(await verifySecret(user.passwordHash, parsed.data.password))) {
    const next = nextLockoutState(user.failedAttempts);
    await prisma.user.update({ where: { id: user.id }, data: next });
    return next.lockedUntil
      ? { error: lockoutMessage(next.lockedUntil) }
      : { error: GENERIC_ERROR };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null },
  });
  await createSession(user.id, user.role);
  redirect("/dashboard");
}
