"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { consumeToken } from "@/lib/auth/token";
import { readSessionToken, deleteOtherSessionsForUser } from "@/lib/auth/session";
import { p2002Fields } from "@/lib/prisma-errors";

export type ConfirmState = { error?: string } | undefined;

const EXPIRED =
  "That link is no longer valid. Request a new one from your account page.";

const TAKEN =
  "That email was claimed by another account while this link was pending.";

const ConfirmSchema = z.object({ token: z.string().min(1) }).strict();

// Thrown only to unwind out of the transaction below and land on the same
// EXPIRED message as every other invalid-token case. It never crosses the
// action boundary — the outer catch turns it back into returned state,
// consistent with every other action in this codebase not throwing to the
// client.
class NoPendingChangeError extends Error {}

/**
 * Consuming happens here rather than while rendering the page, for the same
 * reason as /verify-email: a mail scanner fetches every URL in an inbox, and
 * a GET must not be able to burn a link before its owner clicks it.
 */
export async function confirmEmailChange(
  _state: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const parsed = ConfirmSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) return { error: EXPIRED };

  const claimed = await consumeToken(parsed.data.token, "EMAIL_CHANGE");
  if (!claimed) return { error: EXPIRED };

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: claimed.userId },
      });

      // A cancellation could in principle race this submission and clear
      // pendingEmail after consumeToken above already claimed the token but
      // before this read. Treat that the same as an expired link rather than
      // writing null over whatever email the account already has.
      if (!user.pendingEmail) throw new NoPendingChangeError();

      // Re-checked here, inside the transaction, rather than trusted from
      // request time: another signup could have taken this address in the
      // hour since. The unique constraint on `email` is the real backstop —
      // this update is what exercises it.
      await tx.user.update({
        where: { id: claimed.userId },
        data: {
          email: user.pendingEmail,
          pendingEmail: null,
          // The new address has just proven receipt of the confirmation
          // link, so it starts verified rather than making the owner confirm
          // it a second time.
          emailVerifiedAt: new Date(),
        },
      });
    });
  } catch (err) {
    if (err instanceof NoPendingChangeError) return { error: EXPIRED };

    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      p2002Fields(err).includes("email")
    ) {
      return { error: TAKEN };
    }

    throw err;
  }

  // If the change was made by an attacker who guessed or leaked the current
  // password, the owner's other sessions should not survive it — same
  // reasoning and same pattern as changePassword. When the confirming browser
  // has no session of its own (the common case: the link is opened from the
  // new address's inbox on a different device), there is no "other" to spare.
  const current = await readSessionToken();
  if (current) await deleteOtherSessionsForUser(claimed.userId, current);

  redirect("/account");
}
