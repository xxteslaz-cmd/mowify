# Multi-tenant authentication for Mowify

**Date:** 2026-07-27
**Status:** Approved, ready for implementation planning

## Problem

Mowify has no authentication. Every route is publicly reachable and every server
action in `src/app/dashboard/actions.ts` and `src/app/customers/actions.ts` is
callable by anyone who finds the URL. Customer names, addresses, and phone
numbers are exposed, and any visitor can create, reschedule, or delete jobs.

Mowify is also becoming a multi-tenant product: many landscaping companies sign
up independently, each with isolated crews, customers, and jobs. The current
schema has no notion of a company, so isolation has to be introduced alongside
authentication.

## Goals

- Owners sign up, creating their company, and log in with email and password.
- Owners create logins for their crew members, who sign in with a username and PIN.
- Crew members see only their own day view; owners see everything in their company.
- No company can read or mutate another company's data under any circumstance.
- Existing production data is preserved and assigned to its owner.

## Non-goals

These are deliberately excluded. Both require a transactional email provider,
which is not configured for this project.

- **Owner password reset.** A forgotten owner password is a manual database fix
  until an email provider is added. Adding Resend is a recommended follow-up.
- **Email verification on signup.** Accounts are usable immediately.

Also out of scope: social login, multi-factor authentication, multiple owners per
company, and crew members belonging to more than one crew.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Tenancy | Multi-tenant, one `Org` per company | Product is SaaS; many companies sign up separately |
| Roles | `OWNER`, `CREW` | Two genuinely different jobs; more roles are speculative |
| Owner credentials | Email + password | Owners have email; standard and familiar |
| Crew credentials | Username + PIN, set by the owner | Field crews often lack work email and type on phones in gloves |
| Crew login routing | Company slug in the URL, `/c/[slug]` | Usernames stay unique per-company, not globally; two fields on a phone instead of three |
| Auth implementation | Hand-rolled | Two distinct credential types; a library's org plugin assumes email+password and would be fought, not used |
| Sessions | Database-backed, opaque token | Crew turnover and lost phones make instant revocation a requirement, which stateless JWTs cannot provide |
| PIN length | 6 digits + lockout | 4 digits is 10,000 guesses, trivially scripted against real customer PII |

## Data model

### New models

```prisma
enum Role {
  OWNER
  CREW
}

model Org {
  id        String     @id @default(cuid())
  name      String
  slug      String     @unique   // "acme-lawn", used in the crew login URL
  users     User[]
  crews     Crew[]
  customers Customer[]
  jobs      Job[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model User {
  id    String @id @default(cuid())
  orgId String
  org   Org    @relation(fields: [orgId], references: [id])
  role  Role
  name  String

  // Owner credentials. Null for CREW users.
  email        String? @unique
  passwordHash String?

  // Crew credentials. Null for OWNER users.
  // Unique per-org rather than globally, so every company can have a "jose".
  username String?
  pinHash  String?
  crewId   String?
  crew     Crew?   @relation(fields: [crewId], references: [id])

  active Boolean @default(true)

  // PIN and password brute-force throttling.
  failedAttempts Int       @default(0)
  lockedUntil    DateTime?

  sessions Session[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([orgId, username])
  @@index([orgId])
}

model Session {
  id        String   @id @default(cuid())
  // SHA-256 of the cookie token. The raw token is never stored, so a database
  // leak yields no usable session cookies.
  tokenHash String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
}
```

### Changes to existing models

`Crew`, `Customer`, and `Job` each gain a required `orgId` with an `org`
relation. `Crew` additionally gains a `users User[]` back-relation for the
`User.crew` link.

Existing indexes gain `orgId` as their leading column, since every query is now
org-scoped:

- `Job`: `@@index([orgId, scheduledDate])`, `@@index([orgId, crewId, scheduledDate])`, `@@index([orgId, customerId])`, `@@index([orgId, seriesId])`
- `Crew`, `Customer`: `@@index([orgId])`

### Credential integrity

The `User` model expresses two credential shapes in one table, so the nullable
columns must not drift into invalid combinations. Enforce in application code at
the single point where users are created:

- `OWNER` rows must have `email` and `passwordHash`, and must have null
  `username`, `pinHash`, and `crewId`.
- `CREW` rows must have `username`, `pinHash`, and `crewId`, and must have null
  `email` and `passwordHash`.

A `CREW` user's `crewId` must reference a `Crew` in the same org. This is checked
when the owner creates or edits a crew login.

## Migration of existing data

