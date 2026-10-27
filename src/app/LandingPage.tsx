import Link from "next/link";
import { ViewTransition } from "react";
import Image, { getImageProps, type StaticImageData } from "next/image";
import dashboardLight from "@/assets/product/dashboard-light.png";
import dashboardDark from "@/assets/product/dashboard-dark.png";
import crewLight from "@/assets/product/crew-light.png";
import crewDark from "@/assets/product/crew-dark.png";
import featureRecurring from "@/assets/product/feature-recurring.png";
import featureStopOrder from "@/assets/product/feature-stop-order.png";
import featureRain from "@/assets/product/feature-rain.png";
import featureCrews from "@/assets/product/feature-crews.png";
import { LEGAL } from "@/lib/legal";
import { TRIAL_DAYS, formatPrice, PRICE } from "@/lib/pricing";

// The one-line offer under each call to action. Read from pricing.ts rather
// than typed here for the reason that file gives: the number appears in the
// Terms, the reminder email and the pricing page, and a copy that lives in
// marketing prose is the one nobody remembers to update.
const OFFER = `${TRIAL_DAYS} days free, then ${formatPrice()}/${PRICE.interval}. One plan with every feature, and no extra charge for more users.`;

// Real screenshots of the app, taken from a seeded demo company (made-up
// customers and addresses), never from a live account. Retake them whenever
// the dashboard or crew page changes visibly, or the page is advertising a
// product that no longer exists.
function ThemePicture({
  light,
  dark,
  alt,
  sizes,
  className,
  priority = false,
}: {
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  sizes: string;
  className?: string;
  /** Only the largest image above the fold, which is what LCP measures. */
  priority?: boolean;
}) {
  // A <picture> rather than two <Image>s toggled with CSS: the browser picks
  // one source and downloads only that, so the hero shot can load eagerly
  // without costing every visitor both themes. Per the next/image docs, two
  // eager <Image>s would both load.
  //
  // Both shots are above the fold, so both load eagerly, but only the one
  // passed priority is fetched at high priority. Two high-priority images
  // compete for the same early bandwidth, and the small phone frame would
  // slow down the dashboard shot that the browser scores as the page's
  // largest paint.
  const common = {
    alt,
    sizes,
    fetchPriority: priority ? ("high" as const) : ("auto" as const),
    loading: "eager" as const,
  };
  const {
    props: { srcSet: darkSrcSet },
  } = getImageProps({ ...common, src: dark });
  // The light image is the <img> itself, so it is also what any browser
  // that ignores prefers-color-scheme gets.
  const { props: lightProps } = getImageProps({ ...common, src: light });
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={darkSrcSet} />
      <img {...lightProps} alt={alt} className={className} />
    </picture>
  );
}

// The day board from the dashboard shot, cropped past the sidebar and month
// calendar to the crew columns. The source is 1600x1200 and the columns sit in
// x 300-1600, y 540-1200, so the image is drawn at 1600/1300 of the frame's
// width and pinned bottom-right. Retake the screenshot and this crop has to be
// re-measured.
function BoardShot() {
  return (
    <div className="relative aspect-[1300/660] overflow-hidden rounded-xl border border-foreground/20 bg-surface shadow-2xl">
      <ThemePicture
        light={dashboardLight}
        dark={dashboardDark}
        alt="The GroundsRoute day board: one column per crew, each listing that day's stops in order, with finished stops marked completed."
        sizes="(min-width: 1024px) 1260px, 124vw"
        className="absolute bottom-0 right-0 h-auto w-[123.1%] max-w-none"
        priority
      />
    </div>
  );
}

// The crew's view, framed as a phone. Shown at a size where the stop details
// can actually be read, rather than as a thumbnail laid over the board.
function PhoneShot() {
  return (
    <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-[2rem] border-[8px] border-foreground bg-foreground shadow-2xl">
      <ThemePicture
        light={crewLight}
        dark={crewDark}
        alt="A crew's phone view of the same day: their stops in order, each with the address, phone number, customer notes and a Mark Complete button."
        sizes="320px"
        className="aspect-[9/14] w-full rounded-[1.5rem] object-cover object-top"
      />
    </div>
  );
}

