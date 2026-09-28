# Marketing backlog

Open items from the groundsroute.com site review on 28 September 2026. The
technical findings from that review (real 404s, the web manifest, prerendered
public pages, structured data, hero image priority, login metadata) are done
and live. What is left below needs the owner's input, not just code.

## 1. More pages for search to find

The sitemap lists five pages: home, signup, pricing, terms, privacy. Nothing on
the site answers the searches a landscaping owner actually makes, such as
"landscaping crew scheduling app", "lawn care route software" or
"Jobber alternative".

Candidates, roughly in order of value:

- **FAQ.** Card requirement, what crews need on their phones, how recurring
  jobs work, exporting data, cancelling. Doubles as objection handling on the
  way to signup.
- **Comparison page** (GroundsRoute vs Jobber, vs LawnPro). Positioning: one
  job done simply, one flat $49 price, no per-user fees. Every claim about a
  competitor must be checked against their current public pricing before it
  ships, and dated.
- **"How crews use it"** walkthrough of the phone view, using the demo-company
  screenshots.

Each new public page must be added to `PUBLIC_PREFIXES` in `src/proxy.ts`
(the route-coverage test in `src/proxy.test.ts` fails until it is) and to
`src/app/sitemap.ts`.

## 2. Trust

The landing page has no testimonials, customer count, founder story or About
page. For a $49/month product that asks for a card before the trial, trust is
the most likely reason a visitor leaves without signing up.

- Testimonials must be real quotes from real customers, with permission.
  Never placeholder or invented ones.
- A short About section or page: who builds this and why. The owner is a
  named individual in the Terms, which is already a trust asset.
- A customer count or "used by N crews" only once the number helps rather
  than hurts.

## 3. The card-required trial

Stated honestly on every page, which is right, but it is the single biggest
barrier in the signup funnel. Options if signups are low:

- A no-card trial. **Not a copy change.** It touches the Stripe Checkout
  flow (`PendingSignup`, the webhook that creates the `Org`), the ROSCA
  consent screen and its stored disclosure text, the trial-reminder cron, and
  Terms section 3. Read the Billing section of `AGENTS.md` before starting.
- Cheaper to try first: a short demo video, or a read-only sample dashboard
  a visitor can click around before signing up.

Decide based on real funnel numbers (landing → signup page → Checkout started
→ Checkout completed), not guesses.
