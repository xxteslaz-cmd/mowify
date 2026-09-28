"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSiteAdmin } from "@/lib/auth/admin";
import { ANSWER_MAX, QUESTION_MAX } from "@/lib/faq";

export type SaveState = { ok: string } | { error: string } | undefined;

// .strict() for the reason AGENTS.md gives: a Server Action's parameter types
// are erased at runtime, so only an allow-list decides what reaches Prisma.
const SaveSchema = z
  .object({
    id: z.string().min(1).max(64),
    question: z.string().trim().min(5).max(QUESTION_MAX),
    // Blank means "no answer yet", not an empty answer.
    answer: z
      .string()
      .trim()
      .max(ANSWER_MAX)
      .transform((v) => (v === "" ? null : v)),
    // An unticked checkbox submits nothing at all, so the check is for the
    // literal "on" rather than for false.
    publish: z.literal("on").optional(),
  })
  .strict();

/**
 * Saves the admin's edits to one question: its wording, the answer, and
 * whether it appears on /faq.
 *
 * The question text is editable because it is published as asked, and a
 * visitor may have put their name, phone number or a typo in it.
 */
export async function saveQuestion(
  _state: SaveState,
  formData: FormData,
): Promise<SaveState> {
  // First, before reading anything the caller sent: every action here checks
  // for itself rather than trusting that the page it lives on already did.
  await requireSiteAdmin();

  const parsed = SaveSchema.safeParse({
    id: formData.get("id") ?? "",
    question: formData.get("question") ?? "",
    answer: formData.get("answer") ?? "",
    publish: formData.get("publish") ?? undefined,
  });
  if (!parsed.success) {
    return { error: `Questions need 5–${QUESTION_MAX} characters, answers at most ${ANSWER_MAX}.` };
  }

  const { id, question, answer } = parsed.data;
  const publish = parsed.data.publish === "on";
  if (publish && !answer) {
    return { error: "Write an answer before publishing." };
  }

  const existing = await prisma.faqQuestion.findUnique({
    where: { id },
    select: { answeredAt: true },
  });
  if (!existing) return { error: "That question no longer exists." };

  await prisma.faqQuestion.update({
    where: { id },
    data: {
      question,
      answer,
      published: publish,
      // Kept from the first answer so an edit doesn't reshuffle /faq, which
      // lists published answers newest first.
      answeredAt: answer ? (existing.answeredAt ?? new Date()) : null,
    },
  });

  revalidatePath("/faq");
  revalidatePath("/admin/questions");
  return { ok: publish ? "Saved and published." : "Saved. Not shown on the FAQ." };
}

const DeleteSchema = z.object({ id: z.string().min(1).max(64) }).strict();

/** Removes a question for good — spam, or one the asker wants deleted. */
export async function deleteQuestion(formData: FormData): Promise<void> {
  await requireSiteAdmin();

  const parsed = DeleteSchema.safeParse({ id: formData.get("id") ?? "" });
  if (!parsed.success) return;

  // deleteMany rather than delete: a double-click or a second tab deleting the
  // same row is a no-op, not an unhandled "record not found".
  await prisma.faqQuestion.deleteMany({ where: { id: parsed.data.id } });

  revalidatePath("/faq");
  revalidatePath("/admin/questions");
}
