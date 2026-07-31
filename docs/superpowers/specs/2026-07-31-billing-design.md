# Billing: a card-required 30-day trial

**Date:** 2026-07-31
**Status:** Approved, ready for implementation planning

## Problem

The landing page advertises a 30-day free trial you can cancel any time. Neither
exists: there is no payment, no subscription, no trial expiry, and nothing to
cancel. Everyone who signs up gets the product free forever, and there is no way
to start charging without changing the terms on people who already joined.

## Goals

- A card is collected at signup, before the trial starts.
- Thirty days free, then the subscription bills automatically.
- The customer can cancel or update their card themselves, without emailing us.
- A lapsed account keeps its data and keeps its crews working.
- Card details never touch our servers.

## Non-goals

- **Per-crew or usage-based pricing.** Flat monthly per company. Revisit if
  customer sizes diverge enough to matter.
- **Annual plans, coupons, referrals.** Later, if ever.
- **Invoicing or purchase orders.** Card only.
- **Dunning emails written by us.** Stripe's built-in retry and notification
  handling is better than anything we would write, and it is one less thing
  sending mail from our domain.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Provider | Stripe, via hosted Checkout | Card data never reaches our server, so PCI scope stays minimal. Hosted Checkout also handles 3DS, wallets and card updates we would otherwise build |
| Price location | A Stripe Price object, referenced by ID | The amount lives in the dashboard, so changing it is not a deploy. Our code never hardcodes a number |
| Trial | 30 days, card required up front | The owner asked for a card requirement. It also filters out signups that were never going to convert |
| Lapsed access | Read-only for owners; crews keep working | Their data survives, the pressure to pay is real, and nobody loses a season of history to an expired card |
| Source of truth | Stripe, mirrored onto `Org` | Never infer entitlement from our own clock. Stripe knows whether the money arrived; we cache its answer |

## The read-only line

This is the decision that matters most in practice, so it is stated explicitly.

**Blocked when lapsed** — everything administrative, all owner-only:
creating or editing jobs, customers and crews; reordering the board;
bulk rescheduling; managing crew logins.

**Still allowed when lapsed:**
- All reads. The owner can see their whole schedule and customer list.
- **A crew member marking a stop complete or skipped.** This is operational, not
  administrative. Blocking it strands people in a yard mid-week and breaks the
  customer's business to collect from them, which is a bad trade even for us.
- Signing in, signing out, password reset, and the billing page itself. An
  account must never be locked out of the screen that lets it pay.

## Data model

`Org` gains:

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

No new model. A subscription is a property of a company, and there is exactly
one per company.

## Flow

### Signup

1. Create the `Org` and owner exactly as today, and sign them in. **The account
   must exist before payment**, so a card failure never loses the signup.
2. Redirect to a Stripe Checkout session in `subscription` mode with
   `trial_period_days: 30` and payment-method collection set to always, so a
   card is required to start the trial.
3. Stripe redirects back to `/billing/return`. That page does **not** grant
   access on its own — it waits for the webhook, showing a brief pending state
   if the webhook has not landed yet. Trusting the return URL would let anyone
   grant themselves a subscription by visiting it.
4. An org with no subscription yet is treated as lapsed: read-only, with a
   prominent prompt to finish setting up billing.

### Webhook

`POST /api/stripe/webhook`, the only route that writes subscription state.

- **Verify the Stripe signature on every request** using the webhook secret, and
  reject anything that fails. Without this the endpoint is an open door to
  granting free subscriptions.
- Handle `checkout.session.completed`,
  `customer.subscription.created|updated|deleted`, and
  `invoice.payment_failed`. Mirror status, `trialEndsAt` and `currentPeriodEnd`
  onto the `Org`.
- Be idempotent. Stripe retries, and events can arrive out of order — ignore an
  event describing a subscription state older than the one already stored.
- The route must be exempt from the signed-out redirect in `src/proxy.ts`:
  Stripe is not a browser and carries no session cookie.

### Managing a subscription

`/billing`, owner only: current status, trial end or next billing date, and a
button opening the **Stripe Billing Portal**. The portal handles updating a
card, viewing invoices, and cancelling. We build none of that.

### Enforcement

A single helper in the data access layer, alongside `requireOwner`:

```ts
requireActiveOrg(): Promise<SessionUser>
```

It calls `requireOwner()`, then throws a redirect to `/billing` when the org's
status is not `trialing` or `active`. Every owner write path calls it —
the eleven owner actions and the crew-login management actions. Reads keep
calling `requireOwner()`.

`updateJobStatus` deliberately keeps calling `verifySession()` only, so crews
keep working. That exception is the read-only line above, and it needs a comment
saying so, or someone will "fix" it later.

## Configuration

New environment variables, documented in `.env.example`:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID` — the monthly Price created in the dashboard
- `STRIPE_PORTAL_RETURN_URL` — derived from `APP_URL` if absent

As with `RESEND_API_KEY`, a missing key must fail loudly rather than silently.
The invisible-misconfiguration failure has already cost this project a day.

## Error handling

- Checkout fails or is abandoned → the account still exists, signed in, in
  read-only with a prompt to finish billing. Nothing is lost.
- Webhook signature invalid → 400, nothing written, logged.
- Webhook arrives for an unknown customer → 200 with no action, so Stripe stops
  retrying, and logged for investigation.
- Payment fails after the trial → Stripe retries on its own schedule; we move to
  read-only when it reports `past_due`, and back to full access on recovery
  without the owner doing anything.
- Stripe API unreachable when opening the portal → a readable error, never a
  raw exception.

## Testing

- Status mapping: each Stripe status resolves to the right access level.
- `requireActiveOrg` blocks every owner write path when lapsed and allows them
  when `trialing` or `active`.
- **A lapsed org's crew can still mark a stop complete.** This is the humane
  half of the design and needs a test, or it will regress.
- A lapsed org can still read, sign in, and reach `/billing`.
- Webhook signature verification rejects a forged body.
- Webhook handling is idempotent: replaying an event changes nothing, and an
  out-of-order event does not downgrade a newer state.
- Cross-org: a webhook for one company never alters another's subscription.

Verify the security-critical tests fail when the protection is removed rather
than trusting a green run.

## What the owner must do outside the code

- Create a Stripe account with business and bank details.
- Create the Product and monthly Price; put its ID in `STRIPE_PRICE_ID`.
- Add the webhook endpoint in Stripe and copy its signing secret.
- Decide the displayed price for the landing page.
- **Publish terms of service and a refund policy before charging anyone.** Not
  optional once money changes hands, and not something this spec covers.