Existing crews, customers, and jobs predate `Org` and must not be dropped. Three
steps, following the pattern already established in `prisma/backfill.ts`:

1. **Migration 1** adds `Org`, `User`, `Session`, and a *nullable* `orgId` on
   `Crew`, `Customer`, and `Job`.
2. **Backfill script** (`prisma/backfill-org.ts`, run via a `db:backfill-org`
   npm script) creates one `Org` for the existing data, sets `orgId` on every
   existing crew, customer, and job, and creates the owner `User` from an email
   and password supplied as environment variables. The script is idempotent: it
   exits without changes if an Org already exists.
3. **Migration 2** makes `orgId` non-nullable and adds the foreign keys and
   indexes.

Splitting into two migrations means no step ever runs against rows it would
reject, and the database is never in a state where existing data has been
deleted.

## Auth module

New directory `src/lib/auth/`:

### `password.ts`

`hash(plaintext)` and `verify(hash, plaintext)` using argon2id. Used for both
owner passwords and crew PINs. PINs are hashed with the same cost as passwords;
a 6-digit PIN needs the work factor more than a password does, not less.

### `session.ts`

- `createSession(userId, role)` — generates 32 cryptographically random bytes,
  base64url-encodes them as the cookie value, stores only the SHA-256 in
  `Session.tokenHash`. Cookie is `httpOnly`, `secure`, `sameSite: "lax"`,
  `path: "/"`. Expiry is 7 days for `OWNER`, 30 days for `CREW`.
- `refreshSession(session)` — sliding expiry. Extends the cookie and the row when
  the session is more than halfway to expiring, so a working crew is never
  logged out mid-route.
- `deleteSession()` — deletes the row and clears the cookie.

Sessions are looked up by hashing the incoming cookie and querying `tokenHash`,
never by scanning.

### `dal.ts`

The authorization boundary. Wrapped in React's `cache()` so a render pass costs
one query.

```ts
verifySession()  // → { userId, orgId, role, crewId } | redirects to login
requireOwner()   // → same, or redirects/403s if role !== OWNER
requireCrew()    // → same, or redirects/403s if role !== CREW
```

`verifySession()` reads the cookie, hashes it, loads the session joined to its
user, and rejects if the session is missing, expired, or the user is inactive.
Expired rows are deleted on encounter.

## Enforcement

### Data layer

Every function in `src/lib/data.ts` calls the DAL itself rather than accepting an
`orgId` parameter from its caller:

```ts
export async function getJobsForDate(dateISO: string) {
  const { orgId } = await requireOwner();
  return prisma.job.findMany({
    where: { orgId, scheduledDate: parseISODate(dateISO) },
    include: { customer: true, crew: true },
    orderBy: [{ orderInDay: "asc" }],
  });
}
```

This is the Data Access Layer pattern recommended by the Next.js authentication
guide. It matters because there is no argument to forget: a caller cannot
accidentally omit the scope, and page components need no changes at all.

All seven exported functions are converted: `getDaySummaries`, `getActiveCrews`,
`getAllCrews`, `getJobsForDate`, `searchCustomers`, `getCustomerWithJobs`,
`getCrewTodayJobs`.

`getCrewTodayJobs(crewId, dateISO)` is the one that accepts both roles. It calls
`verifySession()`; a `CREW` user may only pass their own `crewId`, an `OWNER` may
pass any `crewId` within their org. Anything else returns no crew, which the page
renders as a 404.

### Server actions

There are twelve actions across `dashboard/actions.ts` and
`customers/actions.ts`. Eleven of them begin with `requireOwner()` and add
`orgId` to every `where` clause, including single-record lookups by ID. A forged
ID belonging to another company therefore matches zero rows rather than mutating
another company's data. These eleven are `deleteJob`, `updateJob`,
`updateJobFrequency`, `updateCrew`, `deleteCrew`, `moveJobInColumn`,
`bulkRescheduleDay`, `createJob`, `createCrew`, `createCustomer`, and
`updateCustomer`.

`updateJobStatus` is the sole exception, because the crew day view calls it
(`src/app/crew/[crewId]/today/StopCard.tsx`). It accepts either role. For an
`OWNER` it requires the job to be in their org; for a `CREW` user it additionally
requires the job's `crewId` to equal the user's own `crewId`, so a crew member
cannot mark another crew's stops complete.

New jobs, crews, and customers are created with the acting user's `orgId`, never
an `orgId` supplied by the client.

### `proxy.ts`

