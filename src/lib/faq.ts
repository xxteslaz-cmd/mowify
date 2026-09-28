import "server-only";
import { prisma } from "@/lib/prisma";
import { RETENTION } from "@/lib/legal";
import { PRICE, TRIAL_DAYS, formatPrice, pricePerInterval } from "@/lib/pricing";

export type Faq = { question: string; answer: string };

/**
 * The questions answered up front on /faq.
 *
 * Every answer here describes what the software does today, and every figure
 * is read from the constant the software itself reads — the price and trial
 * from pricing.ts, the retention window from legal.ts. An FAQ is a published
 * promise just like the Terms: if a feature changes, change its answer in the
 * same commit.
 */
export const COMMON_FAQS: Faq[] = [
  {
    question: "How much does GroundsRoute cost?",
    answer:
      `${pricePerInterval()}, for one plan with everything in it. There is no setup fee, ` +
      `no charge per crew or per user, and no annual contract. Customers, jobs and crews are unlimited.`,
  },
  {
    question: "Why do you need a card for the free trial?",
    answer:
      `The trial is ${TRIAL_DAYS} days and costs nothing. A card is required to start it, and ` +
      `unless you cancel before the trial ends your subscription starts automatically and your ` +
      `card is charged ${formatPrice()} per ${PRICE.interval}. We email you a reminder at least ` +
      `7 days before the trial ends. Cancel before then and you are never charged.`,
  },
  {
    question: "How do I cancel?",
    answer:
      "From your billing page, in a few clicks. You don't need to email or call anyone.",
  },
  {
    question: "Do my crews need to install an app?",
    answer:
      "No. Crews open a web page on their phone's browser. Each crew signs in at your company's " +
      "own link with a username and a 6-digit PIN that you create for them, so they don't need " +
      "an email address. You can change or revoke their logins at any time.",
  },
  {
    question: "What does a crew see on their phone?",
    answer:
      "Only their own stops for the day, in the order you set. Each stop shows the customer, the " +
      "address (tap it to open Google Maps), the phone number and your notes, with a button to " +
      "mark it complete. Completed stops are marked done on your board too.",
  },
  {
    question: "Does GroundsRoute plan the fastest route?",
    answer:
      "No. You set the order of each crew's stops yourself, and GroundsRoute keeps that order. " +
      "Most owners already know which order makes sense for their area.",
  },
  {
    question: "How do recurring jobs work?",
    answer:
      "Set a job to repeat weekly, every two weeks or monthly, and the next visit is created " +
      "for you. A weekly mow never needs re-entering.",
  },
  {
    question: "Can I assign work to individual people instead of crews?",
    answer:
      "Yes. In Settings you can switch from crews to named employees. The board and the phone " +
      "view work the same way either way.",
  },
  {
    question: "Does it do invoicing or text my customers?",
    answer:
      "Not today. GroundsRoute is for scheduling your crews and getting each day's stops done. " +
      "If you need something it doesn't do, ask below. Questions like that shape what gets built next.",
  },
  {
    question: "Can I get my data out?",
    answer:
      "Yes. Settings has a button that downloads everything your company has entered " +
      `(customers, crews and jobs) as a file. If you cancel, you have ${RETENTION.accountDays} ` +
      "days to download it before your data is deleted.",
  },
  {
    question: "Can other companies see my customers?",
    answer:
      "No. Every company's records are kept separate, and every request is checked against the " +
      "company of the person signed in.",
  },
];

/** The longest question accepted from the public form. */
export const QUESTION_MAX = 1000;

/** The longest answer the admin page accepts. */
export const ANSWER_MAX = 5000;

/**
 * Flood limits on the public form. It is unauthenticated, so without these a
 * script could fill the table and the owner's inbox. They are site-wide rather
 * than per visitor because counting per visitor means storing IP addresses,
 * and the Privacy Policy does not say this form collects them.
 */
export const QUESTIONS_PER_HOUR = 20;
export const MAX_UNANSWERED = 200;

/**
 * The answered questions the owner chose to publish, newest first.
 *
 * The asker's email is deliberately not selected: this feeds a public page,
 * and a column that is never read cannot leak.
 */
export async function getPublishedQuestions(): Promise<Faq[]> {
  const rows = await prisma.faqQuestion.findMany({
    where: { published: true, answer: { not: null } },
    orderBy: { answeredAt: "desc" },
    select: { question: true, answer: true },
  });
  return rows.map((r) => ({ question: r.question, answer: r.answer ?? "" }));
}
