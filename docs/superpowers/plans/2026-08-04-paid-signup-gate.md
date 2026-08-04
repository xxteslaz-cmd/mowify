# Paid Signup Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No `Org` or `User` row exists until Stripe confirms a valid card, and an org whose subscription later lapses drops to read-only without stranding its crews.

**Architecture:** Signup writes a `PendingSignup` row plus an httpOnly claim cookie and redirects to Stripe Checkout. A signature-verified webhook is the only code that creates orgs. `/billing/return` claims the finished account using the cookie and signs the owner in. A `requireActiveOrg()` gate in the DAL guards every owner write path; `updateJobStatus` deliberately stays outside it.

**Tech Stack:** Next.js 16 App Router · React 19 · Prisma 7 with `@prisma/adapter-pg` · PostgreSQL · Stripe Node SDK · Zod · Vitest · argon2 (`@node-rs/argon2`).

**Spec:** `docs/superpowers/specs/2026-08-04-paid-signup-gate-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Read the relevant guide in `node_modules/next/dist/docs/` before writing code.** This Next version differs from training data.
- **Every commit must pass all four:** `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`. `npm test` alone is insufficient — Vitest transpiles without typechecking.
- **Schema changes must reach both databases:** `npm run db:push` and `npm run db:push:test`. There is no migrations directory.
- **Never write to `DATABASE_URL`.** It is live production data. Task 9's script is the sole exception and requires the owner's explicit say-so at run time.
- **Server Actions must return error state, never throw it.** A thrown message is redacted by production React. `redirect()` is exempt — it is Next control flow, not an error.
- **`err.meta.target` is `undefined` with `@prisma/adapter-pg`.** Use `p2002Fields` from `src/lib/prisma-errors.ts`.
- **Anything reaching Prisma's `data` needs a `.strict()` Zod allowlist.** A Server Action's TypeScript parameter type is erased at runtime.
- **Zod: `.trim()` before `.min()`.**
- **`src/proxy.ts` matches public paths with `startsWith`.** `"/"` is an exact match on purpose.
- **The session cookie stays named `mowify_session`.** Renaming signs out every existing session.
- **Prove security tests fail when the protection is removed.** A green run alone is not evidence.
- **Comments explain *why*, not *what*, in full sentences.**
- **Kill any dev server you start.**

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/url.ts` | `appUrl()` and `requireAppUrl()`. Extracted so non-email code can build absolute URLs without tripping the ESLint boundary on `@/lib/email/client`. |
| `src/lib/stripe/config.ts` | Reads and validates the four Stripe env vars. Fails loudly. |
| `src/lib/stripe/client.ts` | The configured Stripe SDK instance. |
| `src/lib/subscription.ts` | `isOrgActive(status)` and the active-status list. Pure, no I/O. |
| `src/lib/provision.ts` | `createOrgWithOwner()` — the slug-collision retry loop, moved out of the signup action so the webhook can use it. |
| `src/app/api/stripe/webhook/route.ts` | The only route that creates orgs or writes subscription state. |
| `src/app/billing/return/page.tsx` | Public. Renders the claim client. |
| `src/app/billing/return/ReturnClient.tsx` | Polls the claim action, renders pending/ready/failed. |
| `src/app/billing/return/actions.ts` | `claimAccount()` — cookie check, session creation, Stripe fallback. |
| `src/app/(app)/billing/page.tsx` | Owner billing status. |
| `src/app/(app)/billing/actions.ts` | `openBillingPortal()`. |
| `src/components/LapsedBanner.tsx` | Prompt shown across the app shell when lapsed. |
| `prisma/backfill-subscriptions.ts` | Grandfathers pre-existing orgs. |
| Test files | Listed per task. |

**Modified:** `prisma/schema.prisma`, `src/lib/auth/dal.ts`, `src/lib/email/client.ts`, `src/app/signup/actions.ts`, `src/proxy.ts`, `src/test/setup.ts`, `src/test/factories.ts`, `src/app/(app)/layout.tsx`, the four `actions.ts` files under `src/app/(app)/`, both isolation test files, `.env.example`, `package.json`, `AGENTS.md`.

## Two refinements to the spec, decided here

1. **Subscription events re-fetch from Stripe rather than diffing timestamps.** The spec says to ignore an event describing an older state than the one stored. Re-retrieving the subscription by id and mirroring *that* achieves the same guarantee with no ordering logic and no extra column, because the API always returns current truth. The cost is one API call per subscription webhook, which is negligible at this volume.
2. **`appUrl` moves to `src/lib/url.ts`.** It currently lives in `src/lib/email/client.ts`, which ESLint restricts to `src/app/**/actions.ts`. The webhook route and Stripe config both need it. `email/client.ts` re-exports it so no existing import changes.

---

### Task 1: Schema — `PendingSignup` and the `Org` subscription columns

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/test/setup.ts:13-20`
- Modify: `src/test/factories.ts`
- Test: `src/lib/pending-signup.schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma.pendingSignup` client model; `Org.stripeCustomerId`, `Org.stripeSubscriptionId`, `Org.subscriptionStatus`, `Org.trialEndsAt`, `Org.currentPeriodEnd`; test factory `makePendingSignup(overrides?): Promise<PendingSignup>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pending-signup.schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makePendingSignup } from "@/test/factories";