const FEATURES = [
  {
    title: "Recurring jobs schedule themselves",
    body: "Set a job to repeat weekly, every two weeks or monthly, and the next visit lands on the board for you. A weekly mow never needs re-entering.",
    image: featureRecurring,
    alt: "The job form's frequency picker: One-time, Weekly, Bi-weekly or Monthly.",
  },
  {
    title: "Stops in the order you set",
    body: "You put each crew's stops in the order that makes sense for your area, and their phone shows them in that order. GroundsRoute doesn't reshuffle them.",
    image: featureStopOrder,
    alt: "A crew's column with two stops, and up and down arrows to change their order.",
  },
  {
    title: "Rain days in one tap",
    body: "Add your ZIP code and the board warns you when rain is in the forecast. One tap moves the day's remaining jobs to the next working day, and crew phones update right away.",
    image: featureRain,
    alt: "The dashboard calendar above a rain forecast banner with a button to push the day's jobs.",
  },
  {
    title: "Every job has a crew",
    body: "Assign each job to a crew, or to a named employee if that's how you run things. Move a job to another crew and it moves on their phones too.",
    image: featureCrews,
    alt: "The dashboard board with a column for each of three crews, under the Add Job, Select & reschedule and Manage Crews buttons.",
  },
];

const STEPS = [
  "Add your customers.",
  "Build the day on your board.",
  "Crews open their phone to just their stops.",
];

const INCLUDED = [
  "Every feature included",
  "No extra charge for more users",
  "No card needed to start",
  "Cancel any time",
];

// Answers describe what the app does today; keep them in step with
// src/lib/faq.ts, which answers some of the same questions on /faq.
const FAQS = [
  {
    question: "Does it work for a 2-person crew?",
    answer:
      "Yes. A crew is whoever you send out together, one person or ten. You can also switch to named employees in Settings. The price is the same however many people you add.",
  },
  {
    question: "What happens when it rains?",
    answer:
      "If the forecast for your ZIP code calls for rain, a banner on your board offers to move the day's remaining jobs to the next working day in one tap. You can also call a rain day yourself when the forecast gets it wrong. Crew phones show the new schedule right away.",
  },
  {
    question: "Do crews need to download an app?",
    answer:
      "No. Crews open a web page on their phone's browser and sign in with a username and a 6-digit PIN that you create for them, so they don't need an email address.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Cancel from your billing page in a few clicks. You don't need to email or call anyone.",
  },
];

/**
 * Rendered at `/` for visitors with no session cookie, prerendered by
 * page.tsx. A signed-in visitor is rewritten by src/proxy.ts to home/page.tsx,
 * which sends them to their dashboard or day view instead.
 */
