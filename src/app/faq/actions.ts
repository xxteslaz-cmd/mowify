"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendEmail, appUrl } from "@/lib/email/client";
import { newFaqQuestionEmail } from "@/lib/email/templates";
import { LEGAL } from "@/lib/legal";
import { MAX_UNANSWERED, QUESTIONS_PER_HOUR, QUESTION_MAX } from "@/lib/faq";

export type AskState = { ok: true } | { error: string } | undefined;

const AskSchema = z
  .object({
    question: z.string().trim().min(5).max(QUESTION_MAX),
    // An empty field arrives as "", which is "no email", not an invalid one.
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .transform((v) => (v === "" ? null : v))
      .pipe(z.email().nullable()),
    // The honeypot: a field hidden from people but filled in by form-spamming
    // bots, which fill in every input they find.
    website: z.string(),
  })
  .strict();

/**
 * Takes a question from the public FAQ page.
 *
 * Unauthenticated, so the only things it ever writes are the row itself and
 * one notification to our own fixed address. It never emails the address the
 * visitor typed: mailing an address taken from an anonymous form is how
 * signup once let anyone drive arbitrary recipients from our sending domain.
 */
export async function askQuestion(
  _state: AskState,
  formData: FormData,
): Promise<AskState> {
  const parsed = AskSchema.safeParse({
    question: formData.get("question") ?? "",
    email: formData.get("email") ?? "",
    website: formData.get("website") ?? "",
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      error:
        field === "email"
          ? "That email address doesn't look right. Leave it blank if you'd rather not give one."
          : `Please write a question between 5 and ${QUESTION_MAX} characters.`,
    };
  }

  // Report success to a bot so it has no signal to adapt to, and save nothing.
  if (parsed.data.website !== "") return { ok: true };

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [lastHour, unanswered] = await Promise.all([
    prisma.faqQuestion.count({ where: { createdAt: { gte: hourAgo } } }),
    prisma.faqQuestion.count({ where: { answer: null } }),
  ]);
  if (lastHour >= QUESTIONS_PER_HOUR || unanswered >= MAX_UNANSWERED) {
    return {
      error: `We can't take more questions right now. Please try again later, or email ${LEGAL.contactEmail}.`,
    };
  }

  await prisma.faqQuestion.create({
    data: { question: parsed.data.question, email: parsed.data.email },
  });

  // sendEmail never throws, and a failed notification must not fail the
  // visitor's submission: the question is saved and waiting either way.
  const { subject, html } = newFaqQuestionEmail(appUrl("/admin/questions"));
  await sendEmail({ to: LEGAL.contactEmail, subject, html });

  return { ok: true };
}
