<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# GroundsRoute

Crew scheduling for small landscaping companies. An owner books jobs onto crews
across a calendar; each crew opens a phone page showing only their stops for the
day and marks them done. Recurring jobs regenerate automatically. Multi-tenant:
many companies sign up and their data must never mix.

Formerly called Mowify. The rename is complete except where noted below.

## Stack

Next.js 16 (App Router) · React 19 · Prisma 7 with the `@prisma/adapter-pg`
driver adapter · PostgreSQL on Neon · Tailwind v4 · TypeScript · Vitest ·
argon2 (`@node-rs/argon2`) · Zod · Resend · Stripe (hosted Checkout and
Billing Portal).

## Shape of the thing

- `src/lib/auth/` — the security core. `dal.ts` is the authorization boundary;
  `session.ts`, `token.ts`, `password.ts`/`hash.ts`, `lockout.ts`, `slug.ts`.
- `src/lib/data.ts` — every read of the owner-facing app's *business* data
  (customers, crews, jobs). The billing surface is the one exception: the
  `/billing` page, its portal action, `LapsedBanner` and `dal.ts` read
  `Org` through Prisma directly. That is safe because those reads take `orgId`
  from the session and never from client input, but it does mean `data.ts` is
  no longer literally every read.
- `src/lib/recurring.ts` — generates future visits for recurring jobs.
- `src/app/(app)/` — authenticated routes; this group owns the sidebar shell.
- Public routes sit outside that group: landing, login, signup, the token
  routes, and `/c/[slug]` (crew login).
- `src/app/globals.css` — the design system. Colour tokens and `.btn`/`.card`/
  `.field` classes. Do not hard-code colours in components.

## Auth model

`Org` → `User` → `Session`, plus `Token` for emailed links.

- **Owners** sign in with email + password at `/login`.
- **Crew** sign in with a username + 6-digit PIN at `/c/<company-slug>`.
  Usernames are unique per-org, not globally. Crew have no email; their owner
  manages their logins and PINs from `/team`.
- Sessions are database-backed. The cookie holds a random token; only its
  SHA-256 is stored, so a database leak yields no usable sessions.

**The scoping pattern, which is the whole ballgame:** every function in
`src/lib/data.ts` calls `requireOwner()` *itself* and adds `orgId` to its own
`where` clause. It does **not** take an `orgId` parameter. There is nothing for
a caller to forget. Preserve this — do not "simplify" it by threading `orgId`
through from pages.

## Things that have already gone wrong here

Each of these was a real bug, found in review or in production. They are listed
because they are all easy to reintroduce.

- **`middleware.ts` is `proxy.ts` in this Next version, and it must live at
  `src/proxy.ts`** — not the repo root, because the app is under `src/`. At the
  root it silently never runs and the middleware manifest stays empty.
- **`proxy.ts` matches public paths with `startsWith`.** `"/"` is handled as an
  exact match on purpose; adding it to the prefix list would make every route
  public.
- **`err.meta.target` is `undefined` with `@prisma/adapter-pg`.** The
  conflicting columns are at `err.meta.driverAdapterError.cause.constraint.fields`.
  Use `p2002Fields` from `src/lib/prisma-errors.ts`. Code reading `meta.target`
  alone is broken and will look fine in review.
- **Server Actions must return error state, never throw it.** Production React
  redacts thrown Server Component messages, so users see boilerplate instead of
  your message. Tests call actions in-process and see the real error, so this
  passes tests and fails in production.
- **Token pages must not consume a token on GET.** Corporate mail scanners fetch
  every URL in an inbox. Peek with `findValidToken`, consume in the action.
- **Zod: `.trim()` before `.min()`.** Otherwise whitespace-only input passes and
  stores as empty.
- **Anything reaching Prisma's `data` needs a `.strict()` allowlist.** A Server
  Action's TypeScript parameter type is erased at runtime. Spreading raw client
  input once allowed an owner to move their row into another company's tenant.
- **Client-supplied foreign keys need an ownership check.** `customerId` and
  `crewId` both must be proven to belong to the caller's org before use.
- **Login and crew login pay a dummy argon2 cost on a failed lookup.** Without
  it, response timing reveals which emails and usernames are registered.
- **The session cookie is still named `mowify_session`.** Renaming it signs out
  every existing session. Leave it.
