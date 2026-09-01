# Billing lifecycle: resubscribe and the trial-end reminder

Spec 1 of 3 in the launch-legal sequence. Specs 2 (auto-renewal consent) and 3
(data lifecycle and publication) follow. Nothing in the published Terms or
Privacy Policy ships until all three land, because those documents describe
behaviour that does not exist yet.

## Why this exists

The Terms of Service we are about to publish make two promises this codebase
cannot currently keep.

**Terms §3** — "We will email you a reminder at least **7 days before the trial
ends**, telling you the date the charge will occur, the amount, and how to
cancel." Nothing in `src/` listens for a trial ending.

**Terms §3 and §4** — "We keep your data for **30 days** after the trial ends so
you can subscribe and pick up where you left off." That sentence promises a
resubscribe path. There isn't one. `AGENTS.md` already records this as a known
gap: Checkout is only ever created by `signup/actions.ts`, which deliberately
creates a *new* org.

Publishing either sentence before the code honours it turns a documentation task
into a false statement to customers, which is the thing auto-renewal law
actually punishes.

## Two Stripe facts that decide the design

Both were verified against Stripe's documentation rather than assumed, and each
rules out the cheaper approach.

**The trial reminder cannot come from Stripe.** `customer.subscription.trial_will_end`
fires exactly three days before the trial ends, and the timing is not
configurable — Stripe's own guidance on sending it earlier is "Currently not
supported through Stripe." A seven-day promise therefore requires our own
scheduled job. Listening to the webhook would satisfy neither the contract nor
the customer.

**The Billing Portal cannot restart a cancelled subscription.** Per Stripe:
"cancelled subscriptions do not appear in the portal. A new subscription needs
to be created." `AGENTS.md` currently suggests "Configure the Portal to allow
resubscription" as the fix — that advice is wrong and this spec corrects it. The
portal's reactivation affordance only exists while `cancel_at_period_end` is set
and the period has not yet elapsed. Once status is `canceled`, the customer has
no subscription and the portal has nothing to offer.

**A consequence worth stating separately:** Stripe will happily grant the same
customer a second trial. "Yes, the customer will get the trial again... it is
the responsibility of your system to implement a check." So the resubscribe
Checkout must omit `trial_period_days` entirely. If it does not, cancel-and-
resubscribe cycling yields unlimited free service, and we would also be
contradicting Terms §3's "One trial per company."

## Scope

In: a resubscribe path for lapsed, cancelled, and grandfathered orgs; a
seven-day trial-end reminder email; the scheduled-job infrastructure both the
reminder and Spec 3's deletion job need.

Out: the consent checkbox and `/pricing` (Spec 2), export and deletion (Spec 3),
the document port (Spec 3), and any annual plan — billing stays monthly-only at
$49, so Terms §3–§4 will be edited to drop the annual language.

## Part A — Resubscribe

### The entry point

`/billing` already renders for a lapsed owner: it calls `requireOwner()`, not
`requireActiveOrg()`, precisely so lapsing stays recoverable. It gains a second
action. The rule for which button shows is the org's state, not its status
string alone:

| Org state | Today | After |
|---|---|---|
| `trialing` / `active` | Manage billing | Manage billing (unchanged) |
| `past_due` / `unpaid` | Manage billing | Manage billing — the card needs fixing, not a new subscription |
| `canceled` | Manage billing (dead end) | **Restart subscription** |
| No subscription ever (`null`) with a customer id | Manage billing | **Restart subscription** |
| Grandfathered — `stripeCustomerId: null` | "No billing account" and no button at all | **Restart subscription** |

The grandfathered row is the second half of the gap `AGENTS.md` records: such an
org has no customer id, so the portal button never renders and it has "no in-app
recovery whatsoever." Resubscribe closes it, because Checkout can create the
customer.

### The flow

A new server action, `startResubscribe()`, in `src/app/(app)/billing/actions.ts`
alongside `openBillingPortal()`. It follows that function's existing shape:
`requireOwner()` (never `requireActiveOrg()` — gating this would make lapsing
unrecoverable, the same reasoning already written above `openBillingPortal`),
returns a discriminated result rather than throwing, because production React
redacts thrown Server Action messages.

