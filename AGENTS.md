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
argon2 (`@node-rs/argon2`) · Zod · Resend · Stripe (designed, not yet built).

## Shape of the thing

- `src/lib/auth/` — the security core. `dal.ts` is the authorization boundary;
  `session.ts`, `token.ts`, `password.ts`/`hash.ts`, `lockout.ts`, `slug.ts`.
- `src/lib/data.ts` — every read the owner-facing app performs.
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

## Import boundaries (ESLint-enforced)

- Application code imports hashing from `@/lib/auth/password`, never
  `@/lib/auth/hash`. `hash.ts` has no `server-only` guard so scripts can use it;
  the lint rule is what keeps it out of client bundles.
- `@/lib/email/client` may only be imported from `src/app/**/actions.ts`.

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

111 tests. `npm test` runs them against the test database.

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