describe("PendingSignup schema", () => {
  it("stores a signup awaiting payment", async () => {
    const pending = await makePendingSignup({ email: "a@example.com" });
    expect(pending.consumedAt).toBeNull();
    expect(pending.orgId).toBeNull();
    expect(pending.passwordHash).not.toBeNull();
  });

  it("allows only one row per email, so a retry must reuse it", async () => {
    await makePendingSignup({ email: "dup@example.com" });
    await expect(makePendingSignup({ email: "dup@example.com" })).rejects.toThrow();
  });

  it("allows only one row per claim hash", async () => {
    await makePendingSignup({ email: "one@example.com", claimHash: "shared" });
    await expect(
      makePendingSignup({ email: "two@example.com", claimHash: "shared" }),
    ).rejects.toThrow();
  });

  it("defaults an org to no subscription at all", async () => {
    const org = await makeOrg();
    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.subscriptionStatus).toBeNull();
    expect(fresh.stripeCustomerId).toBeNull();
    expect(fresh.trialEndsAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/pending-signup.schema.test.ts`
Expected: FAIL — `makePendingSignup` is not exported from `@/test/factories`.

- [ ] **Step 3: Add the model and columns**

In `prisma/schema.prisma`, add these fields inside `model Org` above `createdAt`:

```prisma
  stripeCustomerId     String?   @unique
  stripeSubscriptionId String?   @unique
  // Mirrored from Stripe's subscription.status: trialing, active, past_due,
  // canceled, unpaid, incomplete. Never computed from our own clock, because
  // Stripe knows whether the money arrived and we do not.
  subscriptionStatus   String?
  trialEndsAt          DateTime?
  currentPeriodEnd     DateTime?
```

Add a new model at the end of the file:

```prisma
// A signup that has been entered but not paid for. No Org or User exists for
// it yet: that is the whole point of the gate. The webhook promotes a row here
// into a real account once Stripe confirms a card.
model PendingSignup {
  id String @id @default(cuid())
  // Unique because a retry reuses this row rather than adding a second one.
  // One row per email means a checkout the visitor abandoned and later
  // completed anyway still resolves here by id, and the claim cookie can only
  // ever point at one place.
  email String @unique
  name        String
  companyName String
  // Nulled once the account exists. There is no reason to keep a credential
  // after it has been copied onto the User row.
  passwordHash String?
  // SHA-256 of the value held in the claim cookie. Same reasoning as Session:
  // only the hash is stored, so a database leak yields nothing that can claim
  // somebody else's paid account.
  claimHash         String  @unique
  checkoutSessionId String? @unique
  orgId             String?
  failedReason      String?
  // Set on completion and never cleared. This is what makes a replayed webhook
  // a no-op rather than a second org.
  consumedAt DateTime?
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  @@index([expiresAt])
}
```

- [ ] **Step 4: Push the schema to both databases**

```bash
npm run db:push && npm run db:push:test
```

Expected: both report the database is in sync. If `db:push` prompts about data loss, stop and report — these are additive columns and must not require a reset.

- [ ] **Step 5: Add the factory and extend the test reset**

Append to `src/test/factories.ts`:

```ts
export async function makePendingSignup(
  overrides: Partial<{
    email: string;
    name: string;
    companyName: string;
    passwordHash: string;
    claimHash: string;
    checkoutSessionId: string;
    expiresAt: Date;
  }> = {},
) {
  const suffix = unique();
  return prisma.pendingSignup.create({
    data: {
      email: overrides.email ?? `pending-${suffix}@example.com`,
      name: overrides.name ?? "Test Owner",
      companyName: overrides.companyName ?? `Pending Co ${suffix}`,
      passwordHash: overrides.passwordHash ?? (await hashSecret("owner-password")),
      claimHash: overrides.claimHash ?? `claim-${suffix}`,
      checkoutSessionId: overrides.checkoutSessionId ?? null,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });
}
```

In `src/test/setup.ts`, add to `resetDb()` before `prisma.org.deleteMany()`:

```ts
  await prisma.pendingSignup.deleteMany();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- src/lib/pending-signup.schema.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Verify the whole suite still passes**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`
Expected: all pass, 111 existing tests plus 4 new.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma src/test/setup.ts src/test/factories.ts src/lib/pending-signup.schema.test.ts
git commit -m "Add PendingSignup and the Org subscription columns"
```

---

### Task 2: `isOrgActive` and the `requireActiveOrg` gate

This task builds the enforcement half. It touches no Stripe code and is independently valuable.

**Files:**
- Create: `src/lib/subscription.ts`
- Create: `src/lib/subscription.test.ts`
- Create: `src/lib/auth/require-active-org.test.ts`
- Modify: `src/lib/auth/dal.ts`

**Interfaces:**
- Consumes: `Org.subscriptionStatus` from Task 1; `SessionUser`, `requireOwner` from `src/lib/auth/dal.ts`.
- Produces: `isOrgActive(status: string | null | undefined): boolean`; `ACTIVE_SUBSCRIPTION_STATUSES: readonly string[]`; `requireActiveOrg(): Promise<SessionUser>` exported from `@/lib/auth/dal`.

- [ ] **Step 1: Write the failing unit test**

Create `src/lib/subscription.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isOrgActive } from "@/lib/subscription";

describe("isOrgActive", () => {
  it("allows the two paying states", () => {
    expect(isOrgActive("trialing")).toBe(true);
    expect(isOrgActive("active")).toBe(true);
  });

  it("blocks every lapsed state", () => {
    for (const status of ["past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      expect(isOrgActive(status)).toBe(false);
    }
  });

  it("blocks an org with no subscription at all", () => {
    expect(isOrgActive(null)).toBe(false);
    expect(isOrgActive(undefined)).toBe(false);
    expect(isOrgActive("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/subscription.test.ts`
Expected: FAIL — cannot resolve `@/lib/subscription`.

- [ ] **Step 3: Implement it**

Create `src/lib/subscription.ts`:

```ts
/**
 * The only two Stripe subscription statuses that grant full access.
 *
 * Stated as an allowlist rather than a blocklist of lapsed states: Stripe can
 * add a status, and a new one should fail closed rather than silently hand out
 * the product for free.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = ["trialing", "active"] as const;

export function isOrgActive(status: string | null | undefined): boolean {
  return (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status ?? "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/subscription.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing DAL test**

Create `src/lib/auth/require-active-org.test.ts`. This drives the real DAL against the real test database, stubbing only `next/headers` and `next/navigation`, so the whole session chain is exercised rather than mocked away:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCrewUser } from "@/test/factories";

const cookieValue = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValue.value ? { name, value: cookieValue.value } : undefined,
    set: () => {},
    delete: () => {},
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect: ${path}`);
  }),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  // getSessionUser is wrapped in React's cache(). Outside a real request there
  // is no per-request scope to bound that memoisation, so one test's user
  // could leak into the next. Passing cache() through as the identity function
  // keeps every call a fresh read.
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { requireActiveOrg } = await import("@/lib/auth/dal");
const { hashToken } = await import("@/lib/auth/session");

async function signIn(userId: string) {
  const raw = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      tokenHash: hashToken(raw),
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  cookieValue.value = raw;
}

beforeEach(() => {
  cookieValue.value = null;
});

describe("requireActiveOrg", () => {
  it("lets a trialing owner through", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: "trialing" },
    });
    const owner = await makeOwner(org.id);
    await signIn(owner.id);

    const user = await requireActiveOrg();
    expect(user.userId).toBe(owner.id);
    expect(user.orgId).toBe(org.id);
  });

  it("lets an active owner through", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: "active" },
    });
    const owner = await makeOwner(org.id);
    await signIn(owner.id);

    await expect(requireActiveOrg()).resolves.toMatchObject({ orgId: org.id });
  });

  it("sends a past_due owner to /billing", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: "past_due" },
    });
    const owner = await makeOwner(org.id);
    await signIn(owner.id);

    await expect(requireActiveOrg()).rejects.toThrow("redirect: /billing");
  });

  it("sends an org with no subscription at all to /billing", async () => {
    const org = await makeOrg();
    const owner = await makeOwner(org.id);
    await signIn(owner.id);

    await expect(requireActiveOrg()).rejects.toThrow("redirect: /billing");
  });

  it("sends a crew member to /login rather than /billing", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: "active" },
    });
    const crew = await makeCrew(org.id);
    const crewUser = await makeCrewUser(org.id, crew.id);
    await signIn(crewUser.id);

    await expect(requireActiveOrg()).rejects.toThrow("redirect: /login");
  });

  it("sends a signed-out visitor to /login", async () => {
    await expect(requireActiveOrg()).rejects.toThrow("redirect: /login");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- src/lib/auth/require-active-org.test.ts`
Expected: FAIL — `requireActiveOrg` is not exported from `@/lib/auth/dal`.

- [ ] **Step 7: Implement the gate**

In `src/lib/auth/dal.ts`, add the import at the top:

```ts
import { isOrgActive } from "@/lib/subscription";
```

Append at the end of the file:

```ts
/**
 * The gate on every owner write path.
 *
 * Reads keep calling requireOwner(): a company whose card expired should still
 * be able to see the schedule it already built. What stops is administration.
 *
 * The status comes from the Org row, which the Stripe webhook mirrors. It is
 * never computed from our own clock — an org is entitled because Stripe says
 * the money is good, not because thirty days have not elapsed yet.
 */
export async function requireActiveOrg(): Promise<SessionUser> {
  const user = await requireOwner();

  const org = await prisma.org.findUnique({
    where: { id: user.orgId },
    select: { subscriptionStatus: true },
  });

  if (!isOrgActive(org?.subscriptionStatus)) redirect("/billing");

  return user;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- src/lib/auth/require-active-org.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Prove the protection is load-bearing**

Temporarily change the guard line in `src/lib/auth/dal.ts` to `if (false) redirect("/billing");`.

Run: `npm test -- src/lib/auth/require-active-org.test.ts`
Expected: FAIL — the `past_due` and no-subscription tests must both fail. If they still pass, the tests are not testing anything; fix them before continuing.

**Revert the change** and re-run to confirm PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/subscription.ts src/lib/subscription.test.ts src/lib/auth/dal.ts src/lib/auth/require-active-org.test.ts
git commit -m "Add requireActiveOrg, the gate on owner write paths"
```

---

### Task 3: Apply the gate to every owner write path

**Files:**
- Modify: `src/app/(app)/customers/actions.ts` — `createCustomer`, `updateCustomer`
- Modify: `src/app/(app)/team/actions.ts` — `createCrewLogin`, `resetCrewPin`, `setCrewLoginActive`
- Modify: `src/app/(app)/dashboard/actions.ts` — `createJob`, `updateJobFrequency`, `updateJob`, `createCrew`, `updateCrew`, `deleteCrew`, `moveJobInColumn`, `bulkRescheduleDay`, `deleteJob`
- Modify: `src/app/actions.isolation.test.ts` (the DAL mock)
- Modify: `src/lib/data.isolation.test.ts` (the DAL mock)
- Test: `src/app/billing-gate.test.ts`

**Interfaces:**
- Consumes: `requireActiveOrg` from Task 2.
- Produces: no new exports. Fourteen actions now call `requireActiveOrg()` in place of `requireOwner()`.

**Not gated, deliberately:**
- `updateJobStatus` — a crew member marking a stop complete is operational, not administrative. Blocking it strands people in a yard mid-week.
- Everything in `src/app/(app)/account/actions.ts` (`changePassword`, `requestEmailChange`, `cancelEmailChange`, `resendVerification`, `emailMyResetLink`) — an account must never be locked out of the screens that let it recover access and pay.

- [ ] **Step 1: Add `requireActiveOrg` to both isolation-test DAL mocks**

Both isolation suites replace the entire DAL module, so they will throw "not a function" the moment an action calls the new gate. Add this property to the `vi.mock("@/lib/auth/dal", ...)` object in **both** `src/app/actions.isolation.test.ts` and `src/lib/data.isolation.test.ts`, directly after `requireOwner`:

```ts
  // Mirrors requireOwner: these suites prove org-scoping, and the billing
  // gate is proven separately in src/app/billing-gate.test.ts. Treating every
  // mocked org as paid keeps this suite testing the one thing it is for.
  requireActiveOrg: async () => {
    if (currentUser.value?.role !== "OWNER") throw new Error("redirect: /login");
    return currentUser.value;
  },
```

- [ ] **Step 2: Write the failing test**

Create `src/app/billing-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  makeOrg,
  makeOwner,
  makeCrew,
  makeCrewUser,
  makeCustomer,
  makeJob,
} from "@/test/factories";

// Unlike the isolation suites, this one runs the REAL DAL — requireActiveOrg
// is the thing under test, so mocking it away would defeat the point. Only
// the cookie jar and redirect are stubbed, and sessions are real rows.
//
// A partial mock of @/lib/auth/dal would NOT work here: requireActiveOrg calls
// the module's own internal requireOwner, not the exported binding a partial
// mock replaces, so the stub would silently never apply.
const cookieValue = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValue.value ? { name, value: cookieValue.value } : undefined,
    set: () => {},
    delete: () => {},
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect: ${path}`);
  }),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  // getSessionUser is wrapped in React's cache(). Outside a real request there
  // is no per-request scope to bound that memoisation, so one test's user
  // could leak into the next. Passing cache() through as the identity function
  // keeps every call a fresh read.
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { createCustomer } = await import("@/app/(app)/customers/actions");
const { createJob, updateJobStatus, createCrew } = await import(
  "@/app/(app)/dashboard/actions"
);
const { createCrewLogin } = await import("@/app/(app)/team/actions");
const { hashToken } = await import("@/lib/auth/session");

async function signIn(userId: string) {
  const raw = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      tokenHash: hashToken(raw),
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  cookieValue.value = raw;
}

async function setupOrg(status: string | null) {
  const org = await makeOrg();
  if (status) {
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: status },
    });
  }
  const owner = await makeOwner(org.id);
  return { org, owner };
}

beforeEach(() => {
  cookieValue.value = null;
});

describe("billing gate on owner writes", () => {
  it("allows an owner write when trialing", async () => {
    const { org, owner } = await setupOrg("trialing");
    await signIn(owner.id);

    const customer = await createCustomer({ name: "Ann", address: "1 Elm St" });
    expect(customer.orgId).toBe(org.id);
  });

  it("blocks creating a customer when lapsed", async () => {
    const { org, owner } = await setupOrg("past_due");
    await signIn(owner.id);

    await expect(
      createCustomer({ name: "Ann", address: "1 Elm St" }),
    ).rejects.toThrow("redirect: /billing");
    expect(await prisma.customer.count({ where: { orgId: org.id } })).toBe(0);
  });

  it("blocks creating a crew when lapsed", async () => {
    const { org, owner } = await setupOrg("canceled");
    await signIn(owner.id);

    await expect(
      createCrew({ name: "Blue Team", color: "#22c55e" }),
    ).rejects.toThrow("redirect: /billing");
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(0);
  });

  it("blocks creating a crew login when lapsed", async () => {
    const { org, owner } = await setupOrg("unpaid");
    const crew = await makeCrew(org.id);
    await signIn(owner.id);

    await expect(
      createCrewLogin({ crewId: crew.id, name: "Jose", username: "jose", pin: "481920" }),
    ).rejects.toThrow("redirect: /billing");
  });

  it("blocks creating a job when lapsed", async () => {
    const { org, owner } = await setupOrg("past_due");
    const crew = await makeCrew(org.id);
    const customer = await makeCustomer(org.id);
    await signIn(owner.id);

    await expect(
      createJob({
        customerId: customer.id,
        crewId: crew.id,
        dateISO: "2026-09-01",
        frequency: "ONCE",
      }),
    ).rejects.toThrow("redirect: /billing");
  });

  it("STILL lets a crew member mark a stop complete when the org is lapsed", async () => {
    // The humane half of the design. Blocking this strands people in a yard
    // mid-week to collect from their employer, which is a bad trade even for
    // us. If this test ever fails, the gate has been applied too widely.
    const { org } = await setupOrg("canceled");
    const crew = await makeCrew(org.id);
    const crewUser = await makeCrewUser(org.id, crew.id);
    const customer = await makeCustomer(org.id);
    const job = await makeJob(org.id, customer.id, crew.id, "2026-09-01");

    await signIn(crewUser.id);

    await updateJobStatus(job.id, "COMPLETED");

    const fresh = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(fresh.status).toBe("COMPLETED");
  });
});
```

Check `src/test/factories.ts` for the exact `makeJob` and `makeCustomer` signatures and `src/app/(app)/dashboard/actions.ts` for `createJob`'s exact input shape before running; adjust the calls above to match rather than changing the actions.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/app/billing-gate.test.ts`
Expected: FAIL — the "blocks" tests fail because the actions still call `requireOwner()` and let the write through.

- [ ] **Step 4: Swap the guard in the fourteen actions**

In each of the three files, change the import to include the gate and replace the call in the listed functions only:

```ts
// was: const { orgId } = await requireOwner();
const { orgId } = await requireActiveOrg();
```

`src/app/(app)/customers/actions.ts`: `createCustomer`, `updateCustomer`.

`src/app/(app)/team/actions.ts`: `createCrewLogin`, `resetCrewPin`, `setCrewLoginActive`.

`src/app/(app)/dashboard/actions.ts`: `createJob`, `updateJobFrequency`, `updateJob`, `createCrew`, `updateCrew`, `deleteCrew`, `moveJobInColumn`, `bulkRescheduleDay`, `deleteJob`.

Leave `requireOwner` imported wherever a read or an ungated action still uses it; remove the import only if nothing in the file uses it any more, or lint will fail.

Add this comment directly above `updateJobStatus` in `src/app/(app)/dashboard/actions.ts`:

```ts
// Deliberately verifySession() and not requireActiveOrg(): a crew member
// marking a stop complete is operational, not administrative. A company whose
// card expired still has crews standing in customers' yards, and blocking them
// breaks that company's day to collect from it. Do not "fix" this to match the
// other actions in this file.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/app/billing-gate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Prove the gate is load-bearing**

Revert one action — change `createCustomer` back to `requireOwner()`.

Run: `npm test -- src/app/billing-gate.test.ts`
Expected: FAIL on "blocks creating a customer when lapsed".

**Restore the gate** and re-run to confirm PASS.

- [ ] **Step 7: Verify nothing else broke**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`
Expected: all pass. The isolation suites must still be green — if they throw "requireActiveOrg is not a function", Step 1 was missed in one of the two files.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/customers/actions.ts" "src/app/(app)/team/actions.ts" "src/app/(app)/dashboard/actions.ts" src/app/actions.isolation.test.ts src/lib/data.isolation.test.ts src/app/billing-gate.test.ts
git commit -m "Gate every owner write path behind an active subscription"
```

---

### Task 4: Stripe configuration and client

**Files:**
- Create: `src/lib/url.ts`
- Create: `src/lib/url.test.ts`
- Create: `src/lib/stripe/config.ts`
- Create: `src/lib/stripe/config.test.ts`
- Create: `src/lib/stripe/client.ts`
- Modify: `src/lib/email/client.ts`
- Modify: `.env.example`
- Modify: `package.json` (adds the `stripe` dependency)

**Interfaces:**
- Consumes: nothing.
- Produces: `appUrl(path: string): string` and `requireAppUrl(): string` from `@/lib/url`; `stripeConfig(): { secretKey: string; webhookSecret: string; priceId: string; portalReturnUrl: string }` from `@/lib/stripe/config`; `getStripe(): Stripe` from `@/lib/stripe/client`.

- [ ] **Step 1: Install the SDK**

```bash
npm install stripe
```

Do not pin an `apiVersion` in code. The SDK defaults to the version its types were generated against; pinning a guessed date string produces types that disagree with the runtime.

- [ ] **Step 2: Write the failing test**

Create `src/lib/url.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { appUrl, requireAppUrl } from "@/lib/url";

const original = process.env.APP_URL;
afterEach(() => {
  process.env.APP_URL = original;
});

describe("appUrl", () => {
  it("joins a path onto the configured origin", () => {
    process.env.APP_URL = "https://app.example.com";
    expect(appUrl("/billing/return")).toBe("https://app.example.com/billing/return");
  });

  it("tolerates a trailing slash on the origin", () => {
    process.env.APP_URL = "https://app.example.com/";
    expect(appUrl("/billing")).toBe("https://app.example.com/billing");
  });
});

describe("requireAppUrl", () => {
  it("returns the origin when set", () => {
    process.env.APP_URL = "https://app.example.com";
    expect(requireAppUrl()).toBe("https://app.example.com");
  });

  it("throws when APP_URL is missing", () => {
    delete process.env.APP_URL;
    expect(() => requireAppUrl()).toThrow(/APP_URL/);
  });
});
```

Create `src/lib/stripe/config.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { stripeConfig } from "@/lib/stripe/config";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

function setAll() {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  process.env.STRIPE_PRICE_ID = "price_x";
  process.env.APP_URL = "https://app.example.com";
  delete process.env.STRIPE_PORTAL_RETURN_URL;
}

describe("stripeConfig", () => {
  it("reads every value", () => {
    setAll();
    const config = stripeConfig();
    expect(config.secretKey).toBe("sk_test_x");
    expect(config.webhookSecret).toBe("whsec_x");
    expect(config.priceId).toBe("price_x");
  });

  it("derives the portal return URL from APP_URL when unset", () => {
    setAll();
    expect(stripeConfig().portalReturnUrl).toBe("https://app.example.com/billing");
  });

  it("prefers an explicit portal return URL", () => {
    setAll();
    process.env.STRIPE_PORTAL_RETURN_URL = "https://other.example.com/done";
    expect(stripeConfig().portalReturnUrl).toBe("https://other.example.com/done");
  });

  it.each([
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_ID",
  ])("throws loudly when %s is missing", (key) => {
    setAll();
    delete process.env[key];
    expect(() => stripeConfig()).toThrow(new RegExp(key));
  });

  it("throws when APP_URL is missing, rather than mailing people to localhost", () => {
    setAll();
    delete process.env.APP_URL;
    expect(() => stripeConfig()).toThrow(/APP_URL/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- src/lib/url.test.ts src/lib/stripe/config.test.ts`
Expected: FAIL — neither module resolves.

- [ ] **Step 4: Implement the two modules**

Create `src/lib/url.ts`:

```ts
/**
 * Builds an absolute URL from the configured origin.
 *
 * Lives here rather than in the email client because ESLint restricts that
 * module to Server Actions, and the Stripe webhook route needs absolute URLs
 * too. The email client re-exports this so its existing callers are unchanged.
 */
export function appUrl(path: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/**
 * The strict form, for anywhere the localhost fallback would be a silent
 * failure rather than an inconvenience. A Stripe success_url pointing at
 * localhost sends a paying customer to their own machine and looks like
 * success from our side, which is exactly the failure APP_URL has already
 * caused once in this project.
 */
export function requireAppUrl(): string {
  const base = process.env.APP_URL;
  if (!base) {
    throw new Error(
      "APP_URL is not set. Stripe redirect URLs cannot be built without it.",
    );
  }
  return base.replace(/\/$/, "");
}
```

In `src/lib/email/client.ts`, delete the local `appUrl` definition and replace it with a re-export at the top of the file:

```ts
export { appUrl } from "@/lib/url";
```

Create `src/lib/stripe/config.ts`:

```ts
import { requireAppUrl } from "@/lib/url";

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  portalReturnUrl: string;
};

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} is not set. Billing cannot run without it — see .env.example.`,
    );
  }
  return value;
}

/**
 * Read at call time rather than at module load so a missing key surfaces as a
 * handled error on the one request that needed it, instead of crashing the
 * whole server at boot and taking the signed-in app down with it.
 */
export function stripeConfig(): StripeConfig {
  return {
    secretKey: required("STRIPE_SECRET_KEY"),
    webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
    priceId: required("STRIPE_PRICE_ID"),
    portalReturnUrl:
      process.env.STRIPE_PORTAL_RETURN_URL ?? `${requireAppUrl()}/billing`,
  };
}
```

Create `src/lib/stripe/client.ts`:

```ts
import "server-only";
import Stripe from "stripe";
import { stripeConfig } from "./config";

let cached: Stripe | undefined;

/**
 * One Stripe instance per process. Built lazily so importing this module never
 * throws on a missing key — only actually using Stripe does.
 */
export function getStripe(): Stripe {
  if (!cached) cached = new Stripe(stripeConfig().secretKey);
  return cached;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/lib/url.test.ts src/lib/stripe/config.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Document the new configuration**

Append to `.env.example`:

```
# Stripe. Billing fails loudly without these rather than silently letting
# people in free — see src/lib/stripe/config.ts.
STRIPE_SECRET_KEY=""

# The signing secret for the endpoint added in Stripe's dashboard. This is the
# only thing standing between /api/stripe/webhook and anyone granting
# themselves a company on this server.
STRIPE_WEBHOOK_SECRET=""

# The monthly recurring Price created in the Stripe dashboard. The amount lives
# there, not here, so changing the price is not a deploy.
STRIPE_PRICE_ID=""

# Where Stripe's billing portal sends people when they are done. Derived from
# APP_URL when unset.
STRIPE_PORTAL_RETURN_URL=""
```

- [ ] **Step 7: Verify the build**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`
Expected: all pass. If `npm run build` fails on `server-only` inside `client.ts`, confirm nothing in a client component imports it.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/url.ts src/lib/url.test.ts src/lib/stripe/ src/lib/email/client.ts .env.example
git commit -m "Add Stripe configuration that fails loudly when unset"
```

---

### Task 5: Signup writes a `PendingSignup` instead of an account

**Files:**
- Create: `src/lib/provision.ts`
- Create: `src/lib/auth/claim-cookie.ts`
- Modify: `src/app/signup/actions.ts`
- Modify: `src/proxy.ts`
- Test: `src/app/signup-gate.test.ts`

**Interfaces:**
- Consumes: `prisma.pendingSignup` (Task 1); `getStripe` and `stripeConfig` (Task 4); `hashToken` from `@/lib/auth/session`.
- Produces:
  - `CLAIM_COOKIE = "groundsroute_claim"` and `CLAIM_TTL_MS` from `@/lib/auth/claim-cookie`
  - From `@/lib/provision`:

```ts
export type ProvisionResult =
  | { ok: true; orgId: string; userId: string }
  | { ok: false; reason: "email-taken" | "slug-exhausted" };

export function createOrgWithOwner(input: {
  companyName: string;
  name: string;
  email: string;
  passwordHash: string;
}): Promise<ProvisionResult>;
```

  `reason` is what Task 6 writes into `PendingSignup.failedReason`, and Task 7 reads back out of it.
  - `signup(_state, formData)` unchanged in signature, changed in behaviour.

- [ ] **Step 1: Write the failing test**

Create `src/app/signup-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner } from "@/test/factories";

const created = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  nextId: "cs_test_1",
}));

const cookieJar = vi.hoisted(() => ({ value: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.value.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      cookieJar.value.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.value.delete(name);
    },
  }),
}));