- **`/billing/return` must stay in `PUBLIC_PREFIXES`, and `/billing` must not.**
  The prefix match means the shorter string would make the owner's billing page
  public to anyone.

## Email

`src/lib/email/client.ts` wraps Resend. **`sendEmail` never throws** — it logs
and returns a boolean, because no user-facing operation should fail because an
email provider is down. Signup deliberately sends nothing at all: it is
unauthenticated, and mailing from it let anyone drive arbitrary recipients from
the sending domain.

Templates carry no external images or scripts; a remote asset leaks a `Referer`
containing the token URL.

Requires `RESEND_API_KEY`, `EMAIL_FROM` (on a domain verified in Resend) and
`APP_URL`. **`APP_URL` silently defaults to localhost if unset**, which mails
customers links to their own machine — the failure looks like success.

## Billing

Stripe, via hosted Checkout and the hosted Billing Portal. Card data never
reaches this server.

**Nobody has an account until Stripe confirms a card.** `signup` writes a
`PendingSignup` row and an httpOnly claim cookie, then redirects to Checkout.
`POST /api/stripe/webhook` is the only code that creates an `Org` — which is
why its signature verification is not a formality, and why that route is exempt
from the signed-out redirect in `src/proxy.ts`.

`/billing/return` is public and identifies the visitor by the claim cookie
alone. No identifier rides in the URL: URLs are shared, logged, and leak in
`Referer` headers.

**`requireActiveOrg()` gates every owner write path.** Reads keep calling
`requireOwner()`. `updateJobStatus` deliberately calls only `verifySession()`
so a lapsed company's crews can still mark stops complete — blocking that
strands people in a yard mid-week to collect from their employer. `/billing`
and everything in `account/actions.ts` stay ungated, or a lapsed account could
never recover.

Subscription events re-fetch the subscription from Stripe rather than trusting
the event body, which removes webhook ordering as a concern entirely.

Requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`,
`CRON_SECRET` (the cron routes), optionally `PURGE_ENABLED` and
`STRIPE_PORTAL_RETURN_URL`
(derived from `APP_URL` when unset), and a real `APP_URL` — `requireAppUrl()` throws rather than defaulting to localhost,
because a localhost `success_url` sends a paying customer to their own machine
and looks like success from our side.

`npm run db:grandfather` marks pre-billing companies active. It writes to
`DATABASE_URL` and needs `GRANDFATHER_CONFIRM=yes`. Do not run it without the
owner asking.

### Deploying billing for the first time — the order is not optional

1. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` and a
   real `APP_URL` in the production environment.
2. `npm run db:push` — the new `PendingSignup` table and `Org` subscription
   columns must exist before anything reads them.
3. `GRANDFATHER_CONFIRM=yes npm run db:grandfather`.
4. Deploy the code.

Steps 3 and 4 are the time-critical pair, and only in that order. Every
pre-existing company has `subscriptionStatus: null`, which `isOrgActive()`
reads as lapsed. Ship the code first and every existing owner is instantly
read-only and redirected to `/billing`. That page can now at least offer them a
way back — see "Restarting a subscription" below — but it would still be asking
a paid-up company to pay again, so grandfather first. Doing so is invisible to a
running deployment, because nothing reads the column yet.

### Restarting a subscription

`startResubscribe()` in `src/app/(app)/billing/actions.ts` opens Checkout for a
company with nothing left to repair — cancelled, or grandfathered with no
subscription at all. `/billing` offers it instead of the portal for those cases.

**The Billing Portal cannot do this, and an earlier version of this file said it
could.** Per Stripe: "cancelled subscriptions do not appear in the portal. A new
subscription needs to be created." The portal's reactivation affordance exists
only while `cancel_at_period_end` is set and the period has not yet elapsed.
Do not "simplify" resubscribe back into a portal configuration.

- **The resubscribe Checkout must never set `trial_period_days`.** Stripe grants
  the same customer a second trial without complaint — "it is the responsibility
  of your system to implement a check" — so omitting the parameter *is* the
  check. Granting it would make cancel-and-restart an unlimited free plan, and
  Terms §3 sells one trial per company. There is a test asserting its absence.
