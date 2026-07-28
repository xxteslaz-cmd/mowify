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
import type { AuthFormState } from "@/app/login/actions";

const GENERIC_ERROR = "Invalid username or PIN.";

// Same reason as the owner login: a lookup that fails must cost the same as a
// real verify, or response time reveals which usernames exist at this company.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$g/qLVPxezmWcQ0xub5ukdA$VqAz2iXCTfcFDl7DwmXIsmfv9+KlUQYPbweegC3JgLs";

const CrewLoginSchema = z.object({
  orgId: z.string().min(1),
  username: z.string().min(1).trim().toLowerCase(),
  pin: z.string().regex(/^\d{6}$/),
});

export async function crewLogin(
  _state: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = CrewLoginSchema.safeParse({
    orgId: formData.get("orgId"),
    username: formData.get("username"),
    pin: formData.get("pin"),
  });
  if (!parsed.success) return { error: GENERIC_ERROR };

  const user = await prisma.user.findUnique({
    where: {
      orgId_username: {
        orgId: parsed.data.orgId,
        username: parsed.data.username,
      },
    },
  });

  // crewId is checked here too: the column is nullable, and a CREW row without
  // one would otherwise authenticate and then land on /crew/null/today. A data
  // anomaly should fail closed, not sign someone into a dead end.
  if (
    !user ||
    user.role !== "CREW" ||
    !user.pinHash ||
    !user.active ||
    !user.crewId
  ) {
    await verifySecret(DUMMY_HASH, parsed.data.pin);
    return { error: GENERIC_ERROR };
  }

  if (isLocked(user)) return { error: lockoutMessage(user.lockedUntil!) };

  if (!(await verifySecret(user.pinHash, parsed.data.pin))) {
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
  redirect(`/crew/${user.crewId}/today`);
}