```
requireOwner()
  → refuse if isOrgActive(status)          // never sell a second subscription
  → Checkout Session, mode: "subscription"
      customer:       org.stripeCustomerId ?? undefined
      customer_email: owner.email          // only when customer is undefined
      line_items:     [{ price: priceId, quantity: 1 }]
      payment_method_collection: "always"
      subscription_data.metadata.orgId: org.id
      NO trial_period_days                 // one trial per company
      success_url: {APP_URL}/billing?restarted=1
      cancel_url:  {APP_URL}/billing
  → redirect
```

`success_url` goes to `/billing`, not `/billing/return`. The latter exists to
identify a visitor who has no session yet, via the claim cookie; a resubscribing
owner is already signed in, so none of that machinery applies and reusing it
would only create a second way to claim an org.

Passing `customer` when we have one keeps the customer's card and invoice
history attached. Passing `customer_email` when we do not lets Stripe create the
customer, which is what makes the grandfathered case work.

### Linking the new subscription back to the org

This is the part with teeth. `mirrorSubscription()` currently finds the org by
`stripeSubscriptionId`, and a resubscribe produces an id no org holds yet, so
every event for it would log "no org for subscription" and drop.

Resolution becomes an ordered fallback:

1. `stripeSubscriptionId` matches an org — the existing path, unchanged.
2. `subscription.metadata.orgId` names an org — the resubscribe path.
3. `stripeCustomerId` matches an org — the belt-and-braces path, for a
   subscription created outside our flow (from the Stripe Dashboard, say).

On resolving via 2 or 3, the org's `stripeSubscriptionId` and `stripeCustomerId`
are written along with the status. That single write is what adopts the new
subscription.

**The double-subscription guard.** An owner can open Checkout twice, or restart
in a stale tab after the card already went through. If a resolved org already
holds a *different* subscription id, we re-read that older subscription from
Stripe. If it is still `trialing` or `active`, the customer already has what
they are paying for, and the *newer* subscription is cancelled and not adopted.
Otherwise the new one replaces it. This is the same principle the duplicate-
checkout branch in `completeSignup` already applies — never leave a customer
paying twice — and cancellation failures propagate for the same reason they do
there: a swallowed failure answers Stripe 200 while someone is double-billed.

The status guard in the action is a courtesy, not the real protection. The
webhook guard is the real one, because the action's check and the customer's
payment are seconds apart and Stripe is the only party that knows whether money
moved.

## Part B — The seven-day trial reminder

### Scheduling

The repo has no cron. It has deliberately avoided one — `signup/actions.ts`
sweeps expired `PendingSignup` rows inline "rather than on a schedule... without
adding cron infrastructure this project does not have." That trade stops working
here: a reminder that must fire seven days before a date cannot ride on a
request that may never come.

So: Vercel Cron, declared in a new `vercel.json`, calling
`GET /api/cron/trial-reminder` once daily at 14:00 UTC (mid-morning US Eastern —
these are landscaping owners, and a billing warning should land during the
working day).

Authorisation: Vercel sends `Authorization: Bearer $CRON_SECRET`. The route
compares against `process.env.CRON_SECRET` with `timingSafeEqual` and returns
404 — not 401 — on a mismatch, so the endpoint's existence is not advertised to
anyone scanning. A missing `CRON_SECRET` fails closed: the route refuses every
request rather than running unauthenticated.

`"/api/cron/"` joins `PUBLIC_PREFIXES` in `src/proxy.ts` for the same reason
`/api/stripe/webhook` is there — the caller is not a browser and carries no
session cookie. The trailing slash matters: `PUBLIC_PREFIXES` matches with
`startsWith`, and this repo has already shipped one bug from a prefix that was
too short. `"/api/cron/"` cannot swallow a neighbouring route.

### Selecting who to email

```sql
subscriptionStatus = 'trialing'
AND trialReminderSentAt IS NULL
AND trialEndsAt BETWEEN now() AND now() + 8 days
```