- **The new subscription's id is on no `Org` row yet**, so `mirrorSubscription`
  resolves the org by `stripeSubscriptionId`, then `metadata.orgId` (written by
  `startResubscribe`), then `stripeCustomerId`. Removing the metadata from the
  Checkout call silently orphans every resubscribe.
- **A resolved org that already holds a live subscription cancels the newcomer**
  rather than adopting it, so nobody is billed twice. Same rule as the duplicate
  checkout branch in `completeSignup`.
- `trialReminderSentAt` is cleared only when the row moves to a *different*
  subscription. Clearing it on every mirror would re-arm the reminder on each
  `subscription.updated` — and Stripe sends many — mailing one owner repeatedly.

### The trial-end reminder

Terms §3 promises a reminder "at least 7 days before the trial ends, telling you
the date the charge will occur, the amount, and how to cancel." All three are
required content, not editorial choices.

**It cannot come from Stripe.** `customer.subscription.trial_will_end` fires
exactly three days out and the timing is not configurable — Stripe's guidance on
sending earlier is "Currently not supported through Stripe." So it is a daily
Vercel Cron job at `GET /api/cron/trial-reminder`, declared in `vercel.json`.

- Authenticates against **`CRON_SECRET`** with `timingSafeEqual` and returns
  **404**, not 401, so the route's existence is not advertised. **A missing
  `CRON_SECRET` fails closed** — an unset secret must never read as "no auth
  required."
- `"/api/cron/"` is in `PUBLIC_PREFIXES` for the same reason the Stripe webhook
  is. The trailing slash is load-bearing; `proxy.ts` matches with `startsWith`.
- Idempotent through `Org.trialReminderSentAt`, which is written **only when
  `sendEmail` returns true**. Marking it regardless would consume the single
  reminder a company gets during a provider outage — and an unset
  `RESEND_API_KEY` returns false in exactly the same way a real outage does.
- The window is eight days wide, not exactly seven. "At least 7 days" means
  early is compliant and late is not, so a skipped run has a day of slack.

The price lives once in `src/lib/pricing.ts`. The reminder, the Terms and the
pricing page all read it from there; three copies of a number eventually
contradict a contract.

### Auto-renewal consent at signup

The Terms sell a trial that converts into a recurring charge. **The law that
governs that is about the signup screen, not the contract** — a correctly
drafted clause is worthless if the screen does not match it. ROSCA is in force
and the FTC enforces it directly; state auto-renewal laws stack on top. (The
FTC's click-to-cancel Negative Option Rule was vacated in July 2025 and is not
in force.)

So `/signup` shows the material terms **above** the button that leads to the
card form, and takes **two separate un-pre-ticked checkboxes** — trial terms,
and Terms/Privacy. One box covering both would not isolate consent to the
negative option.

- **Both are validated server-side in the action**, not by the `required`
  attribute, which a crafted POST ignores. An unticked checkbox submits
  *nothing* — the key is absent, not `false` — so the check is for the literal
  `"on"`.
- The disclosure is rendered from `trialDisclosure()` in `src/lib/consent.ts`
  and **stored verbatim** on the consent record. A version string proves nothing
  once the words it named have been edited. `/pricing` renders the same
  function, so the two pages cannot drift.
- The trial length in the Checkout call reads `TRIAL_DAYS`, not a literal, so it
  cannot diverge from the number the customer consented to.

### ConsentRecord outlives the Org, deliberately

The Privacy Policy makes two retention promises that pull opposite ways:
account data is deleted **30 days** after cancellation, and consent records are
kept **three years** because automatic renewal laws require it.

`ConsentRecord` therefore has **no foreign key to `Org`** and holds its own copy
of the email and company name. Storing consent as columns on `Org` would let the
deletion job destroy the evidence two years and eleven months early — precisely
when a disputed first charge makes it the only evidence there is.

**Any purge job must skip `ConsentRecord`;** its own `expiresAt` is what removes
it. `expiresAt` is stored rather than computed so shortening the constant later
cannot retroactively shorten records already taken. There is a test that deletes
every org and asserts the records survive.

### The signup acknowledgement

Sent from the **webhook**, never from the signup action. Signup is
unauthenticated and mailing from it once let anyone drive arbitrary recipients
from the sending domain — that rule is unchanged. By webhook time Stripe has
confirmed a card against the address, so it is a paying customer rather than an
arbitrary recipient.

### Data lifecycle