Next 16 renames `middleware.ts` to `proxy.ts` and runs it on the Node.js runtime.
It performs an optimistic check only: if no session cookie is present and the
path is not public, redirect to `/login`. It does not query the database, because
it runs on every request including prefetches.

This is a redirect convenience, not the security boundary. The DAL is the
boundary, because it sits next to the data.

Public paths: `/login`, `/signup`, `/c/[slug]`, and Next.js internals.

## Routes and UI

| Route | Access | Purpose |
|---|---|---|
| `/signup` | public | Creates `Org` + owner `User` in one transaction. Fields: your name, company name, email, password. Slug derived from company name, lowercased and hyphenated, de-duplicated with a numeric suffix. |
| `/login` | public | Owner email + password. |
| `/c/[slug]` | public | Crew login. Resolves the org by slug and displays its name, then username and PIN fields. PIN input uses `inputMode="numeric"` so phones present a number pad. Unknown slug 404s. |
| `/team` | owner | Crew login management. |
| `/` | any | Redirects to `/dashboard` for owners, to the crew's own day view for crew, to `/login` when signed out. |

### `/team`

Lists the company's crew members with name, username, and assigned crew. Owners
can add a crew login (name, username, initial PIN, crew), reset a PIN — which
also clears any lockout — and deactivate a login, which sets `active = false` and
deletes that user's sessions so the change takes effect immediately.

The page also displays the company's crew login URL (`/c/acme-lawn`) with a copy
button, since that link is what the owner texts to their crew.

### Nav panel

`MainNav` gains a right-aligned signed-in section: the user's name, and a menu
containing *Team* (owners only) and *Sign out*.

The Next.js docs warn that a top-level `await` on session data in a layout delays
the first streamed chunk and holds `{children}` behind it. So the session read
lives in a small nested Server Component wrapped in `<Suspense>`, not in
`layout.tsx` directly. `MainNav` stays a client component and receives the user's
name and role as props.

Crew members see a reduced nav with no Dashboard or Customers links, since those
routes reject them anyway.

## Error handling

- **Failed login** returns a generic "Invalid username or PIN" (or "Invalid email
  or password") through `useActionState`, identical whether the account exists or
  the credential was wrong, so the form cannot be used to enumerate accounts.
- **Lockout** is the deliberate exception and says so explicitly, including when
  the lock lifts. A locked-out crew member needs to know to call their boss
  rather than keep guessing. Threshold: 5 consecutive failures locks the account
  for 15 minutes. A successful login resets `failedAttempts` to zero.
- **Expired or revoked session** clears the cookie and redirects to the login
  page appropriate to that user's role.
- **Signup collisions** on email or company slug surface as field-level errors,
  not a generic failure.
- **Cross-org access attempts** are indistinguishable from missing records: they
  404, and do not reveal that the resource exists elsewhere.

## Testing

The repository has no test setup today. This work adds Vitest, configured to run
against a test database.

Coverage targets the places where a bug is a breach rather than a glitch:

- **Session tokens** — hashing round-trip, expired sessions rejected, deleted
  sessions rejected immediately, sliding refresh extends only past the halfway
  point.
- **Credentials** — argon2 round-trip, wrong password and wrong PIN rejected.
- **Lockout** — locks at exactly 5 failures, stays locked until `lockedUntil`,
  a successful login resets the counter, an owner PIN reset clears the lock.
- **Cross-org isolation** — the most important suite. Seed two orgs with crews,
  customers, and jobs, then assert that a session for org A cannot read or mutate
  any org B record through any of the seven data functions or twelve server
  actions, including by passing a valid org B ID directly.
- **Crew authorization** — a crew user cannot load another crew's day view, and
  cannot call `updateJobStatus` on a job assigned to another crew.
- **Migration** — the backfill assigns every pre-existing row to the new org and
  is idempotent on a second run.

## Implementation notes

New dependencies: an argon2 implementation (`@node-rs/argon2`), `zod` for form
validation, and `vitest` as a dev dependency.

`AGENTS.md` requires reading the relevant guide in `node_modules/next/dist/docs/`
before writing code, as this Next.js version has breaking changes. Relevant
guides for this work: `01-app/02-guides/authentication.md`,
`01-app/03-api-reference/03-file-conventions/proxy.md`,
`01-app/02-guides/data-security.md`, and
`01-app/03-api-reference/03-file-conventions/forbidden.md`. The
`middleware.ts` → `proxy.ts` rename is already confirmed; assume other APIs
differ from prior versions until checked.
