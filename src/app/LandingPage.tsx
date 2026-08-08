import Link from "next/link";

// A decorative stand-in for the real dashboard board, built from the same
// tokens the app uses so it reads as "this software" rather than generic
// marketing art. Marked aria-hidden because the labels are illustrative
// placeholders, not real crew or customer data — a screen reader announcing
// them as content would be misleading.
function BoardMock() {
  const columns = [
    { crew: "Crew 1", stops: ["Stop 1", "Stop 2", "Stop 3"] },
    { crew: "Crew 2", stops: ["Stop 1", "Stop 2"] },
    { crew: "Crew 3", stops: ["Stop 1", "Stop 2", "Stop 3"] },
  ];

  return (
    <div aria-hidden="true" className="card p-4 shadow-sm sm:p-5">
      <div className="grid grid-cols-3 gap-3">
        {columns.map(({ crew, stops }, colIndex) => (
          <div key={crew} className="space-y-2">
            <div className="flex items-center gap-1.5 px-0.5 text-xs font-semibold text-muted">
              <span className="h-2 w-2 rounded-full bg-brand" />
              {crew}
            </div>
            {stops.map((stop, i) => {
              // The first stop of the first column is shown checked off, so
              // the mock demonstrates completion, not just a list of jobs.
              const done = colIndex === 0 && i === 0;
              return (
                <div
                  key={stop}
                  className={`rounded-md border border-border px-2.5 py-2 text-xs ${
                    done ? "bg-brand-soft text-brand" : "bg-background text-foreground"
                  }`}
                >
                  {done ? `✓ ${stop}` : stop}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Rendered at `/` only when there is no session. A signed-in visitor never
 * sees this — the redirect chain in page.tsx sends them to their dashboard
 * or day view before this component is reached.
 */
export default function LandingPage() {
  return (
    <>
      <section className="hero-gradient border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 md:items-center md:py-24 lg:px-8">
          <div>
            <h1 className="text-display font-semibold text-foreground">
              The day, planned on one board.
            </h1>
            <p className="mt-4 max-w-md text-lg text-muted">
              GroundsRoute is crew scheduling for small landscaping companies.
              Build the day once on your board, and every crew opens their
              phone to just their stops.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="btn btn-primary btn-lg">
                Start your free trial
              </Link>
              <Link href="/login" className="btn btn-secondary btn-lg">
                Sign in
              </Link>
            </div>
            <p className="mt-3 text-sm text-muted">
              30 days free, then $49/month. Cancel any time. Card required to
              start.
            </p>
          </div>
          <BoardMock />
        </div>
      </section>

      <section aria-labelledby="two-sides-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 id="two-sides-heading" className="text-2xl font-semibold text-foreground">
          Two views, one schedule
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-foreground">For the office</h3>
            <p className="mt-2 text-sm text-muted">
              Assign jobs to crews and set the order of each day&apos;s
              stops. See every crew&apos;s schedule for the day or the month,
              and keep every customer and their job history in one place.
            </p>
          </div>
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-foreground">For the crew</h3>
            <p className="mt-2 text-sm text-muted">
              Each crew signs in at your company&apos;s own link with a
              username and a 6-digit PIN, and sees just their stops for the
              day, in order — with an address and a button to mark each one
              complete.
            </p>
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
            <li>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-on-brand">
                1
              </span>
              <p className="mt-3 text-sm text-muted">
                Add your customers and jobs, and assign each one to a crew.
              </p>
            </li>
            <li>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-on-brand">
                2
              </span>
              <p className="mt-3 text-sm text-muted">
                Recurring jobs regenerate on their own, so a weekly mow never
                needs re-entering.
              </p>
            </li>
            <li>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-on-brand">
                3
              </span>
              <p className="mt-3 text-sm text-muted">
                Each morning, crews open their page and work through their
                stops in order.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section aria-labelledby="closing-cta-heading" className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h2 id="closing-cta-heading" className="text-2xl font-semibold text-foreground">
          Put your week on one board.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted">
          30 days free, then $49/month. Cancel any time, card required to start.
          Add your crews and customers whenever you&apos;re ready.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/signup" className="btn btn-primary btn-lg">
            Start your free trial
          </Link>
        </div>
      </section>
    </>
  );
}
