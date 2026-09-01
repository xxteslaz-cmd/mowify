# Auto-renewal consent at signup

Spec 2 of 3. Spec 1 (billing lifecycle) has landed; Spec 3 (data lifecycle and
publication) follows and depends on the retention rule established here.

## Why this exists

Terms §3 sells a trial that converts into a recurring charge. The document is
drafted to satisfy the law that governs that; the signup screen is not, and the
law is about the screen.

What the signup page does today: a passive sentence under the form reading "By
creating a company you agree to our Terms of Service and Privacy Policy." There
is no checkbox, nothing states the conversion date, and the price appears once
as prose in a paragraph the visitor can skip. The card is then collected on
Stripe's page.

That is the gap. As the blueprint's own compliance notes put it: auto-renewal
compliance "is a flow problem, not a document problem... the clause is worthless
if the signup screen does not match."

The applicable rules, stated so a future reader does not have to re-derive them:
the FTC's click-to-cancel Negative Option Rule was vacated by the Eighth Circuit
in July 2025 and is **not** in force, but **ROSCA is** and the FTC enforces it
directly; state auto-renewal laws stack on top, California's AB 2863 being the
strictest. This spec is not legal advice and none of it has been reviewed by a
lawyer.

## What that requires of the screen

Four things, each of which is a code change rather than a wording change:

1. **The material terms appear before the card**, not behind a link — trial
   length, price, the date the charge happens, and how to cancel.
2. **Express affirmative consent to the trial terms**, in its own un-pre-ticked
   checkbox, *separate* from the general agreement to the Terms and Privacy
   Policy. One checkbox covering both does not isolate consent to the negative
   option.
3. **Cancellation is self-serve online**, because signup is online. Already
   true — Spec 1's `/billing` and the Stripe portal both cancel without
   contacting anyone — so this is a claim to keep honest, not to build.
4. **Proof of consent kept for at least three years.** AB 2863 requires it, and
   it is the only evidence that exists if a customer disputes the first charge.

## The retention conflict, and how it is resolved

Requirement 4 collides head-on with what Spec 3 is about to build.

Privacy §6 says account data is deleted 30 days after cancellation. It also
says, in the next paragraph, that "records evidencing your consent to
subscription and trial terms are retained for at least three years." Those two
sentences are both promises, and a consent record stored as columns on `Org`
cannot honour the second — Spec 3's deletion job would take it out at day 30,
two years and eleven months early, precisely when a dispute is most likely.

So consent lives in **its own table with no foreign key to `Org`**, holding a
copy of the identifying details rather than a reference to them. It is written
during provisioning and deliberately survives the deletion of everything it
refers to. Spec 3's purge must skip it, and its own `expiresAt` is what
eventually removes it.

This is the whole reason Spec 2 comes before Spec 3: the deletion job has to be
written already knowing what it must not delete.

## Where consent is captured

Consent is given on the signup form, which runs **before** the org exists —
nobody has an account until Stripe confirms a card. So it is recorded in two
steps, mirroring how the credential already flows:

```
signup action    → PendingSignup gains the consent columns
                   (the row a browser owns, one per attempt)
Stripe webhook   → provisioning copies them into ConsentRecord
                   (durable, three-year, no FK)
```

Recording it only at the webhook would be recording our own assertion that
consent happened. Recording it at signup ties it to the request that actually
carried the ticked box. Nothing is written to `ConsentRecord` for an attempt
that never pays, which is correct — there was no charge to consent to.

### What is stored

The timestamp and a version string are not enough on their own. A version
string proves nothing once the text it names has been edited, and "they ticked a
box" is not evidence of *what* they ticked. So the record keeps **the exact
disclosure text that was on screen**, rendered from the same constant the page
renders, alongside the terms version and the moment of agreement.

