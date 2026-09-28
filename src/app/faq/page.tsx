import type { Metadata } from "next";
import Link from "next/link";
import { COMMON_FAQS, QUESTION_MAX, getPublishedQuestions, type Faq } from "@/lib/faq";
import AskQuestionForm from "./AskQuestionForm";

export const metadata: Metadata = {
  title: "Questions",
  alternates: { canonical: "/faq" },
  description:
    "Answers about GroundsRoute: pricing, the free trial, cancelling, how crews use it on their phones, and your data.",
};

// Prerendered and served from the CDN like the other public pages, and
// rebuilt at most hourly. Publishing an answer on /admin/questions also calls
// revalidatePath("/faq"), so in practice the hour is only a backstop.
export const revalidate = 3600;

async function publishedOrNone(): Promise<Faq[]> {
  // The fixed questions above are the page's real content, so a database
  // problem should cost the visitor the community answers, not the whole
  // page. That includes a build or deploy that runs before the FaqQuestion
  // table exists — see "FAQ questions" in AGENTS.md for the rollout order.
  try {
    return await getPublishedQuestions();
  } catch (err) {
    console.error(
      "FAQ: could not load published questions:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface">
      {items.map((faq) => (
        // <details> gives an accessible disclosure with no client JavaScript,
        // and keeps every answer in the HTML for search engines to read.
        <details key={faq.question} className="group px-5 py-4">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-medium text-foreground">
            <span>{faq.question}</span>
            <span aria-hidden className="mt-0.5 text-muted transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">
            {faq.answer}
          </p>
        </details>
      ))}
    </div>
  );
}

export default async function FaqPage() {
  const published = await publishedOrNone();

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Link
        href="/"
        className="tap-target text-sm text-muted underline underline-offset-4 hover:text-foreground"
      >
        ← GroundsRoute
      </Link>

      <h1 className="mt-8 text-2xl font-semibold">Questions</h1>
      <p className="mt-2 text-sm text-muted">
        The things landscaping owners ask most before they start. Don&apos;t
        see yours? Ask it at the bottom of the page.
      </p>

      <FaqList items={COMMON_FAQS} />

      {published.length > 0 && (
        <section aria-labelledby="asked-heading" className="mt-12">
          <h2 id="asked-heading" className="text-lg font-semibold">
            Asked by visitors
          </h2>
          <FaqList items={published} />
        </section>
      )}

      <section aria-labelledby="ask-heading" className="card mt-12 p-6">
        <h2 id="ask-heading" className="text-lg font-semibold">
          Ask a question
        </h2>
        <p className="mt-1 text-sm text-muted">
          We read every one. Useful answers get added to this page, without
          your name or email.
        </p>
        <div className="mt-5">
          <AskQuestionForm maxLength={QUESTION_MAX} />
        </div>
      </section>

      <p className="mt-10 text-center text-sm text-muted">
        Ready to try it?{" "}
        <Link href="/signup" className="underline underline-offset-4 hover:text-foreground">
          Start your free trial
        </Link>{" "}
        or{" "}
        <Link href="/pricing" className="underline underline-offset-4 hover:text-foreground">
          see pricing
        </Link>
        .
      </p>
    </div>
  );
}