A new nullable `Org.trialReminderSentAt` column makes this idempotent. Cron can
double-fire, a deploy can overlap a run, and a retried invocation must not mail
the same owner twice. The column is written *after* a successful send.

The window is eight days wide, not exactly seven-to-eight. The contract says "at
least 7 days before," so erring early is compliant and erring late is not; an
eight-day upper bound means a run that is skipped or fails still has a day of
slack before the promise breaks. Rows already reminded are excluded by the
column, so a wide window costs nothing.

The recipient is the org's `OWNER` user with a non-null email. Crew have no
email by design.

### The email

A new `trialEndingEmail()` in `src/lib/email/templates.ts`, carrying exactly
what Terms §3 promises: the date of the charge, the amount, and how to cancel.
No external images or scripts, per the existing rule that a remote asset leaks a
`Referer`.

`sendEmail` never throws — it logs and returns a boolean. The cron route must
therefore check the return value and write `trialReminderSentAt` only on `true`,
or a provider outage would silently mark everyone as reminded. This is the
documented "missing `RESEND_API_KEY` looks exactly like success" trap, and it is
the one place in this spec where getting it wrong is invisible in testing.

### The price, in one place

The reminder states an amount, `/pricing` (Spec 2) will state it again, and the
Terms state it a third time. A new `src/lib/pricing.ts` holds it once —
amount in cents, interval, and a formatted display string — and all three read
from there. Spec 2 consumes it rather than redefining it.

## Data model

```prisma
model Org {
  // ...
  trialReminderSentAt DateTime?
}
```

One nullable column, no backfill. Existing trialing orgs read as "not yet
reminded," which is correct — none have been. Applied with `prisma db push` to
both databases, per the repo's no-migrations rule.

## Testing

The suites that matter here, in the repo's existing style — `vi.hoisted` DAL
mocks, constructed Stripe events rather than signed HTTP:

- **Resubscribe adopts the subscription.** A cancelled org, a
  `checkout.session.completed` and `customer.subscription.created` carrying
  `metadata.orgId`, and the org ends `active` with the new subscription id.
- **The grandfathered case.** `stripeCustomerId: null` in, both ids written out.
- **The double-subscription guard.** An org holding a still-active subscription
  receives an event for a second one; assert the second is cancelled and the org
  keeps the first. Assert the reverse too: when the held subscription is
  `canceled`, the new one is adopted.
- **No second trial.** Assert the resubscribe Checkout call carries no
  `trial_period_days`. This is a revenue leak and a contract term, and it is
  invisible unless asserted directly.
- **Reminder idempotence.** Two consecutive cron runs send one email.
- **Reminder honours a send failure.** `sendEmail` returning `false` leaves
  `trialReminderSentAt` null so the next run retries.
- **Cron authorisation.** No header, wrong secret, and unset `CRON_SECRET` each
  yield 404 and no sends.
- **Window boundaries.** An org nine days out is not mailed; one six days out is.

Per `AGENTS.md`: prove the security tests fail when the protection is removed.
Specifically, deleting the `CRON_SECRET` comparison must fail the authorisation
test, and removing the double-subscription guard must fail that test.

## Deploy order

`CRON_SECRET` must exist in the production environment before the code deploys,
or the first cron invocation runs against a route that fails closed — harmless,
but it means no reminders go out until it is set.

1. Set `CRON_SECRET` in the production environment.
2. `npm run db:push` and `npm run db:push:test` — `trialReminderSentAt` must
   exist before anything reads it.
3. Deploy.
4. Confirm the cron appears in the Vercel dashboard and its first run returns
   200.

Unlike the original billing deploy, no step here is time-critical: the new
column is nullable and nothing reads it until the cron runs.

## What this does not fix

An org that lapses to `past_due` still relies on the Stripe Portal to fix its
card, which is correct — the subscription still exists and the portal can update
its payment method. Resubscribe deliberately refuses to run for an active org,
so there is no path to two concurrent subscriptions from the UI.

`AGENTS.md`'s "Known gap: no in-app way to start or restart a subscription"
section is rewritten as part of this work, including the incorrect Portal advice.