```prisma
model ConsentRecord {
  id           String   @id @default(cuid())
  // Deliberately not a relation. This row outlives the Org: account data goes
  // 30 days after cancellation, consent proof stays three years.
  orgId        String?
  email        String
  companyName  String
  kind         String    // "TRIAL_SUBSCRIPTION"
  termsVersion String
  disclosure   String    // the words that were actually on screen
  agreedAt     DateTime
  expiresAt    DateTime  // agreedAt + 3 years
  createdAt    DateTime  @default(now())
  @@index([email])
  @@index([expiresAt])
}
```

`expiresAt` is stored rather than computed so the retention period a record was
created under travels with it. Changing the constant later must not silently
shorten the retention of records already written.

## The signup screen

The disclosure block sits above the submit button — the button that leads to the
card form — and states the four material terms in plain language. It is rendered
from `trialDisclosure()` in `src/lib/consent.ts`, the single source that the
stored record also uses, so the page and the evidence cannot drift apart.

Two checkboxes, both unticked, both required:

- **Trial terms.** Names the conversion explicitly: after 30 days the card is
  charged $49 every month until cancelled, and cancelling before then costs
  nothing.
- **Terms and Privacy.** Replaces today's passive sentence with an actual
  agreement.

They are validated server-side in the `signup` action, not merely marked
`required` in the markup. A `required` attribute is a client-side convenience
that a crafted request bypasses entirely, and the consent has to be real for the
record to be worth keeping. Zod parses them as literal `"on"`, because an
unchecked HTML checkbox submits **nothing at all** — an absent key, not `false`.

## The acknowledgement email

The blueprint asks for an acknowledgement after signup restating the terms and
the cancellation method.

**It must not be sent from the signup action.** AGENTS.md records why: "Signup
deliberately sends nothing at all: it is unauthenticated, and mailing from it
let anyone drive arbitrary recipients from the sending domain." That reasoning
is unchanged and this spec does not weaken it.

It is sent from the webhook instead, after provisioning succeeds. By then Stripe
has confirmed a card against that address, so it is no longer an arbitrary
recipient — it is a paying customer — and the email is describing a charge that
is genuinely scheduled. `sendEmail` never throws, so a failure here cannot
affect whether the org gets created.

That places a `sendEmail` call in `src/lib/stripe/handle-event.ts`, which the
ESLint email boundary currently forbids. The exemption is added for that one
named file. It already carries `import "server-only"`, so it cannot reach a
client bundle regardless — the lint rule is the earlier of two guards there, not
the only one.

## The pricing page

Terms §4 points at `groundsroute.com/pricing` for the rates. That route does not
exist, so the Terms cannot publish until it does.

A public page at `/pricing`, reading `src/lib/pricing.ts` (added in Spec 1) so
the number matches the reminder email and the Terms. Added to `PUBLIC_PREFIXES`
and to the sitemap; it is a page we want indexed, unlike `/login`.

## Testing

- **Both checkboxes are enforced server-side.** Omit each in turn from the
  submitted `FormData`; assert no `PendingSignup` row and no Checkout call.
  Marking a box `required` in HTML must not be what stops this.
- **Consent is recorded on the pending row**, with the disclosure text, not just
  a flag.
- **Provisioning writes a `ConsentRecord`** with `expiresAt` three years out.
- **The record has no FK to `Org`** — delete the org and assert the record is
  still readable. This is the test that protects Spec 3 from itself.
- **The acknowledgement is sent once**, from the webhook, and a replayed event
  does not send a second.
- **A failed send does not fail provisioning** — the org still exists.
- **`/pricing` renders signed out** and states the same figure as the reminder.

Per AGENTS.md, prove the protections fail when removed: dropping either
server-side consent check must fail its test.

## Deploy order

1. `npm run db:push` and `npm run db:push:test` — `ConsentRecord` and the
   `PendingSignup` columns must exist before the code reads them.
2. Deploy.

No time-critical pair here. Existing orgs have no `ConsentRecord`, which is
accurate — they signed up before consent was captured, and inventing records for
them would be manufacturing evidence.