Both halves are published promises, so the code and the documents read the same
constants — `RETENTION` in `src/lib/legal.ts` and `src/lib/pricing.ts`. **A page
that says 30 days while the job uses 45 is not a discrepancy, it is a false
statement to a customer**, and one number is the only reliable way to stop that.

**Export** — `GET /api/export`, owner-only, **ungated by subscription status**.
Terms §3 gives a lapsed company 30 days to export before deletion, so
`requireActiveOrg` here would withhold it from the people the clause was written
for. Scoped by `orgId` from the session, never from input. Credential hashes are
excluded: they are not customer data and a downloads folder is the wrong place
for the company's own logins.

**Deletion** — `GET /api/cron/purge`, daily. `Org.lapsedAt` is the clock,
written in `mirrorSubscription` **on the transition only**; refreshing it while
a company stays lapsed would restart the 30 days on every webhook and nothing
would ever be deleted.

Three guards, all with tests that fail when the guard is removed:

- **The active-status check is applied twice** — in the query and again inside
  the transaction. The redundancy is the point: a bug leaving `lapsedAt` set on
  a paying company must not be sufficient on its own to delete them.
- **A cap of 50 orgs per run**, which aborts the whole run rather than deleting
  the first 50. More than that is a broken query, not a wave of cancellations.
- **`PURGE_ENABLED` must equal `"yes"`.** Unset, the job reports what it would
  delete and touches nothing. **Deploy it unset first** and watch the numbers —
  the first run of a deletion job against real customer data should never be its
  first run.

**`ConsentRecord` is never deleted with an org.** See the Auto-renewal consent
section above; it is removed only by its own `expiresAt`.

### The published documents

`/terms` and `/privacy` are the real published pages, and they now describe
things that exist. Every value in `LEGAL` is filled in as of 17 September
2026. The convention `src/lib/legal.ts` set still applies to any future
addition: an unfilled value is rendered verbatim so it is obvious to anyone
who looks, rather than hidden in a config file. Never invent one — the owner
supplies it.

Bump `LEGAL.version` whenever either document changes materially. Consent
records already written keep the version they were taken under.

## Import boundaries (ESLint-enforced)

- Application code imports hashing from `@/lib/auth/password`, never
  `@/lib/auth/hash`. `hash.ts` has no `server-only` guard so scripts can use it;
  the lint rule is what keeps it out of client bundles.
- `@/lib/email/client` may only be imported from `src/app/**/actions.ts`, from
  cron route handlers (`src/app/api/cron/**/route.ts`), and from
  `src/lib/stripe/handle-event.ts` (the signup acknowledgement). The reminder has
  nobody on a page when it sends, so it cannot be a Server Action; a Route
  Handler is server-only by construction and cannot reach a client bundle.

The two restrictions are scoped independently. Do not merge them into one
`files` block — an override for one would disable the other.

## Databases

Two: `DATABASE_URL` (**live production data — never write to it**) and
`TEST_DATABASE_URL` (`mowify_test`, disposable). `vitest.config.ts` forces the
test one, and `src/test/setup.ts` refuses to run unless the URL contains "test".

Schema is applied with `prisma db push` — **there is no migrations directory**.
Every schema change must reach both databases: `npm run db:push` and
`npm run db:push:test`.

`npm run db:seed` truncates everything and is guarded to refuse when real logins
exist. Do not run it against production for any reason.

## Testing

310 tests. `npm test` runs them against the test database.

- `src/lib/data.isolation.test.ts` and `src/app/actions.isolation.test.ts` seed
  two orgs and prove nothing crosses between them. These are the tests that
  matter most.
- The DAL is mocked with `vi.hoisted` so suites can act as an owner or a crew
  member; see the top of either isolation file for the pattern.
- **Prove security tests fail when the protection is removed.** Several tests in
  this repo passed against deliberately broken code before this practice
  started. A green run alone is not evidence.

## Working here

- Every commit must pass `npx tsc --noEmit`, `npm run lint`, `npm run build` and
  `npm test`. Running only `npm test` is insufficient — Vitest transpiles
  without typechecking, which has let a broken build land.
- Comments explain *why*, not *what*, in full sentences.
- Kill any dev server you start. Stray servers bound to `0.0.0.0` serving stale
  builds against the live database have caused real confusion here.
