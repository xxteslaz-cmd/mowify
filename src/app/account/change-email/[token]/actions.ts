"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { consumeToken } from "@/lib/auth/token";
import {
  readSessionToken,
  deleteOtherSessionsForUser,
  deleteAllSessionsForUser,
} from "@/lib/auth/session";
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

      // Not re-checked with a separate SELECT — the unique constraint on
      // `email` is what actually guards this. If another signup claimed the
      // address in the hour since the request, this update is the write that
      // hits it, and the resulting P2002 is caught below.
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
      // The transaction above rolled back entirely, so pendingEmail is still
      // set to the address that just lost the uniqueness race. Left alone,
      // /account would keep showing a "confirm to finish" banner for a change
      // that can never complete with this (now-consumed) token.
      await prisma.user.update({
        where: { id: claimed.userId },
        data: { pendingEmail: null },
      });
      return { error: TAKEN };
    }

    throw err;
  }

  // If the change was made by an attacker who guessed or leaked the current
  // password, the owner's other sessions should not survive it — same
  // reasoning as changePassword. Unlike changePassword, though, the
  // confirming request usually has no session of its own: this link is
  // emailed to the NEW address, normally opened on a different device than
  // the one signed in as the owner (the same reason this route is public).
  // With no acting session to spare, every session is dropped instead of
  // none — a stolen-session attacker's own session included.
  const current = await readSessionToken();
  if (current) {
    await deleteOtherSessionsForUser(claimed.userId, current);
  } else {
    await deleteAllSessionsForUser(claimed.userId);
  }

  redirect("/account");
}
