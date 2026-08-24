# GroundsRoute

Crew scheduling for small landscaping companies.

An owner books jobs onto crews across a calendar; each crew opens a phone page
showing only their stops for the day and marks them done. Recurring jobs
regenerate automatically. Multi-tenant — many companies sign up, and their data
never mixes.

## Stack

Next.js 16 (App Router) · React 19 · Prisma 7 with the `@prisma/adapter-pg`
driver adapter · PostgreSQL on Neon · Tailwind v4 · TypeScript · Vitest ·
argon2 (`@node-rs/argon2`) · Zod · Resend · Stripe (hosted Checkout and
Billing Portal).

## Getting started

```bash
npm install
cp .env.example .env      # then fill in the values below
npm run db:push:test      # applies the schema to the TEST database only
npm run dev
```

The app runs at http://localhost:3000.

### Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Production database. **Never write to it from a dev machine.** |
| `TEST_DATABASE_URL` | Disposable test database; must contain "test" or the suite refuses to run. |
| `APP_URL` | Absolute origin for emailed links and Stripe redirects. Defaults to localhost in `appUrl()`, but `requireAppUrl()` throws rather than guess. |
| `RESEND_API_KEY` | Transactional email. Unset means email silently no-ops — see below. |
| `EMAIL_FROM` | Sender address, on a domain verified in Resend. |
| `STRIPE_SECRET_KEY` | Stripe API key. |
| `STRIPE_WEBHOOK_SECRET` | Verifies the webhook signature. The webhook is the only code that creates an `Org`. |
| `STRIPE_PRICE_ID` | The subscription price. |
| `STRIPE_PORTAL_RETURN_URL` | Optional; derived from `APP_URL` when unset. |

`sendEmail` never throws — it logs and returns a boolean, so no user-facing
operation fails because a mail provider is down. The trade-off is that a
missing `RESEND_API_KEY` looks exactly like success. If you are testing the
password-reset or verify-email flows locally, set it.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server. |
| `npm test` | Vitest against the test database. |
| `npm run lint` | ESLint, including the import-boundary rules. |
| `npm run build` | Production build. |
| `npm run db:push` | Applies the schema to `DATABASE_URL` — **production**. |
| `npm run db:push:test` | Applies the schema to the test database. |
| `npm run db:seed` | Truncates everything; refuses to run when real logins exist. |
| `npm run db:grandfather` | Marks pre-billing companies active. Needs `GRANDFATHER_CONFIRM=yes`. |

Schema changes are applied with `prisma db push` — there is no migrations
directory — and every change must reach both databases.

## Before every commit

All four, in any order:

```bash
npx tsc --noEmit
npm run lint
npm run build
npm test
```

`npm test` alone is insufficient: Vitest transpiles without typechecking, which
has let a broken build land here before.

## Architecture and the rules that matter

`AGENTS.md` is the real document — it covers the authorization boundary, the
per-tenant scoping pattern, the billing model and deploy order, and a list of
bugs that have already happened here and are easy to reintroduce. Read it
before changing anything under `src/lib/auth/`, `src/lib/data.ts`, or billing.