export default function LandingPage() {
  // The ViewTransition gives a short crossfade when a visitor leaves this
  // page for signup, sign-in or pricing, or comes back to it. Next runs
  // route changes as React transitions, so no other wiring is needed; a
  // browser without the View Transitions API just navigates instantly.
  return (
    <ViewTransition>
      <div className="landing">
          <section className="hero-gradient border-b border-border">
            <header>
              <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
                <Link href="/" className="inline-flex min-h-11 items-center text-lg font-semibold text-foreground">
                  GroundsRoute
                </Link>
                <div className="flex items-center gap-4 text-sm text-muted sm:gap-6">
                  <a href="#pricing" className="inline-flex min-h-11 items-center hover:text-foreground">
                    Pricing
                  </a>
                  <a href="#faq" className="inline-flex min-h-11 items-center hover:text-foreground">
                    FAQ
                  </a>
                  <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-foreground hover:text-brand">
                    Sign in
                  </Link>
                </div>
              </nav>
            </header>
            <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 md:pt-16 lg:px-8">
              <div className="grid items-center gap-12 lg:grid-cols-[1fr_auto]">
                <div className="max-w-xl">
                  <h1 className="text-display font-semibold text-balance text-foreground">
                    The day, planned on one board.
                  </h1>
                  <p className="mt-4 text-lg text-foreground/80">
                    GroundsRoute is crew scheduling for small landscaping companies.
                    Build the day once on your board, and every crew opens their
                    phone to just their stops.
                  </p>
                  <div className="mt-8">
                    <Link href="/signup" className="btn btn-primary btn-lg">
                      Start your free trial
                    </Link>
                  </div>
                  <p className="mt-3 text-sm text-muted">
                    {OFFER} No card needed. Cancel any time.{" "}
                    <a href="#pricing" className="whitespace-nowrap underline underline-offset-4 hover:text-foreground">
                      See pricing
                    </a>
                  </p>
                </div>
                <PhoneShot />
              </div>
              <div className="mt-12">
                <BoardShot />
              </div>
            </div>
          </section>

          <section aria-labelledby="two-sides-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <h2 id="two-sides-heading" className="text-2xl font-semibold text-foreground">
              Two views, one schedule
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div className="card reveal p-6">
                <h3 className="text-lg font-semibold text-foreground">For the office</h3>
                <p className="mt-2 text-sm text-muted">
                  Assign jobs to crews and set the order of each day&apos;s
                  stops. See every crew&apos;s schedule for the day or the month,
                  and keep every customer and their job history in one place.
                </p>
              </div>
              <div className="card reveal p-6">
                <h3 className="text-lg font-semibold text-foreground">For the crew</h3>
                <p className="mt-2 text-sm text-muted">
                  Each crew signs in at your company&apos;s own link with a
                  username and a 6-digit PIN, and sees just their stops for the
                  day, in order, with an address and a button to mark each one
                  complete.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="features-heading" className="border-t border-border">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
              <h2 id="features-heading" className="text-2xl font-semibold text-foreground">
                What it does
              </h2>
              <div className="mt-10 space-y-16">
                {FEATURES.map((f, i) => (
                  <div key={f.title} className="reveal grid items-center gap-8 md:grid-cols-2 md:gap-12">
                    <div className={i % 2 ? "md:order-2" : undefined}>
                      <h3 className="text-xl font-semibold text-foreground">{f.title}</h3>
                      <p className="mt-3 max-w-md text-muted">{f.body}</p>
                    </div>
                    {/* Dark-mode screenshots only, shown as-is in both themes. */}
                <Image
                  src={f.image}
                  alt={f.alt}
                  sizes="(min-width: 768px) 560px, 100vw"
                  className="w-full rounded-xl border border-foreground/20 shadow-xl"
                />
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section aria-labelledby="how-it-works-heading" className="border-t border-border bg-surface">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
              <h2 id="how-it-works-heading" className="text-2xl font-semibold text-foreground">
                How it works
              </h2>
              {/* list-style is suppressed for the visual design, which in some
                  browsers strips an ol's implicit list semantics for assistive
                  tech — role="list" restores it explicitly. */}
              <ol role="list" className="mt-8 grid list-none gap-6 sm:grid-cols-3">
                {STEPS.map((step, i) => (
                  <li key={step} className="reveal">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-on-brand">
                      {i + 1}
                    </span>
                    <p className="mt-3 text-foreground">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-4 border-t border-border">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
              <h2 id="pricing-heading" className="text-2xl font-semibold text-foreground">
                Pricing
              </h2>
              <div className="card reveal mt-8 max-w-md p-6">
                <p className="text-sm font-medium text-muted">One plan, one price for everything</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">
                  {formatPrice()}
                  <span className="text-base font-normal text-muted"> per {PRICE.interval}</span>
                </p>
                <p className="mt-2 text-sm text-muted">{TRIAL_DAYS}-day free trial.</p>
                <ul className="mt-6 space-y-2 text-sm">
                  {INCLUDED.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span aria-hidden className="mt-0.5 text-brand">
                        ✓
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="btn btn-primary mt-6 w-full">
                  Start your free trial
                </Link>
                <p className="mt-4 text-sm text-muted">
                  <Link href="/pricing" className="underline underline-offset-4 hover:text-foreground">
                    Full pricing details
                  </Link>
                </p>
              </div>
            </div>
          </section>

          <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-4 border-t border-border bg-surface">
            <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
              <h2 id="faq-heading" className="text-2xl font-semibold text-foreground">
                Questions
              </h2>
              <dl className="mt-8 space-y-6">
                {FAQS.map((q) => (
                  <div key={q.question} className="reveal">
                    <dt className="font-semibold text-foreground">{q.question}</dt>
                    <dd className="mt-1 text-muted">{q.answer}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-8 text-sm text-muted">
                <Link href="/faq" className="underline underline-offset-4 hover:text-foreground">
                  More questions and answers
                </Link>
              </p>
            </div>
          </section>

          <section aria-labelledby="about-heading" className="border-t border-border">
            <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
              <h2 id="about-heading" className="text-2xl font-semibold text-foreground">
                About
              </h2>
              <p className="mt-4 text-muted">
                GroundsRoute is built locally in the Harrisburg, PA area by Landen.
                {" "}TODO: one or two sentences on why you built it.
              </p>
              <p className="mt-4 text-muted">
                Questions? Email{" "}
                <a href={`mailto:${LEGAL.contactEmail}`} className="underline underline-offset-4 hover:text-foreground">
                  {LEGAL.contactEmail}
                </a>
                .
              </p>
            </div>
          </section>

          <section aria-labelledby="closing-cta-heading" className="border-t border-border">
            <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 lg:px-8">
              <h2 id="closing-cta-heading" className="text-2xl font-semibold text-foreground">
                Put your week on one board.
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted">
                {OFFER} No card needed to start. Add your crews and
                customers whenever you&apos;re ready.
              </p>
              <div className="mt-6 flex justify-center">
                <Link href="/signup" className="btn btn-primary btn-lg">
                  Start your free trial
                </Link>
              </div>
            </div>
          </section>

          {/* The legal pages are reachable from every public entry point, because
              someone deciding whether to hand over a card should not have to hunt
              for the terms they are agreeing to. */}
          {/* Footer links are 44px rows (min-h-11) rather than .tap-target: they
              wrap onto several lines on a phone, and .tap-target's negative
              margins would stack those rows' hit areas on top of each other.
              py-3 instead of py-8 takes back the height the rows added. */}
          <footer className="border-t border-border">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 px-4 py-3 text-sm text-muted sm:px-6 lg:px-8">
              <span className="inline-flex min-h-11 items-center">GroundsRoute</span>
              <Link href="/pricing" className="inline-flex min-h-11 items-center hover:text-foreground">
                Pricing
              </Link>
              <Link href="/faq" className="inline-flex min-h-11 items-center hover:text-foreground">
                FAQ
              </Link>
              <Link href="/terms" className="inline-flex min-h-11 items-center hover:text-foreground">
                Terms of Service
              </Link>
              <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-foreground">
                Privacy Policy
              </Link>
              {/* A prospect with a question before signing up has nowhere else to
                  ask it; the Terms name this address as the support channel. */}
              <a href={`mailto:${LEGAL.contactEmail}`} className="inline-flex min-h-11 items-center hover:text-foreground">
                {LEGAL.contactEmail}
              </a>
              <Link href="/login" className="ml-auto inline-flex min-h-11 items-center hover:text-foreground">
                Sign in
              </Link>
            </div>
          </footer>
      </div>
    </ViewTransition>
  );
}