const redirected = vi.hoisted(() => ({ to: null as string | null }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    redirected.to = path;
    throw new Error(`redirect: ${path}`);
  }),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          created.sessions.push(params);
          return { id: created.nextId, url: "https://checkout.stripe.test/pay" };
        },
      },
    },
  }),
}));

vi.mock("@/lib/stripe/config", () => ({
  stripeConfig: () => ({
    secretKey: "sk_test_x",
    webhookSecret: "whsec_x",
    priceId: "price_x",
    portalReturnUrl: "https://app.example.com/billing",
  }),
}));

const { signup } = await import("@/app/signup/actions");
const { CLAIM_COOKIE } = await import("@/lib/auth/claim-cookie");
const { hashToken } = await import("@/lib/auth/session");

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  data.set("name", overrides.name ?? "Dana Owner");
  data.set("companyName", overrides.companyName ?? "Green Acres");
  data.set("email", overrides.email ?? "dana@example.com");
  data.set("password", overrides.password ?? "correct-horse");
  return data;
}

beforeEach(() => {
  created.sessions = [];
  created.nextId = "cs_test_1";
  cookieJar.value = new Map();
  redirected.to = null;
  process.env.APP_URL = "https://app.example.com";
});

describe("signup no longer creates an account", () => {
  it("creates NO Org and NO User", async () => {
    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);

    expect(await prisma.org.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it("creates a PendingSignup holding the hashed password", async () => {
    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);

    const pending = await prisma.pendingSignup.findUniqueOrThrow({
      where: { email: "dana@example.com" },
    });
    expect(pending.companyName).toBe("Green Acres");
    expect(pending.name).toBe("Dana Owner");
    expect(pending.passwordHash).toMatch(/^\$argon2/);
    expect(pending.consumedAt).toBeNull();
  });

  it("sets a claim cookie whose SHA-256 is what gets stored", async () => {
    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);

    const raw = cookieJar.value.get(CLAIM_COOKIE);
    expect(raw).toBeTruthy();

    const pending = await prisma.pendingSignup.findUniqueOrThrow({
      where: { email: "dana@example.com" },
    });
    expect(pending.claimHash).toBe(hashToken(raw!));
    // The raw value must never be what is stored, for the same reason the
    // session token is not.
    expect(pending.claimHash).not.toBe(raw);
  });

  it("redirects to the Stripe Checkout URL", async () => {
    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);
    expect(redirected.to).toBe("https://checkout.stripe.test/pay");
  });

  it("asks Stripe for a 30-day trial that requires a card", async () => {
    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);

    const params = created.sessions[0];
    expect(params.mode).toBe("subscription");
    expect(params.payment_method_collection).toBe("always");
    expect(params.subscription_data).toMatchObject({ trial_period_days: 30 });
    expect(params.success_url).toBe("https://app.example.com/billing/return");

    const pending = await prisma.pendingSignup.findUniqueOrThrow({
      where: { email: "dana@example.com" },
    });
    expect(params.client_reference_id).toBe(pending.id);
  });

  it("rejects an email that already belongs to a real account", async () => {
    const org = await makeOrg();
    await makeOwner(org.id, "taken@example.com");

    const state = await signup(undefined, form({ email: "taken@example.com" }));

    expect(state?.errors?.email).toMatch(/already registered/i);
    expect(await prisma.pendingSignup.count()).toBe(0);
  });

  it("reuses the row on a retry instead of creating a second one", async () => {
    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);
    const first = await prisma.pendingSignup.findUniqueOrThrow({
      where: { email: "dana@example.com" },
    });

    created.nextId = "cs_test_2";
    cookieJar.value = new Map();
    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);

    expect(await prisma.pendingSignup.count()).toBe(1);
    const second = await prisma.pendingSignup.findUniqueOrThrow({
      where: { email: "dana@example.com" },
    });
    expect(second.id).toBe(first.id);
    // A retry must invalidate the previous browser's claim.
    expect(second.claimHash).not.toBe(first.claimHash);
  });

  it("sweeps expired unconsumed rows but keeps consumed ones", async () => {
    const org = await makeOrg();
    await prisma.pendingSignup.create({
      data: {
        email: "stale@example.com",
        name: "Stale",
        companyName: "Stale Co",
        passwordHash: "x",
        claimHash: "stale-claim",
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.pendingSignup.create({
      data: {
        email: "done@example.com",
        name: "Done",
        companyName: "Done Co",
        claimHash: "done-claim",
        orgId: org.id,
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);

    expect(
      await prisma.pendingSignup.findUnique({ where: { email: "stale@example.com" } }),
    ).toBeNull();
    expect(
      await prisma.pendingSignup.findUnique({ where: { email: "done@example.com" } }),
    ).not.toBeNull();
  });

  it("rejects whitespace-only input", async () => {
    const state = await signup(undefined, form({ companyName: "   " }));
    expect(state?.errors?.companyName).toBeTruthy();
    expect(await prisma.pendingSignup.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/signup-gate.test.ts`
Expected: FAIL — `@/lib/auth/claim-cookie` does not resolve, and the current signup creates an Org.

- [ ] **Step 3: Create the claim cookie module**

Create `src/lib/auth/claim-cookie.ts`:

```ts
// Separate from cookie.ts's SESSION_COOKIE so src/proxy.ts can stay free of
// anything that pulls Prisma into a module running on every request.

/**
 * Identifies the browser that started a signup, so only that browser can claim
 * the account once Stripe confirms payment. No identifier rides in the return
 * URL: a URL is shared, logged, and leaked in Referer headers, and a cookie is
 * not.
 */
export const CLAIM_COOKIE = "groundsroute_claim";

/**
 * Forty-eight hours, deliberately longer than the twenty-four after which a
 * Stripe Checkout session expires on its own. The margin means no payment can
 * arrive for a row that has already been swept.
 */
export const CLAIM_TTL_MS = 48 * 60 * 60 * 1000;
```

- [ ] **Step 4: Move the org-creation retry into `src/lib/provision.ts`**

Create `src/lib/provision.ts` by lifting the loop out of the current `signup` action verbatim, changing only what it returns:

```ts
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { uniqueSlug } from "@/lib/auth/slug";
import { p2002Fields } from "@/lib/prisma-errors";

// uniqueSlug checks availability and the insert happens in two separate steps,
// so two companies with the same name arriving at once can both see a slug as
// free. Only one insert can win; the other hits Org.slug's unique constraint.
// Rather than weaken that constraint — it is the real backstop against
// duplicate slugs — retry with a freshly computed slug, which by then accounts
// for the row the other request just inserted.
const MAX_ATTEMPTS = 3;

export type ProvisionResult =
  | { ok: true; orgId: string; userId: string }
  | { ok: false; reason: "email-taken" | "slug-exhausted" };

/**
 * Creates a company and its owner together, or neither.
 *
 * Lives here rather than in the signup action because the Stripe webhook is
 * now what calls it — signup itself no longer creates an account.
 */
export async function createOrgWithOwner(input: {
  companyName: string;
  name: string;
  email: string;
  passwordHash: string;
}): Promise<ProvisionResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const slug = await uniqueSlug(input.companyName, async (candidate) => {
      return (await prisma.org.count({ where: { slug: candidate } })) > 0;
    });

    try {
      const user = await prisma.$transaction(async (tx) => {
        const org = await tx.org.create({
          data: { name: input.companyName, slug },
        });
        return tx.user.create({
          data: {
            orgId: org.id,
            role: "OWNER",
            name: input.name,
            email: input.email,
            passwordHash: input.passwordHash,
          },
        });
      });
      return { ok: true, orgId: user.orgId, userId: user.id };
    } catch (err) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== "P2002"
      ) {
        throw err;
      }

      const fields = p2002Fields(err);

      if (fields.includes("email")) {
        // Somebody else claimed this address between the caller's check and
        // this insert. The org half rolls back, so no orphaned company is left.
        return { ok: false, reason: "email-taken" };
      }

      if (!fields.includes("slug")) throw err;
    }
  }

  return { ok: false, reason: "slug-exhausted" };
}
```

- [ ] **Step 5: Rewrite the signup action**

Replace the body of `signup` in `src/app/signup/actions.ts` after the Zod parse. Keep `SignupSchema` and the error-collecting block exactly as they are. Imports become:

```ts
"use server";

import { randomBytes } from "crypto";
import { z } from "zod";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/session";
import { CLAIM_COOKIE, CLAIM_TTL_MS } from "@/lib/auth/claim-cookie";
import { getStripe } from "@/lib/stripe/client";
import { stripeConfig } from "@/lib/stripe/config";
import { requireAppUrl } from "@/lib/url";
```

The body after `const { name, companyName, email, password } = parsed.data;`:

```ts
  const taken = await prisma.user.findUnique({ where: { email } });
  if (taken) {
    return { errors: { email: "That email is already registered." } };
  }

  // Unconsumed rows past their expiry can no longer be paid for: a Stripe
  // Checkout session dies after twenty-four hours and these live forty-eight.
  // Sweeping here rather than on a schedule keeps abandoned signups from
  // accumulating without adding cron infrastructure this project does not have.
  await prisma.pendingSignup.deleteMany({
    where: { consumedAt: null, expiresAt: { lt: new Date() } },
  });

  const passwordHash = await hashSecret(password);
  const claim = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);

  // Upsert rather than create: someone who abandoned checkout and came back
  // must be able to retry, and keeping one row per email means a checkout they
  // left open and later paid still resolves to this same id.
  let pending;
  try {
    pending = await prisma.pendingSignup.upsert({
      where: { email },
      create: {
        email,
        name,
        companyName,
        passwordHash,
        claimHash: hashToken(claim),
        expiresAt,
      },
      update: {
        name,
        companyName,
        passwordHash,
        claimHash: hashToken(claim),
        checkoutSessionId: null,
        failedReason: null,
        expiresAt,
      },
    });
  } catch {
    return { error: "Something went wrong. Please try again." };
  }

  if (pending.consumedAt) {
    // The row was already promoted to a real account. The user lookup above
    // should have caught this, so reaching here means the account was created
    // between these two queries.
    return { errors: { email: "That email is already registered." } };
  }

  let checkoutUrl: string | null;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: stripeConfig().priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 30 },
      // A card is required before the trial starts. Without this Stripe skips
      // payment collection for a fully discounted first period.
      payment_method_collection: "always",
      customer_email: email,
      client_reference_id: pending.id,
      success_url: `${requireAppUrl()}/billing/return`,
      cancel_url: `${requireAppUrl()}/signup?canceled=1`,
    });
    checkoutUrl = session.url;

    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: { checkoutSessionId: session.id },
    });
  } catch (err) {
    // Returned, not thrown: production React redacts a thrown Server Action
    // message and shows boilerplate instead.
    console.error(
      "Checkout session not created:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: "We could not start checkout. Please try again." };
  }

  if (!checkoutUrl) {
    return { error: "We could not start checkout. Please try again." };
  }

  const cookieStore = await cookies();
  cookieStore.set(CLAIM_COOKIE, claim, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax rather than Strict: the visitor arrives back at /billing/return via
    // a top-level navigation from Stripe, and a Strict cookie is withheld on
    // exactly that kind of cross-site redirect.
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  redirect(checkoutUrl);
```

Delete the now-unused `Prisma`, `p2002Fields`, `uniqueSlug`, `createSession` imports and the `MAX_SIGNUP_ATTEMPTS` constant from this file — lint will fail on them otherwise.

- [ ] **Step 6: Make the return route reachable signed out**

In `src/proxy.ts`, add two entries to `PUBLIC_PREFIXES`:

```ts
  // The visitor arrives here straight from Stripe with no session at all —
  // the account may not even exist yet. This is the one page whose whole job
  // is to run before a session exists.
  "/billing/return",
  // Stripe is not a browser and carries no session cookie.
  "/api/stripe/webhook",
```

`"/billing/return"` and not `"/billing"`: the prefix match means the shorter string would make the owner's billing page public too.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- src/app/signup-gate.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 8: Prove the gate is load-bearing**

Temporarily add `await createOrgWithOwner({ companyName, name, email, passwordHash });` just before the `redirect(checkoutUrl)` line.

Run: `npm test -- src/app/signup-gate.test.ts`
Expected: FAIL on "creates NO Org and NO User".

**Remove the line** and re-run to confirm PASS.

- [ ] **Step 9: Check the whole suite**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`
Expected: all pass. `src/app/auth-flows.test.ts` exercises signup and **will** need updating — it asserts the old behaviour. Update its signup assertions to expect a `PendingSignup` and no `Org`; do not weaken the assertions to make them pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/provision.ts src/lib/auth/claim-cookie.ts src/app/signup/actions.ts src/proxy.ts src/app/signup-gate.test.ts src/app/auth-flows.test.ts
git commit -m "Signup records a pending signup and sends the visitor to Stripe"
```

---

### Task 6: The webhook — the only route that creates an org

**Files:**
- Create: `src/app/api/stripe/webhook/route.ts`
- Create: `src/lib/stripe/handle-event.ts`
- Test: `src/app/api/stripe/webhook/webhook.test.ts`

**Interfaces:**
- Consumes: `createOrgWithOwner` (Task 5); `getStripe`, `stripeConfig` (Task 4); `prisma.pendingSignup` (Task 1).
- Produces: `handleStripeEvent(event: Stripe.Event): Promise<void>` from `@/lib/stripe/handle-event`; `POST(request: Request): Promise<Response>` route handler.

Splitting the event handling out of `route.ts` is what makes it testable: the tests call `handleStripeEvent` with a constructed event object, and `route.ts` keeps only signature verification and status codes.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/stripe/webhook/webhook.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makePendingSignup } from "@/test/factories";

const canceled = vi.hoisted(() => ({ ids: [] as string[] }));
const subscriptions = vi.hoisted(() => ({
  value: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    subscriptions: {
      cancel: async (id: string) => {
        canceled.ids.push(id);
        return { id, status: "canceled" };
      },
      retrieve: async (id: string) => {
        const sub = subscriptions.value.get(id);
        if (!sub) throw new Error(`no such subscription: ${id}`);
        return sub;
      },
    },
  }),
}));

const { handleStripeEvent } = await import("@/lib/stripe/handle-event");

function completedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        client_reference_id: "REPLACE",
        customer: "cus_1",
        subscription: "sub_1",
        ...overrides,
      },
    },
  } as never;
}

beforeEach(() => {
  canceled.ids = [];
  subscriptions.value = new Map([
    [
      "sub_1",
      {
        id: "sub_1",
        status: "trialing",
        trial_end: 1790000000,
        items: { data: [{ current_period_end: 1790000000 }] },
      },
    ],
  ]);
});

describe("checkout.session.completed", () => {
  it("creates the org and owner from the pending signup", async () => {
    const pending = await makePendingSignup({ email: "new@example.com" });

    await handleStripeEvent(completedEvent({ client_reference_id: pending.id }));

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "new@example.com" },
    });
    expect(user.role).toBe("OWNER");

    const org = await prisma.org.findUniqueOrThrow({ where: { id: user.orgId } });
    expect(org.subscriptionStatus).toBe("trialing");
    expect(org.stripeCustomerId).toBe("cus_1");
    expect(org.stripeSubscriptionId).toBe("sub_1");
  });

  it("consumes the row and discards the stored password hash", async () => {
    const pending = await makePendingSignup({ email: "new@example.com" });

    await handleStripeEvent(completedEvent({ client_reference_id: pending.id }));

    const fresh = await prisma.pendingSignup.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(fresh.consumedAt).not.toBeNull();
    expect(fresh.orgId).not.toBeNull();
    expect(fresh.passwordHash).toBeNull();
  });

  it("is idempotent: a replayed event creates exactly one org", async () => {
    const pending = await makePendingSignup({ email: "new@example.com" });
    const event = completedEvent({ client_reference_id: pending.id });

    await handleStripeEvent(event);
    await handleStripeEvent(event);

    expect(await prisma.org.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
    expect(canceled.ids).toEqual([]);
  });

  it("cancels a SECOND checkout completed for the same signup", async () => {
    const pending = await makePendingSignup({ email: "new@example.com" });

    await handleStripeEvent(completedEvent({ client_reference_id: pending.id }));
    await handleStripeEvent(
      completedEvent({
        client_reference_id: pending.id,
        id: "cs_test_2",
        subscription: "sub_2",
      }),
    );

    expect(await prisma.org.count()).toBe(1);
    expect(canceled.ids).toEqual(["sub_2"]);
    // The original subscription is the one that survives.
    const org = await prisma.org.findFirstOrThrow();
    expect(org.stripeSubscriptionId).toBe("sub_1");
  });

  it("cancels the subscription when the email was taken in the gap", async () => {
    const other = await makeOrg();
    const pending = await makePendingSignup({ email: "clash@example.com" });
    await makeOwner(other.id, "clash@example.com");

    await handleStripeEvent(completedEvent({ client_reference_id: pending.id }));

    expect(canceled.ids).toEqual(["sub_1"]);
    // The pre-existing org is untouched and no second one appears.
    expect(await prisma.org.count()).toBe(1);

    const fresh = await prisma.pendingSignup.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(fresh.failedReason).toBe("email-taken");
    expect(fresh.consumedAt).toBeNull();
    expect(fresh.orgId).toBeNull();
  });

  it("honours a completion for an expired but unswept row", async () => {
    const pending = await makePendingSignup({
      email: "late@example.com",
      expiresAt: new Date(Date.now() - 1000),
    });

    await handleStripeEvent(completedEvent({ client_reference_id: pending.id }));

    // Taking payment and then refusing to create the account is the worst
    // outcome this design can produce. Our expiry clock does not outrank
    // Stripe confirming a card.
    expect(
      await prisma.user.findUnique({ where: { email: "late@example.com" } }),
    ).not.toBeNull();
  });

  it("does nothing for an unknown client_reference_id", async () => {
    await handleStripeEvent(completedEvent({ client_reference_id: "nope" }));
    expect(await prisma.org.count()).toBe(0);
  });
});

describe("subscription lifecycle", () => {
  async function orgWithSubscription(status: string) {
    const org = await makeOrg();
    return prisma.org.update({
      where: { id: org.id },
      data: {
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        subscriptionStatus: status,
      },
    });
  }

  it("mirrors a status change onto the org", async () => {
    const org = await orgWithSubscription("trialing");
    subscriptions.value.set("sub_1", {
      id: "sub_1",
      status: "past_due",
      trial_end: null,
      items: { data: [{ current_period_end: 1790000000 }] },
    });

    await handleStripeEvent({
      id: "evt_2",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    } as never);

    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.subscriptionStatus).toBe("past_due");
  });

  it("recovers an org when payment succeeds again", async () => {
    const org = await orgWithSubscription("past_due");
    subscriptions.value.set("sub_1", {
      id: "sub_1",
      status: "active",
      trial_end: null,
      items: { data: [{ current_period_end: 1790000000 }] },
    });

    await handleStripeEvent({
      id: "evt_3",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    } as never);

    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.subscriptionStatus).toBe("active");
  });

  it("never touches another company's subscription", async () => {
    const mine = await orgWithSubscription("trialing");
    const theirs = await makeOrg();
    await prisma.org.update({
      where: { id: theirs.id },
      data: {
        stripeCustomerId: "cus_2",
        stripeSubscriptionId: "sub_2",
        subscriptionStatus: "active",
      },
    });
    subscriptions.value.set("sub_1", {
      id: "sub_1",
      status: "canceled",
      trial_end: null,
      items: { data: [{ current_period_end: 1790000000 }] },
    });

    await handleStripeEvent({
      id: "evt_4",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1" } },
    } as never);

    expect(
      (await prisma.org.findUniqueOrThrow({ where: { id: mine.id } })).subscriptionStatus,
    ).toBe("canceled");
    expect(
      (await prisma.org.findUniqueOrThrow({ where: { id: theirs.id } })).subscriptionStatus,
    ).toBe("active");
  });

  it("ignores a subscription that belongs to no org here", async () => {
    subscriptions.value.set("sub_9", {
      id: "sub_9",
      status: "active",
      trial_end: null,
      items: { data: [{ current_period_end: 1790000000 }] },
    });

    await expect(
      handleStripeEvent({
        id: "evt_5",
        type: "customer.subscription.updated",
        data: { object: { id: "sub_9" } },
      } as never),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/stripe/webhook/webhook.test.ts`
Expected: FAIL — `@/lib/stripe/handle-event` does not resolve.

- [ ] **Step 3: Implement the event handler**

Create `src/lib/stripe/handle-event.ts`:

```ts
import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { createOrgWithOwner } from "@/lib/provision";
import { getStripe } from "./client";

/**
 * Applies a verified Stripe event.
 *
 * Signature verification happens in the route; by the time anything reaches
 * here the event is known to have come from Stripe. Kept separate from the
 * route so it can be tested with constructed events rather than signed HTTP.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await completeSignup(event.data.object as Stripe.Checkout.Session);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await mirrorSubscription((event.data.object as Stripe.Subscription).id);
      return;
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string | null;
      };
      if (invoice.subscription) await mirrorSubscription(invoice.subscription);
      return;
    }
    default:
      return;
  }
}

async function completeSignup(session: Stripe.Checkout.Session): Promise<void> {
  const pendingId = session.client_reference_id;
  if (!pendingId) return;

  const pending = await prisma.pendingSignup.findUnique({
    where: { id: pendingId },
  });

  // An event for a row we do not have. Returning quietly means Stripe stops
  // retrying; the route still answers 200.
  if (!pending) {
    console.error("Stripe webhook: no pending signup", pendingId);
    return;
  }

  if (pending.consumedAt) {
    if (pending.checkoutSessionId === session.id) return; // A replay.

    // Two checkouts completed for one signup — most often somebody paid in a
    // tab they had abandoned after retrying. The account they already have
    // keeps its subscription; this second one is cancelled so it never bills.
    console.error(
      "Stripe webhook: duplicate checkout for a consumed signup",
      pending.id,
    );
    await cancelSubscription(session.subscription);
    return;
  }

  // Expiry is not checked here on purpose. Stripe confirming a card outranks
  // our own clock, and taking payment while refusing to create the account is
  // the one outcome worth any amount of code to avoid.

  if (!pending.passwordHash) {
    console.error("Stripe webhook: pending signup has no password", pending.id);
    await cancelSubscription(session.subscription);
    return;
  }

  const result = await createOrgWithOwner({
    companyName: pending.companyName,
    name: pending.name,
    email: pending.email,
    passwordHash: pending.passwordHash,
  });

  if (!result.ok) {
    // No account can be made for this payment. During a trial no money has
    // moved, so cancelling costs the customer nothing and leaves no
    // subscription that would start charging with nothing attached to it.
    console.error("Stripe webhook: provisioning failed", pending.id, result.reason);
    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: { failedReason: result.reason },
    });
    await cancelSubscription(session.subscription);
    return;
  }

  const subscription = await retrieveSubscription(session.subscription);

  await prisma.org.update({
    where: { id: result.orgId },
    data: {
      stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
      stripeSubscriptionId: subscription?.id ?? null,
      subscriptionStatus: subscription?.status ?? null,
      trialEndsAt: toDate(subscription?.trial_end),
      currentPeriodEnd: periodEnd(subscription),
    },
  });

  await prisma.pendingSignup.update({
    where: { id: pending.id },
    data: {
      orgId: result.orgId,
      checkoutSessionId: session.id,
      consumedAt: new Date(),
      failedReason: null,
      // The credential has been copied onto the User row. Keeping a second
      // copy here would be a liability with no purpose.
      passwordHash: null,
    },
  });
}

/**
 * Re-reads the subscription from Stripe rather than trusting the event body.
 *
 * Stripe retries and can deliver events out of order, so an event describing
 * an older state could otherwise overwrite a newer one. Asking the API always
 * returns current truth, which removes the ordering problem entirely instead
 * of trying to detect it.
 */
async function mirrorSubscription(subscriptionId: string): Promise<void> {
  const org = await prisma.org.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  });
  if (!org) {
    console.error("Stripe webhook: no org for subscription", subscriptionId);
    return;
  }

  const subscription = await retrieveSubscription(subscriptionId);
  if (!subscription) return;

  await prisma.org.update({
    where: { id: org.id },
    data: {
      subscriptionStatus: subscription.status,
      trialEndsAt: toDate(subscription.trial_end),
      currentPeriodEnd: periodEnd(subscription),
    },
  });
}

async function retrieveSubscription(
  ref: string | Stripe.Subscription | null | undefined,
): Promise<Stripe.Subscription | null> {
  const id = typeof ref === "string" ? ref : ref?.id;
  if (!id) return null;
  try {
    return (await getStripe().subscriptions.retrieve(id)) as Stripe.Subscription;
  } catch (err) {
    console.error(
      "Stripe webhook: could not retrieve subscription",
      id,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

async function cancelSubscription(
  ref: string | Stripe.Subscription | null | undefined,
): Promise<void> {
  const id = typeof ref === "string" ? ref : ref?.id;
  if (!id) return;
  try {
    await getStripe().subscriptions.cancel(id);
  } catch (err) {
    console.error(
      "Stripe webhook: could not cancel subscription",
      id,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function toDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null;
}

/**
 * The period end lives on the subscription item rather than the subscription
 * in current Stripe API versions. Read defensively so a shape change degrades
 * to a null date instead of throwing inside a webhook.
 */
function periodEnd(subscription: Stripe.Subscription | null): Date | null {
  if (!subscription) return null;
  const item = subscription.items?.data?.[0] as
    | { current_period_end?: number }
    | undefined;
  return toDate(item?.current_period_end);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/api/stripe/webhook/webhook.test.ts`
Expected: PASS, 11 tests.

Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before the next step.

- [ ] **Step 5: Write the failing signature test**

Append to `src/app/api/stripe/webhook/webhook.test.ts`:

```ts
describe("signature verification", () => {
  it("rejects a forged body and writes nothing", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_ID = "price_x";
    process.env.APP_URL = "https://app.example.com";

    const pending = await makePendingSignup({ email: "forged@example.com" });
    const { POST } = await import("@/app/api/stripe/webhook/route");

    const body = JSON.stringify({
      id: "evt_forged",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_forged",
          client_reference_id: pending.id,
          customer: "cus_x",
          subscription: "sub_1",
        },
      },
    });

    const response = await POST(
      new Request("https://app.example.com/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
        body,
      }),
    );

    expect(response.status).toBe(400);
    // The forged event must not have created a tenant on this server.
    expect(await prisma.org.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a request with no signature header at all", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(
      new Request("https://app.example.com/api/stripe/webhook", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
  });
});
```

This test must **not** mock `@/lib/stripe/client`'s `webhooks` — real verification is the thing under test. The existing `getStripe` mock at the top of the file has no `webhooks` property, so add one that delegates to the real SDK:

```ts
// In the getStripe mock, alongside `subscriptions`:
    webhooks: {
      constructEventAsync: async (...args: unknown[]) => {
        const { default: Stripe } = await import("stripe");
        return new Stripe("sk_test_x").webhooks.constructEventAsync(
          ...(args as Parameters<Stripe["webhooks"]["constructEventAsync"]>),
        );
      },
    },
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- src/app/api/stripe/webhook/webhook.test.ts`
Expected: FAIL — `@/app/api/stripe/webhook/route` does not exist.

- [ ] **Step 7: Implement the route**

Create `src/app/api/stripe/webhook/route.ts`:

```ts
import { getStripe } from "@/lib/stripe/client";
import { stripeConfig } from "@/lib/stripe/config";
import { handleStripeEvent } from "@/lib/stripe/handle-event";

/**
 * The only route that creates companies or writes subscription state.
 *
 * Signature verification is not a formality here. This endpoint provisions a
 * tenant, so an unverified body is not merely a free subscription — it is
 * anyone granting themselves a company on this server.
 */
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  // The raw text, never a parsed body: the signature covers the exact bytes
  // Stripe sent, and re-serialising JSON changes them.
  const body = await request.text();

  let event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      body,
      signature,
      stripeConfig().webhookSecret,
    );
  } catch (err) {
    console.error(
      "Stripe webhook rejected:",
      err instanceof Error ? err.message : String(err),
    );
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    // A 500 makes Stripe retry, which is what we want for a transient database
    // problem. Anything permanent has already been handled and returned above.
    console.error(
      "Stripe webhook failed:",
      event.type,
      err instanceof Error ? err.message : String(err),
    );
    return new Response("Handler error", { status: 500 });
  }

  return new Response(null, { status: 200 });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- src/app/api/stripe/webhook/webhook.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 9: Prove signature verification is load-bearing**

Temporarily replace the `constructEventAsync` call with `event = JSON.parse(body);`.

Run: `npm test -- src/app/api/stripe/webhook/webhook.test.ts`
Expected: FAIL — "rejects a forged body and writes nothing" must fail, and an org must have been created by the forged event. If it still passes, the test proves nothing.

**Restore the verification** and re-run to confirm PASS.

- [ ] **Step 10: Full check and commit**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`

```bash
git add src/lib/stripe/handle-event.ts src/app/api/stripe/webhook/
git commit -m "Add the Stripe webhook that provisions an org once a card clears"
```

---

### Task 7: `/billing/return` — claiming the finished account

**Files:**
- Create: `src/app/billing/return/actions.ts`
- Create: `src/app/billing/return/ReturnClient.tsx`
- Create: `src/app/billing/return/page.tsx`
- Test: `src/app/billing/return/claim.test.ts`

**Interfaces:**
- Consumes: `CLAIM_COOKIE` (Task 5); `createSession`, `hashToken` from `@/lib/auth/session`; `handleStripeEvent` (Task 6); `getStripe` (Task 4).
- Produces: `claimAccount(): Promise<ClaimState>` where

```ts
export type ClaimState =
  | { status: "ready" }
  | { status: "pending" }
  | { status: "failed"; reason: "email-taken" | "unknown" };
```

A page render cannot write cookies — `src/lib/auth/dal.ts` already documents that `cookies().set()` throws during render. Signing the owner in therefore has to happen in a Server Action called from the client, not in the page body.

- [ ] **Step 1: Write the failing test**

Create `src/app/billing/return/claim.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makePendingSignup } from "@/test/factories";

const cookieJar = vi.hoisted(() => ({ value: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.value.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      cookieJar.value.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.value.delete(name);
    },
  }),
}));

const reconciled = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/stripe/handle-event", () => ({
  handleStripeEvent: async () => {
    reconciled.calls += 1;
  },
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({
          id,
          status: "complete",
          client_reference_id: "unused",
          customer: "cus_1",
          subscription: "sub_1",
        }),
      },
    },
  }),
}));

const { claimAccount } = await import("@/app/billing/return/actions");
const { CLAIM_COOKIE } = await import("@/lib/auth/claim-cookie");
const { hashToken, SESSION_COOKIE } = await import("@/lib/auth/session");

async function pendingWithCookie(overrides: Record<string, unknown> = {}) {
  const claim = randomBytes(32).toString("base64url");
  const pending = await makePendingSignup({
    email: "dana@example.com",
    claimHash: hashToken(claim),
    ...overrides,
  });
  cookieJar.value.set(CLAIM_COOKIE, claim);
  return { pending, claim };
}

beforeEach(() => {
  cookieJar.value = new Map();
  reconciled.calls = 0;
});

describe("claimAccount", () => {
  it("signs the owner in once the webhook has created the account", async () => {
    const { pending } = await pendingWithCookie();
    const org = await makeOrg();
    const owner = await makeOwner(org.id, "dana@example.com");
    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: { orgId: org.id, consumedAt: new Date(), passwordHash: null },
    });

    const state = await claimAccount();

    expect(state).toEqual({ status: "ready" });
    const token = cookieJar.value.get(SESSION_COOKIE);
    expect(token).toBeTruthy();

    const session = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(token!) },
    });
    expect(session.userId).toBe(owner.id);
    // The claim is single use: it has done its job and must not sit in the
    // browser where it could be replayed.
    expect(cookieJar.value.get(CLAIM_COOKIE)).toBeUndefined();
  });

  it("reports pending while the webhook has not landed", async () => {
    await pendingWithCookie({ checkoutSessionId: "cs_test_1" });

    const state = await claimAccount();

    expect(state).toEqual({ status: "pending" });
    expect(await prisma.session.count()).toBe(0);
  });

  it("grants nothing when the claim cookie is missing", async () => {
    const { pending } = await pendingWithCookie();
    const org = await makeOrg();
    await makeOwner(org.id, "dana@example.com");
    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: { orgId: org.id, consumedAt: new Date() },
    });
    cookieJar.value.delete(CLAIM_COOKIE);

    const state = await claimAccount();

    expect(state).toEqual({ status: "failed", reason: "unknown" });
    expect(await prisma.session.count()).toBe(0);
  });

  it("grants nothing when the claim cookie is wrong", async () => {
    const { pending } = await pendingWithCookie();
    const org = await makeOrg();
    await makeOwner(org.id, "dana@example.com");
    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: { orgId: org.id, consumedAt: new Date() },
    });
    cookieJar.value.set(CLAIM_COOKIE, randomBytes(32).toString("base64url"));

    const state = await claimAccount();

    expect(state).toEqual({ status: "failed", reason: "unknown" });
    expect(await prisma.session.count()).toBe(0);
  });

  it("cannot claim somebody else's paid account with your own cookie", async () => {
    // The claim hash, not the email, is what binds a browser to a signup.
    const victimOrg = await makeOrg();
    await makeOwner(victimOrg.id, "victim@example.com");
    const victim = await makePendingSignup({
      email: "victim@example.com",
      claimHash: hashToken("victim-secret"),
    });
    await prisma.pendingSignup.update({
      where: { id: victim.id },
      data: { orgId: victimOrg.id, consumedAt: new Date() },
    });

    cookieJar.value.set(CLAIM_COOKIE, "attacker-secret");

    expect(await claimAccount()).toEqual({ status: "failed", reason: "unknown" });
    expect(await prisma.session.count()).toBe(0);
  });

  it("reports the email-taken failure so the page can explain it", async () => {
    await pendingWithCookie({ checkoutSessionId: "cs_test_1" });
    await prisma.pendingSignup.updateMany({
      where: { email: "dana@example.com" },
      data: { failedReason: "email-taken" },
    });

    expect(await claimAccount()).toEqual({
      status: "failed",
      reason: "email-taken",
    });
  });

  it("reconciles from Stripe when the webhook is late", async () => {
    await pendingWithCookie({ checkoutSessionId: "cs_test_1" });
    await prisma.pendingSignup.updateMany({
      where: { email: "dana@example.com" },
      data: { createdAt: new Date(Date.now() - 10_000) },
    });

    await claimAccount();

    // Late enough that waiting for the webhook is no longer the right move.
    expect(reconciled.calls).toBe(1);
  });

  it("does not reconcile before the grace period", async () => {
    await pendingWithCookie({ checkoutSessionId: "cs_test_1" });

    await claimAccount();

    expect(reconciled.calls).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/billing/return/claim.test.ts`
Expected: FAIL — the actions module does not exist.

- [ ] **Step 3: Implement the claim action**

Create `src/app/billing/return/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSession, hashToken } from "@/lib/auth/session";
import { CLAIM_COOKIE } from "@/lib/auth/claim-cookie";
import { getStripe } from "@/lib/stripe/client";
import { handleStripeEvent } from "@/lib/stripe/handle-event";

export type ClaimState =
  | { status: "ready" }
  | { status: "pending" }
  | { status: "failed"; reason: "email-taken" | "unknown" };

/**
 * How long to wait for the webhook before asking Stripe directly.
 *
 * Stripe usually delivers in well under a second. The fallback exists for the
 * case where it does not at all: somebody who has just handed over a card and
 * has no account and no way to get one is the worst outcome this design can
 * produce, and it is worth an extra API call to make it impossible.
 */
const WEBHOOK_GRACE_MS = 5_000;

export async function claimAccount(): Promise<ClaimState> {
  const cookieStore = await cookies();
  const claim = cookieStore.get(CLAIM_COOKIE)?.value;

  // No cookie means this browser did not start the signup. Nothing here is
  // keyed on anything a visitor can supply in a URL, so there is nothing to
  // guess at.
  if (!claim) return { status: "failed", reason: "unknown" };

  let pending = await prisma.pendingSignup.findUnique({
    where: { claimHash: hashToken(claim) },
  });

  if (!pending) return { status: "failed", reason: "unknown" };

  if (!pending.consumedAt && shouldReconcile(pending.createdAt)) {
    await reconcileFromStripe(pending.checkoutSessionId);
    pending = await prisma.pendingSignup.findUnique({
      where: { claimHash: hashToken(claim) },
    });
    if (!pending) return { status: "failed", reason: "unknown" };
  }

  if (pending.failedReason) {
    return {
      status: "failed",
      reason: pending.failedReason === "email-taken" ? "email-taken" : "unknown",
    };
  }

  if (!pending.consumedAt || !pending.orgId) return { status: "pending" };

  const owner = await prisma.user.findFirst({
    where: { orgId: pending.orgId, role: "OWNER", email: pending.email },
    select: { id: true },
  });

  if (!owner) return { status: "failed", reason: "unknown" };

  await createSession(owner.id, "OWNER");

  // Single use. The claim has done its only job, and leaving it in the browser
  // would leave a second way into the account for as long as it lived.
  cookieStore.delete(CLAIM_COOKIE);

  return { status: "ready" };
}

function shouldReconcile(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > WEBHOOK_GRACE_MS;
}

/**
 * Asks Stripe whether the checkout completed and, if so, runs exactly the same
 * handler the webhook would have.
 *
 * This is not trusting the return URL: no identifier came from the URL, the
 * session id came from our own row, and the visitor already proved they own
 * the claim cookie. The handler is idempotent, so a webhook arriving after
 * this changes nothing.
 */
async function reconcileFromStripe(
  checkoutSessionId: string | null,
): Promise<void> {
  if (!checkoutSessionId) return;

  try {
    const session = await getStripe().checkout.sessions.retrieve(checkoutSessionId);
    if (session.status !== "complete") return;

    await handleStripeEvent({
      id: `reconcile_${checkoutSessionId}`,
      type: "checkout.session.completed",
      data: { object: session },
    } as never);
  } catch (err) {
    console.error(
      "Checkout reconciliation failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/billing/return/claim.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove the claim cookie is load-bearing**

Temporarily change the lookup to `where: { email: pending?.email ?? "" }`-style matching that ignores `claimHash` — the simplest version is to replace `findUnique({ where: { claimHash: hashToken(claim) } })` with `findFirst({ where: { consumedAt: { not: null } } })`.

Run: `npm test -- src/app/billing/return/claim.test.ts`
Expected: FAIL — "cannot claim somebody else's paid account" and both wrong/missing-cookie tests must fail.

**Restore the lookup** and re-run to confirm PASS.

- [ ] **Step 6: Build the page and client**

Create `src/app/billing/return/ReturnClient.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { claimAccount, type ClaimState } from "./actions";

const POLL_MS = 1_500;
const GIVE_UP_MS = 60_000;

export default function ReturnClient() {
  const router = useRouter();
  const [state, setState] = useState<ClaimState>({ status: "pending" });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    async function poll() {
      const next = await claimAccount();
      if (cancelled) return;

      setState(next);

      if (next.status === "ready") {
        router.replace("/dashboard");
        return;
      }

      if (next.status === "failed") return;

      if (Date.now() - startedAt > GIVE_UP_MS) {
        setTimedOut(true);
        return;
      }

      setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state.status === "failed") {
    return (
      <div className="card mx-auto mt-16 max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">We could not finish setting up</h1>
        <p className="mt-2 text-sm text-muted">
          {state.reason === "email-taken"
            ? "That email address is already registered. Your card has not been charged and the subscription was cancelled."
            : "We could not match this browser to a signup. If you have already paid, try signing in."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link className="btn btn-primary" href="/login">
            Sign in
          </Link>
          <Link className="btn btn-secondary" href="/forgot-password">
            Reset password
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card mx-auto mt-16 max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold">Setting up your account</h1>
      <p className="mt-2 text-sm text-muted">
        {timedOut
          ? "This is taking longer than usual. Your payment went through — refresh this page, or sign in if you already have."
          : "Confirming your payment with Stripe. This usually takes a couple of seconds."}
      </p>
      {timedOut ? (
        <Link className="btn btn-primary mt-4" href="/billing/return">
          Refresh
        </Link>
      ) : null}
    </div>
  );
}
```

Create `src/app/billing/return/page.tsx`:

```tsx
import ReturnClient from "./ReturnClient";

// Public by way of src/proxy.ts: the visitor arrives here straight from Stripe
// with no session, and on a good day no account existed a second ago either.
export default function BillingReturnPage() {
  return <ReturnClient />;
}
```

Check `src/app/globals.css` for the exact muted-text token name before committing — use whatever the landing page and login card already use rather than inventing a class.

- [ ] **Step 7: Full check and commit**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`

```bash
git add src/app/billing/return/
git commit -m "Claim the paid account on return from Stripe"
```

---

### Task 8: The billing page, the portal, and the lapsed banner

**Files:**
- Create: `src/app/(app)/billing/page.tsx`
- Create: `src/app/(app)/billing/actions.ts`
- Create: `src/app/(app)/billing/BillingClient.tsx`
- Create: `src/components/LapsedBanner.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Test: `src/app/(app)/billing/portal.test.ts`

**Interfaces:**
- Consumes: `requireOwner` from `@/lib/auth/dal`; `getStripe`, `stripeConfig` (Task 4); `isOrgActive` (Task 2).
- Produces: `openBillingPortal(): Promise<{ url: string } | { error: string }>`.

`/billing` uses `requireOwner()`, never `requireActiveOrg()`. An account must never be locked out of the screen that lets it pay — gating this page would make a lapsed org unrecoverable.

- [ ] **Step 1: Write the failing test**

Create `src/app/(app)/billing/portal.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner } from "@/test/factories";

const currentUser = vi.hoisted(() => ({
  value: null as null | {
    userId: string;
    orgId: string;
    role: "OWNER" | "CREW";
    crewId: string | null;
    name: string;
  },
}));

const portal = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  fail: false,
}));

