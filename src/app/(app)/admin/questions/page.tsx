import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSiteAdmin } from "@/lib/auth/admin";
import { ANSWER_MAX, QUESTION_MAX } from "@/lib/faq";
import QuestionEditor from "./QuestionEditor";

export const metadata: Metadata = {
  title: "FAQ questions",
  robots: { index: false, follow: false },
};

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York",
});

/**
 * Where the people who run GroundsRoute answer questions asked on /faq.
 * Unanswered questions come first, oldest first, so nothing waits forever
 * behind newer arrivals.
 */
export default async function AdminQuestionsPage() {
  await requireSiteAdmin();

  const rows = await prisma.faqQuestion.findMany({
    orderBy: [{ answeredAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
  });
  const waiting = rows.filter((r) => !r.answer).length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link
        href="/dashboard"
        className="tap-target text-sm text-muted underline underline-offset-4 hover:text-foreground"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-6 text-2xl font-semibold">FAQ questions</h1>
      <p className="mt-1 text-sm text-muted">
        {waiting === 0
          ? "Nothing waiting for an answer."
          : `${waiting} waiting for an answer.`}{" "}
        Published answers appear on{" "}
        <Link href="/faq" className="underline underline-offset-4">
          the FAQ page
        </Link>{" "}
        within a few seconds.
      </p>

      <div className="mt-8 space-y-6">
        {rows.map((r) => (
          <QuestionEditor
            key={r.id}
            q={{
              id: r.id,
              question: r.question,
              email: r.email,
              answer: r.answer,
              published: r.published,
              askedOn: DATE.format(r.createdAt),
            }}
            questionMax={QUESTION_MAX}
            answerMax={ANSWER_MAX}
          />
        ))}
      </div>
    </div>
  );
}
