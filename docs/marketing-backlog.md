# Marketing backlog

Open items from the groundsroute.com site review on 28 September 2026. The
technical findings from that review are done and live; see "Done" at the
bottom. What is left above it needs the owner's input, not just code.

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

---

## Done

All shipped to production on 28 September 2026 and checked against the live
site afterwards.

### Commit 18ccc83: real 404s, prerendered pages, web manifest

- **Unknown URLs return a 404 instead of redirecting to /login.** The proxy
  now redirects only paths under `PROTECTED_SEGMENTS` in `src/proxy.ts`, and
  everything else reaches `src/app/not-found.tsx`. A test in
  `src/proxy.test.ts` walks `src/app` and fails for any route the proxy does
  not classify as public or protected, so a new page cannot go out
  unprotected by accident.
- **`/manifest.webmanifest` exists** (`src/app/manifest.ts`), so crews can add
  the app to a phone home screen. Before, the path redirected to /login.
- **Public pages are prerendered and served from Vercel's cache.** The root
  404 page read cookies, which made `/pricing`, `/terms` and `/privacy` render
  on every request. It no longer does. `/` is static too: requests carrying a
  session cookie are rewritten to `/home` (`src/app/home/page.tsx`), which holds
  the signed-in redirect logic. The homepage's server response time went from
  about 0.25–0.48s to about 0.1–0.17s.

### Commit 628aaa4: structured data, image priority, login metadata

- **SoftwareApplication JSON-LD** on the landing page (`src/app/page.tsx`),
  with the price and trial read from `src/lib/pricing.ts`. Google generally
  needs ratings or reviews before it shows a rich result for this type.
- **Only the dashboard screenshot is fetched at high priority.** Both product
  shots were before, so the phone frame competed with the image the browser
  scores as the largest paint.
- **`/login` has its own description and is `noindex, follow`.**

### Still to verify

- Sign in as an owner, open `/`, and confirm it goes to the dashboard. This
  could not be tested without real credentials.
- Run the full `npm test`. The Neon test database timed out from the review
  machine, so only `src/proxy.test.ts` ran.