vi.mock("@/lib/auth/dal", () => ({
  getSessionUser: async () => currentUser.value,
  verifySession: async () => {
    if (!currentUser.value) throw new Error("redirect: /login");
    return currentUser.value;
  },
  requireOwner: async () => {
    if (currentUser.value?.role !== "OWNER") throw new Error("redirect: /login");
    return currentUser.value;
  },
  requireActiveOrg: async () => {
    if (currentUser.value?.role !== "OWNER") throw new Error("redirect: /login");
    return currentUser.value;
  },
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    billingPortal: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          if (portal.fail) throw new Error("Stripe is down");
          portal.created.push(params);
          return { url: "https://portal.stripe.test/session" };
        },
      },
    },
  }),
}));

vi.mock("@/lib/stripe/config", () => ({
  stripeConfig: () => ({
    secretKey: "sk_test_x",
    webhookSecret: "whsec_x",
    priceId: "price_x",
    portalReturnUrl: "https://app.example.com/billing",
  }),
}));

const { openBillingPortal } = await import("@/app/(app)/billing/actions");

beforeEach(() => {
  currentUser.value = null;
  portal.created = [];
  portal.fail = false;
});

async function actAsOwnerOf(status: string | null, customerId: string | null) {
  const org = await makeOrg();
  await prisma.org.update({
    where: { id: org.id },
    data: { subscriptionStatus: status, stripeCustomerId: customerId },
  });
  const owner = await makeOwner(org.id);
  currentUser.value = {
    userId: owner.id,
    orgId: org.id,
    role: "OWNER",
    crewId: null,
    name: "Owner",
  };
  return org;
}

