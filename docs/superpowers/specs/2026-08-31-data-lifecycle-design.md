# Data lifecycle, and publishing the documents

Spec 3 of 3. Specs 1 (billing lifecycle) and 2 (auto-renewal consent) have
landed. This is the one that finally publishes the Terms and Privacy Policy,
and it is the only spec that deletes anything.

## Why this exists

Three remaining promises, then publication.

**Terms §5 / Privacy §6 — export.** "You may request an export of your Customer
Data at any time while your subscription is active." Nothing exports anything.

**Terms §3, §4, §5 / Privacy §6 — deletion.** Data is kept 30 days after a trial
lapses or a subscription is cancelled, then deleted. Nothing deletes anything;
a cancelled company's records currently sit in Postgres indefinitely, which
contradicts the policy we are about to publish.

**Publication.** The live pages are a shorter in-house draft that contradicts
the blueprints in places — it says data is deleted "within 90 days" where the
blueprint says 30, and "under 16" where the blueprint says under 13. So the
blueprint content replaces the page bodies wholesale rather than merging.

## Part A — Export

A Route Handler at `GET /api/export`, not a Server Action: an action returns
data to a React tree, and what is wanted here is a file the browser saves.

- Owner-only, via `requireOwner()`. It is not in `PUBLIC_PREFIXES`, so
  `proxy.ts` bounces a signed-out request before it renders, and the DAL check
  is the real one behind that.
- **Ungated by subscription status.** `requireOwner`, not `requireActiveOrg`.
  Terms §3 promises a lapsed company 30 days to "request an export during that
  window", so gating on an active subscription would break the promise for
  exactly the people it was written for.
- One JSON document: the company, its customers, crews, and jobs.
  Machine-readable is what data-portability language means, and JSON keeps
  relationships intact where a pile of CSVs would not.
- Scoped by `orgId` from the session, never from input. Same rule as everything
  else that touches tenant data.
- `Content-Disposition: attachment` with a dated filename.

Reached from `/settings`, which is already owner-only.

## Part B — Deletion

The destructive part, and the part to be most careful with.

### Knowing when the clock started

`subscriptionStatus` says a company is lapsed but not *since when*, and "30 days
after cancellation" needs a date. So `Org.lapsedAt`, written in
`mirrorSubscription`:

- set to `now()` on the transition from an active status to a lapsed one,
- **left alone** while it stays lapsed, or the 30 days would restart on every
  webhook and nothing would ever be deleted,
- cleared when the org becomes active again.

Deriving it from Stripe's `canceled_at` was rejected: a grandfathered org has no
subscription to read it from, and a trial that lapsed without payment has no
cancellation event either.

### What the job does

`GET /api/cron/purge`, daily, authenticated with `CRON_SECRET` exactly as the
trial reminder is — the same `authorized()` logic, moved into a shared module
now that two routes need it.

Selection is deliberately conservative, and re-checked at deletion time:

```
lapsedAt IS NOT NULL
AND lapsedAt < now() - 30 days
AND subscriptionStatus NOT IN ('trialing', 'active')
```

The status condition is redundant with `lapsedAt` being set, and that is the
point: it is a second, independent reason to refuse. A bug that leaves
`lapsedAt` set on a paying company must not be sufficient on its own to delete
that company's data.

Deletion runs in a transaction per org, children before parents:
`Session`, `Job`, `User`, `Customer`, `Crew`, `PendingSignup`, then `Org`.

**`ConsentRecord` is never touched here.** It has no foreign key to `Org`
precisely so this job cannot reach it; the Privacy Policy keeps consent proof
for three years while account data goes at 30 days. Expired consent records are
removed by the same job, but by their own `expiresAt` and nothing else.

### Guards

Deleting customer records is not undoable, so:

- **A hard cap per run.** More than 50 orgs selected in a single run means
  something is wrong with the query, not that 50 companies cancelled overnight.
  The job logs loudly and deletes nothing.
- **A kill switch.** `PURGE_ENABLED` must equal `"yes"`. The route is otherwise
  a no-op that still reports what it *would* delete, so the selection can be
  watched in production for a while before anything is destroyed. This is the
  setting to leave unset until the numbers look right.
- Each org is re-read inside its transaction and re-checked against both
  conditions before anything is deleted.

## Part C — Publishing the documents

`/terms` and `/privacy` are rewritten from the blueprint drafts. The source
documents are the `_1` pair, which resolve placeholders the earlier drafts left
open.

### The placeholders

| Placeholder | Value |
|---|---|
| Legal name | **Chad Slaughter**, an individual doing business as GroundsRoute |
| Website | groundsroute.com |
| Governing law | Pennsylvania |
| Price | $49/month — **annual dropped**, per the decision to stay monthly-only |
| Hosting | Vercel |
| Retention | 30 days / 90 days logs / 7 years billing / 3 years consent |
| **Mailing address** | **still unknown — renders as a visible placeholder** |
| **County** (venue, §15) | **still unknown — renders as a visible placeholder** |

The last two are not invented. `src/lib/legal.ts` already establishes the
convention and the reason: these values are "rendered verbatim onto the pages so
an unfilled placeholder is visible to anyone who looks rather than hidden in a
config file nobody opens." A fabricated address on a contract is worse than an
obvious blank, so the blank stays and is reported.

### Consistency the code must enforce

Every number the documents state that the code also implements reads from the
same constant rather than being typed into the page: the price and trial length
from `src/lib/pricing.ts`, the retention windows from a new `RETENTION` block in
`src/lib/legal.ts` that the purge job also reads. A document that says 30 days
while the job uses 45 is a false statement, and the only way to prevent that
reliably is to make it one number.

Terms §3's seven-day reminder, §5's export, §4's cancellation path and §3's
"pick up where you left off" all now describe things that exist — which was the
entire point of sequencing publication last.

## Testing

- Export returns only the caller's own org's data, and a second org's customers
  are absent. This is the isolation test that matters most here.
- Export works for a **lapsed** org.
- Purge deletes an org 31 days lapsed; leaves one 29 days lapsed.
- Purge never deletes an active or trialing org, even with `lapsedAt` set far in
  the past — the independent second condition.
- Purge **leaves `ConsentRecord` intact** after deleting the org it names.
- Purge removes a consent record past its own `expiresAt`.
- `PURGE_ENABLED` unset deletes nothing but still reports a count.
- The cap refuses a run that selects too many.
- `lapsedAt` is set on the transition, not refreshed while lapsed, and cleared
  on recovery.
- The published pages state the same price and retention numbers as the code.

Per AGENTS.md, prove each protection fails when removed: the status re-check,
the cap, and the kill switch.

## Deploy order

1. `npm run db:push` / `db:push:test` — `lapsedAt` must exist first.
2. Deploy with `PURGE_ENABLED` **unset**. The job reports what it would delete
   and deletes nothing.
3. Watch the reported counts for at least one full billing cycle.
4. Set `PURGE_ENABLED=yes` only once those numbers look right.

Step 2 is not optional. The first run of a deletion job against real customer
data should never be its first run at all.
