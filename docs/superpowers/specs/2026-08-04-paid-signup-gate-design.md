# Paid signup gate: no account until Stripe confirms

**Date:** 2026-08-04
**Status:** Approved, ready for implementation planning
**Supersedes:** the signup flow in `2026-07-31-billing-design.md`. That spec's
enforcement half (`requireActiveOrg`, the read-only line, the Billing Portal,
the `Org` subscription columns) is carried forward unchanged.

## Problem

Anyone can sign up and get a working account without paying anything. There is
no payment, no subscription, and no trial expiry. The landing page advertises a
30-day free trial that does not exist in the code.

The earlier billing spec closed this by creating the account first and holding
it read-only until a webhook confirmed a card. That was rejected in favour of a
harder gate: an unpaid person should not have an account at all.

## Goals

- No `Org` and no `User` row exists until Stripe confirms a valid card.
- Thirty days free, then the subscription bills automatically.
- A card failure or an abandoned checkout loses nothing and can be retried.
- Someone who pays reaches their dashboard without a second sign-in step.
- Card details never touch our servers.

## Non-goals

Unchanged from the previous spec: no per-crew or usage-based pricing, no annual
plans or coupons, no invoicing, and no dunning emails written by us. Stripe's
retry and notification handling stays.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Gate strength | No account until the webhook confirms | The owner's explicit choice over the softer read-only-until-paid model |
| Trial | 30 days, card required up front | Matches the landing page. Requiring a card already filters out signups that were never going to convert |
| Pending state | A `PendingSignup` row in our own database | The password hash never leaves our security boundary, and onboarding does not depend on email delivery |
| Post-payment sign-in | Automatic, via an httpOnly claim cookie | No secret rides in the URL bar, so a leaked return URL grants nothing |
| Email taken mid-flight | Cancel the Stripe subscription | No money has moved during a trial, so cancelling costs the customer nothing and leaves no orphaned subscription |
| Source of truth | Stripe, mirrored onto `Org` | Never infer entitlement from our own clock |

## What is inherited unchanged

The read-only line from `2026-07-31-billing-design.md` still governs an org
whose subscription *later* lapses through cancellation or a failed card:

- **Blocked when lapsed:** every owner-only administrative write.
- **Still allowed:** all reads; **a crew member marking a stop complete or
  skipped**; signing in and out, password reset, and `/billing` itself.

`requireActiveOrg()` in the data access layer, `updateJobStatus` deliberately
calling only `verifySession()`, and the Stripe Billing Portal at `/billing` all
carry over verbatim. The one state that disappears is "org with no subscription
at all" — under this design no such org can be created.

## Data model

`Org` gains the same columns as the previous spec:

```prisma
  stripeCustomerId     String?   @unique
  stripeSubscriptionId String?   @unique
  // Mirrored from Stripe's subscription.status: trialing, active, past_due,
  // canceled, unpaid, incomplete. Never computed from our own clock — Stripe
  // knows whether the money arrived and we do not.
  subscriptionStatus   String?
  trialEndsAt          DateTime?
  currentPeriodEnd     DateTime?
```

Plus one new model holding a signup that has not been paid for yet:

```prisma
model PendingSignup {
  id           String  @id @default(cuid())
  // Unique because a retry reuses this row rather than adding a second one.
  // Keeping exactly one row per email means a checkout the visitor abandoned
  // and later completed anyway still resolves here by id, and the claim cookie
  // can only ever point at one place.
  email        String  @unique
  name         String
  companyName  String
  // Nulled once the account exists. There is no reason to keep a credential
  // after it has been copied onto the User row.
  passwordHash String?
  // SHA-256 of the value in the claim cookie. Same reasoning as Session: only
  // the hash is stored, so a database leak yields nothing that can claim an
  // account.
  claimHash    String  @unique
  checkoutSessionId String? @unique
  orgId        String?
  failedReason String?
  // Set on completion and never cleared. This is what makes a replayed
  // webhook a no-op.
  consumedAt   DateTime?
  expiresAt    DateTime
  createdAt    DateTime @default(now())

  @@index([email])
  @@index([expiresAt])
}
```

## Flow

### Signup

1. The `signup` action validates input, confirms the email is not already a
   `User`, and hashes the password with `hashSecret`.
2. It upserts the `PendingSignup` row for that email — a retry overwrites the
   previous attempt's hash, claim, checkout session and expiry rather than
   adding a second row — and sweeps rows whose `expiresAt` has passed. An
   already-consumed row cannot be overwritten; the `User` check in step 1
   catches that case first, because a consumed row means the account exists.
3. It sets a claim cookie holding a random value, httpOnly, `SameSite=Lax` so
   it survives the top-level redirect back from Stripe, and expiring in 48
   hours to match `expiresAt`. Only its SHA-256 goes in `claimHash`.
4. **No `Org`, no `User`, no session is created.**
5. It creates a Stripe Checkout session in `subscription` mode with
   `trial_period_days: 30`, payment-method collection set to always, and
   `client_reference_id` set to the `PendingSignup` id, then redirects to it.

`expiresAt` is 48 hours out. A Stripe Checkout session expires on its own after
24, so by 48 no completion can still arrive and sweeping an unconsumed row is
safe. That margin is the whole reason the number is not 24.

Sweeping is opportunistic on signup rather than scheduled. The project has no
cron infrastructure, and adding some to delete a handful of abandoned rows
would cost more than it saves. Only unconsumed rows past `expiresAt` are
deleted; a consumed row is a record of a real account and stays.

### Webhook

`POST /api/stripe/webhook` is the only route that creates orgs or writes
subscription state.