describe("openBillingPortal", () => {
  it("returns a portal URL for the caller's own Stripe customer", async () => {
    await actAsOwnerOf("active", "cus_1");

    const result = await openBillingPortal();

    expect(result).toEqual({ url: "https://portal.stripe.test/session" });
    expect(portal.created[0]).toMatchObject({ customer: "cus_1" });
  });

  it("works for a LAPSED org, which is the whole point of this page", async () => {
    await actAsOwnerOf("past_due", "cus_2");

    const result = await openBillingPortal();

    expect(result).toEqual({ url: "https://portal.stripe.test/session" });
  });

  it("returns a readable error instead of throwing when Stripe is down", async () => {
    await actAsOwnerOf("active", "cus_1");
    portal.fail = true;

    const result = await openBillingPortal();

    // Returned, not thrown: production React redacts thrown Server Action
    // messages and the owner would see boilerplate instead.
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/billing/i);
  });

  it("returns an error when the org has no Stripe customer", async () => {
    await actAsOwnerOf(null, null);

    const result = await openBillingPortal();

    expect(result).toHaveProperty("error");
    expect(portal.created).toEqual([]);
  });

  it("refuses a crew member", async () => {
    const org = await makeOrg();
    currentUser.value = {
      userId: "x",
      orgId: org.id,
      role: "CREW",
      crewId: null,
      name: "Crew",
    };

    await expect(openBillingPortal()).rejects.toThrow("redirect: /login");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- "src/app/(app)/billing/portal.test.ts"`
Expected: FAIL — the actions module does not exist.

- [ ] **Step 3: Implement the portal action**

Create `src/app/(app)/billing/actions.ts`:

```ts
"use server";

import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { getStripe } from "@/lib/stripe/client";
import { stripeConfig } from "@/lib/stripe/config";

export type PortalResult = { url: string } | { error: string };

/**
 * Opens Stripe's hosted billing portal, where a customer updates their card,
 * reads invoices and cancels. We build none of that ourselves.
 *
 * requireOwner and not requireActiveOrg: this is the screen a lapsed account
 * uses to stop being lapsed, so gating it would make lapsing unrecoverable.
 */
export async function openBillingPortal(): Promise<PortalResult> {
  const { orgId } = await requireOwner();

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { stripeCustomerId: true },
  });

  if (!org?.stripeCustomerId) {
    return { error: "This company has no billing account yet." };
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: stripeConfig().portalReturnUrl,
    });
    return { url: session.url };
  } catch (err) {
    console.error(
      "Billing portal unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: "We could not open billing right now. Please try again." };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- "src/app/(app)/billing/portal.test.ts"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Build the billing page**

Create `src/app/(app)/billing/BillingClient.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { openBillingPortal } from "./actions";

export default function BillingClient() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setError(null);
    startTransition(async () => {
      const result = await openBillingPortal();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      window.location.href = result.url;
    });
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={open} disabled={pending}>
        {pending ? "Opening…" : "Manage billing"}
      </button>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
```

Create `src/app/(app)/billing/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { isOrgActive } from "@/lib/subscription";
import BillingClient from "./BillingClient";

const LABELS: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment failed",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
};

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BillingPage() {
  const { orgId } = await requireOwner();

  const org = await prisma.org.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      subscriptionStatus: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      stripeCustomerId: true,
    },
  });

  const active = isOrgActive(org.subscriptionStatus);
  const status = org.subscriptionStatus ?? "none";

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Billing</h1>

      <div className="card mt-4 p-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">Status</dt>
            <dd className="mt-1 font-medium">{LABELS[status] ?? "No subscription"}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">
              {org.subscriptionStatus === "trialing" ? "Trial ends" : "Next billing date"}
            </dt>
            <dd className="mt-1 font-medium">
              {formatDate(
                org.subscriptionStatus === "trialing"
                  ? org.trialEndsAt
                  : org.currentPeriodEnd,
              )}
            </dd>
          </div>
        </dl>

        {!active ? (
          <p className="mt-4 text-sm">
            Your account is read-only until billing is sorted out. Your schedule and
            customers are all still here, and your crews can still mark stops complete.
          </p>
        ) : null}

        {org.stripeCustomerId ? (
          <div className="mt-6">
            <BillingClient />
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">
            No billing account is attached to this company yet.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add the lapsed banner to the app shell**

Create `src/components/LapsedBanner.tsx`:

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/dal";
import { isOrgActive } from "@/lib/subscription";

/**
 * Shown to owners of a lapsed company on every screen.
 *
 * Crew never see it: they cannot fix it, and their work is deliberately not
 * blocked by it.
 */
export default async function LapsedBanner() {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") return null;

  const org = await prisma.org.findUnique({
    where: { id: user.orgId },
    select: { subscriptionStatus: true },
  });

  if (isOrgActive(org?.subscriptionStatus)) return null;

  return (
    <div className="border-b border-border bg-surface px-4 py-2 text-sm">
      <span>
        Your account is read-only until billing is sorted out.{" "}
        <Link className="underline" href="/billing">
          Manage billing
        </Link>
      </span>
    </div>
  );
}
```

In `src/app/(app)/layout.tsx`, import it and render it in its own Suspense boundary directly above the existing `VerifyBanner` boundary:

```tsx
        {/* Its own boundary for the same reason VerifyBanner has one: awaiting
            the subscription status must not delay the nav or {children}. */}
        <Suspense fallback={null}>
          <LapsedBanner />
        </Suspense>
```

Match the surrounding markup conventions — check `src/components/VerifyBanner.tsx` and use the same colour tokens and spacing rather than the placeholders above. Do not hard-code colours; `src/app/globals.css` owns them.

- [ ] **Step 7: Full check and commit**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`

```bash
git add "src/app/(app)/billing/" src/components/LapsedBanner.tsx "src/app/(app)/layout.tsx"
git commit -m "Add the billing page, the Stripe portal, and the lapsed banner"
```

---

### Task 9: Grandfather existing orgs, and document the whole thing

**Files:**
- Create: `prisma/backfill-subscriptions.ts`
- Modify: `package.json` (adds `db:grandfather`)
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: the `Org` columns from Task 1.
- Produces: `npm run db:grandfather`.

**This script writes to whichever database `DATABASE_URL` points at.** `AGENTS.md` forbids writing to production, and this is a deliberate, narrow exception. Do not run it against production as part of implementing this plan — leave that to the owner, who must ask for it explicitly.

- [ ] **Step 1: Write the script**

Create `prisma/backfill-subscriptions.ts`, following the shape of `prisma/backfill-org.ts`:

```ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Marks companies that existed before billing as permanently active.
 *
 * They signed up when the product was free, and dropping them to read-only on
 * deploy day would take away something they already had. They have no Stripe
 * customer, so nothing here will ever change their status again.
 *
 * Idempotent: only rows with no subscriptionStatus are touched, so a repeated
 * run changes nothing and a company that later subscribes for real is never
 * overwritten.
 */
async function main() {
  if (process.env.GRANDFATHER_CONFIRM !== "yes") {
    throw new Error(
      "Refusing to run: set GRANDFATHER_CONFIRM=yes. This writes to whatever " +
        "database DATABASE_URL points at, which is production by default.",
    );
  }

  const targets = await prisma.org.findMany({
    where: { subscriptionStatus: null, stripeCustomerId: null },
    select: { id: true, name: true },
  });

  if (targets.length === 0) {
    console.log("Nothing to grandfather.");
    return;
  }

  console.log(`Grandfathering ${targets.length} company(ies):`);
  for (const org of targets) console.log(`  - ${org.name}`);

  const { count } = await prisma.org.updateMany({
    where: { subscriptionStatus: null, stripeCustomerId: null },
    data: { subscriptionStatus: "active" },
  });

  console.log(`Updated ${count}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Add to `package.json` scripts:

```json
    "db:grandfather": "tsx prisma/backfill-subscriptions.ts",
```

- [ ] **Step 2: Verify it against the TEST database only**

```bash
GRANDFATHER_CONFIRM=yes DATABASE_URL="$TEST_DATABASE_URL" npx tsx prisma/backfill-subscriptions.ts
```

Expected: it reports how many companies it would grandfather in the test database and exits 0. Confirm the guard works too:

```bash
DATABASE_URL="$TEST_DATABASE_URL" npx tsx prisma/backfill-subscriptions.ts
```

Expected: exits non-zero with the "Refusing to run" message.

- [ ] **Step 3: Document the billing model in `AGENTS.md`**

Add a `## Billing` section after `## Email`:

````markdown
## Billing

Stripe, via hosted Checkout and the hosted Billing Portal. Card data never
reaches this server.

**Nobody has an account until Stripe confirms a card.** `signup` writes a
`PendingSignup` row and an httpOnly claim cookie, then redirects to Checkout.
`POST /api/stripe/webhook` is the only code that creates an `Org` — which is
why its signature verification is not a formality, and why that route is exempt
from the signed-out redirect in `src/proxy.ts`.

`/billing/return` is public and identifies the visitor by the claim cookie
alone. No identifier rides in the URL: URLs are shared, logged, and leak in
`Referer` headers.

**`requireActiveOrg()` gates every owner write path.** Reads keep calling
`requireOwner()`. `updateJobStatus` deliberately calls only `verifySession()`
so a lapsed company's crews can still mark stops complete — blocking that
strands people in a yard mid-week to collect from their employer. `/billing`
and everything in `account/actions.ts` stay ungated, or a lapsed account could
never recover.

Subscription events re-fetch the subscription from Stripe rather than trusting
the event body, which removes webhook ordering as a concern entirely.

Requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` and a
real `APP_URL` — `requireAppUrl()` throws rather than defaulting to localhost,
because a localhost `success_url` sends a paying customer to their own machine
and looks like success from our side.

`npm run db:grandfather` marks pre-billing companies active. It writes to
`DATABASE_URL` and needs `GRANDFATHER_CONFIRM=yes`. Do not run it without the
owner asking.
````

Also add to the "Things that have already gone wrong here" list:

```markdown
- **`/billing/return` must stay in `PUBLIC_PREFIXES`, and `/billing` must not.**
  The prefix match means the shorter string would make the owner's billing page
  public to anyone.
```

- [ ] **Step 4: Full check and commit**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`

```bash
git add prisma/backfill-subscriptions.ts package.json AGENTS.md
git commit -m "Add the grandfathering script and document the billing model"
```

---

## Final verification

- [ ] `npx tsc --noEmit && npm run lint && npm run build && npm test` — all four pass.
- [ ] Every "prove the protection is load-bearing" step was actually run and actually failed before being reverted. There are five: Tasks 2, 3, 5, 6, and 7.
- [ ] `git grep -n "requireOwner" "src/app/(app)"` — every remaining hit is a read, `/billing`, or an `account/actions.ts` credential path.
- [ ] `git grep -n "requireActiveOrg" "src/app/(app)"` — fourteen actions.
- [ ] No dev server left running.

## Left to the owner, outside the code

- Create the Stripe account, Product and monthly Price; set `STRIPE_PRICE_ID`.
- Add the webhook endpoint in Stripe's dashboard and copy its signing secret.
- Set a real `APP_URL` in production.
- Confirm the landing page says a card is required to start the trial.
- Decide whether to run `npm run db:grandfather` against production.
- Publish terms of service and a refund policy before charging anyone.
