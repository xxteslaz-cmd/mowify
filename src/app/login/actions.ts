"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySecret } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  isLocked,
  lockoutMessage,
  nextLockoutState,
  priorFailures,
} from "@/lib/auth/lockout";

export type AuthFormState = { error?: string } | undefined;

// Deliberately identical whether the email is unknown or the password is
// wrong, so the form cannot be used to discover which accounts exist.
const GENERIC_ERROR = "Invalid email or password.";

// A real argon2id hash of a random value, used only to spend the same time on
// a failed lookup as on a real verify. Without it, an unknown email returns in
// under a millisecond while a real account takes ~17ms — enough of a signal to
// enumerate which emails are registered.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$g/qLVPxezmWcQ0xub5ukdA$VqAz2iXCTfcFDl7DwmXIsmfv9+KlUQYPbweegC3JgLs";

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
    await verifySecret(DUMMY_HASH, parsed.data.password);
    return { error: GENERIC_ERROR };
  }

  if (isLocked(user)) return { error: lockoutMessage(user.lockedUntil!) };

  if (!(await verifySecret(user.passwordHash, parsed.data.password))) {
    const next = nextLockoutState(priorFailures(user));
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