- **Verify the Stripe signature on every request** and reject anything that
  fails. This endpoint now *creates accounts*, so a missing signature check is
  not merely a free subscription — it is a free tenant.
- On `checkout.session.completed`: load the `PendingSignup` by
  `client_reference_id`. If it is unconsumed, create the `Org` and owner `User`
  in one transaction, reusing the existing slug-collision retry, stamp the
  subscription columns, then set `orgId`, `checkoutSessionId` and `consumedAt`
  and null `passwordHash`.
- If the row is **already consumed**, compare the event's session against the
  stored `checkoutSessionId`. The same session is a replay: return 200 and do
  nothing. A *different* session means the visitor completed two checkouts —
  most often by paying in an abandoned tab after retrying — so cancel this
  second subscription and log it. The account they already have is the one that
  keeps its subscription.
- Completion is honoured even if `expiresAt` has passed but the row has not yet
  been swept. Stripe confirming a card outranks our own clock, and taking
  payment while refusing to create the account is the one outcome worth any
  amount of code to avoid.
- On `customer.subscription.created|updated|deleted` and
  `invoice.payment_failed`: mirror status, `trialEndsAt` and `currentPeriodEnd`
  onto the `Org` as before.
- Be idempotent, and ignore an event describing a subscription state older than
  the one already stored.
- The route must be exempt from the signed-out redirect in `src/proxy.ts`.
  Stripe is not a browser and carries no session cookie. Note the `startsWith`
  matching caveat recorded in `AGENTS.md`.

### Return

`/billing/return` is a **public** route — the visitor has no session yet, which
is a change from the previous spec. It identifies the visitor by the claim
cookie alone; no identifier appears in the URL.

| Row state | Behaviour |
|---|---|
| No cookie, or no matching row | Offer to start again at `/signup` |
| Unconsumed | Pending UI that re-checks, plus the fallback below |
| Consumed with `orgId` | Create the session, clear the claim cookie, redirect to `/dashboard` |
| `failedReason` set | Explain, and offer `/login` and `/forgot-password` |

**Fallback reconciliation:** if the webhook has not landed within 5 seconds,
the page retrieves the Checkout Session from Stripe's API server-side and runs
the same completion path, which is idempotent. This is not trusting the return
URL — it is an authenticated call to Stripe by a visitor already holding the
claim cookie. It exists because "paid, but no account and no way to get one" is
the worst outcome this design can produce.

### Managing a subscription

`/billing`, owner only, unchanged from the previous spec: current status, trial
end or next billing date, and a button opening the Stripe Billing Portal.

## Configuration

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, and
`STRIPE_PORTAL_RETURN_URL` (derived from `APP_URL` if absent), documented in
`.env.example`. A missing key must fail loudly rather than silently, as with
`RESEND_API_KEY`.

## Error handling

- Checkout abandoned → nothing exists; the row expires and is swept; the same
  email can sign up again.
- Email registered in the gap between the pre-checkout check and the webhook →
  cancel the Stripe subscription, set `failedReason`, log loudly, and tell the
  visitor on the return page.
- Webhook signature invalid → 400, nothing written, logged.
- Webhook for an unknown customer or an already-consumed row → 200 with no
  action, so Stripe stops retrying.
- Claim cookie missing or mismatched → no session granted.
- Payment fails after the trial → Stripe retries; the org moves to read-only on
  `past_due` and recovers automatically.
- Stripe API unreachable → a readable error, never a raw exception.

## Existing accounts

Orgs already in the production database have no subscription and would become
read-only the moment this ships. A one-off script stamps them as
grandfathered-active so nobody who already signed up loses their app overnight.

**This script must not be run against production without the owner's explicit
say-so at the time.** `AGENTS.md` forbids writing to `DATABASE_URL`, and this
is a deliberate, narrow exception rather than a standing permission.

## Testing

New to this design:

- The `signup` action creates **zero** `Org` and `User` rows.
- A forged webhook signature creates no account.
- A replayed `checkout.session.completed` yields exactly one `Org`.
- A wrong or absent claim cookie signs nobody in.
- The email-collision path cancels the subscription and creates no user.
- A second completed checkout for an already-consumed row is cancelled, and the
  existing account keeps its original subscription.
- An unconsumed row past `expiresAt` is swept, and a claim cookie pointing at a
  swept row grants nothing.
- A retry overwrites the existing `PendingSignup` instead of creating a second.

Carried over:

- Status mapping: each Stripe status resolves to the right access level.
- `requireActiveOrg` blocks every owner write path when lapsed.
- **A lapsed org's crew can still mark a stop complete.**
- A lapsed org can still read, sign in, and reach `/billing`.
- Cross-org: a webhook for one company never alters another's subscription, and
  webhook-created orgs hold to the same isolation guarantees.

Per `AGENTS.md`, verify each security-critical test fails when the protection is
removed. A green run alone is not evidence.

## Known surface

Signup is unauthenticated and now writes a database row and creates a Stripe
Checkout session per attempt. Growth is bounded by opportunistic sweeping and
by Stripe's own abuse controls. If this is ever abused in practice, rate
limiting belongs here — it is not built now because there is no evidence it is
needed.

The pre-checkout uniqueness check reveals whether an email is registered. The
existing signup form already does this, so this design changes nothing.

## What the owner must do outside the code

- Create a Stripe account with business and bank details.
- Create the Product and monthly Price; put its ID in `STRIPE_PRICE_ID`.
- Add the webhook endpoint in Stripe and copy its signing secret.
- Confirm the landing page states that a card is required to start the trial.
- **Publish terms of service and a refund policy before charging anyone.**
