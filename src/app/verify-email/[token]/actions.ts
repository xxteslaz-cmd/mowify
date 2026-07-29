"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { consumeToken } from "@/lib/auth/token";

export type ConfirmState = { error?: string } | undefined;

const EXPIRED =
  "That link is no longer valid. Send a new one from your account page.";

const ConfirmSchema = z.object({ token: z.string().min(1) }).strict();

/**
 * Consuming happens here rather than while rendering the page.
 *
 * A verification link sits in an inbox for up to seven days, and corporate mail
 * scanners fetch every URL they see. If a GET burned the token, the scanner
 * would consume it and the human would arrive to find their own link expired.
 * A POST is not something a scanner performs, so the token survives until a
 * person actually clicks.
 */
export async function confirmEmail(
  _state: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const parsed = ConfirmSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) return { error: EXPIRED };

  const claimed = await consumeToken(parsed.data.token, "EMAIL_VERIFICATION");
  if (!claimed) return { error: EXPIRED };

  await prisma.user.update({
    where: { id: claimed.userId },
    data: { emailVerifiedAt: new Date() },
  });

  redirect("/dashboard");
}
