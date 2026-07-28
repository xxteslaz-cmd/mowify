# Multi-Tenant Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-tenant authentication to Mowify so each landscaping company has isolated data, owners log in with email and password, and crew members log in with a username and PIN.

**Architecture:** A hand-rolled auth module (`src/lib/auth/`) with database-backed sessions. Authorization lives in a Data Access Layer that every data function and server action calls *itself* — never as a caller-supplied parameter — so scope cannot be forgotten. `proxy.ts` does optimistic redirects only; the DAL is the security boundary.

**Tech Stack:** Next.js 16.2.12 (App Router), React 19.2.4, Prisma 7.9 with the `@prisma/adapter-pg` driver adapter, PostgreSQL, Tailwind v4, TypeScript. Adding: `@node-rs/argon2`, `zod`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-07-27-auth-design.md`

## Global Constraints

- **This is NOT the Next.js you know.** Per `AGENTS.md`, read the relevant guide in `node_modules/next/dist/docs/` before writing code in an unfamiliar area. Confirmed breaking change: `middleware.ts` is now **`proxy.ts`** and runs on the **Node.js runtime**.
- **PIN length is 6 digits.** Lockout after **5** consecutive failures for **15 minutes**.
- **Session lifetime:** `OWNER` = 7 days, `CREW` = 30 days. Both sliding.
- **Never store a raw session token.** The cookie holds a random token; the database stores only its SHA-256.
- **Never accept `orgId` from the client.** It always comes from the DAL.
- **Cross-org access 404s.** It must be indistinguishable from a missing record — never a message revealing the record exists elsewhere.
- **Login errors are generic** ("Invalid email or password" / "Invalid username or PIN"), identical whether or not the account exists. Lockout is the sole deliberate exception.
- **Date convention:** dates are date-only, stored as UTC midnight. Always use the helpers in `src/lib/date.ts`. Never use local-time getters on a stored date.
- **Comment style:** the codebase comments *why*, not *what*, in full sentences. Match it. Do not add narration comments.
- Existing code uses `"use server"` at the top of action files and plain `async function` exports. Follow that.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `src/lib/auth/password.ts` | argon2 hashing and verification for passwords and PINs |
| `src/lib/auth/session.ts` | Session token generation, cookie handling, create/refresh/delete |
| `src/lib/auth/dal.ts` | `verifySession` / `requireOwner` / `requireCrew` — the authorization boundary |
| `src/lib/auth/slug.ts` | Company-name → URL slug derivation |
| `src/app/login/page.tsx`, `actions.ts`, `LoginForm.tsx` | Owner login |
| `src/app/signup/page.tsx`, `actions.ts`, `SignupForm.tsx` | Company + owner creation |
| `src/app/c/[slug]/page.tsx`, `actions.ts`, `CrewLoginForm.tsx` | Crew username + PIN login |
| `src/app/team/page.tsx`, `actions.ts`, `TeamClient.tsx` | Crew login management |
| `src/components/UserMenu.tsx` | The signed-in panel in the nav |
| `proxy.ts` | Optimistic redirect for logged-out visitors |
| `prisma/backfill-org.ts` | One-time migration of existing data into an Org |
| `vitest.config.ts`, `src/test/setup.ts`, `src/test/factories.ts` | Test infrastructure |

**Modified files:** `prisma/schema.prisma`, `src/lib/data.ts`, `src/lib/recurring.ts`, `src/app/dashboard/actions.ts`, `src/app/customers/actions.ts`, `src/app/dashboard/page.tsx`, `src/app/crew/[crewId]/today/page.tsx`, `src/components/MainNav.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `package.json`, `.env.example`.

**Task order rationale:** schema and auth primitives come first, then login routes, and only then is org scoping applied. Scoping the data layer before a way to log in exists would leave the app unusable mid-plan.

---

### Task 1: Test infrastructure

**Files:**
- Create: `vitest.config.ts`, `src/test/setup.ts`, `src/test/factories.ts`
- Modify: `package.json`, `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test`; `resetDb(): Promise<void>`; factories `makeOrg(name?: string)`, `makeOwner(orgId: string, email?: string)`, `makeCrewUser(orgId: string, crewId: string, username?: string)`, `makeCrew(orgId: string, name?: string)`, `makeCustomer(orgId: string)`, `makeJob(orgId: string, crewId: string, customerId: string, dateISO?: string)`. Factories are written in Task 6, after the schema exists; this task creates the config and the empty module.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev vitest @vitejs/plugin-react vite-tsconfig-paths
npm install @node-rs/argon2 zod
```

- [ ] **Step 2: Create `vitest.config.ts`**

Tests touch the database and Node APIs, so they run in the `node` environment, single-threaded — parallel workers sharing one Postgres database cause flaky cross-test interference.

The `env` block is what points tests at the test database. `TEST_DATABASE_URL` is already provisioned in `.env` (a separate `mowify_test` database on the same Neon project), so nobody has to remember to swap `DATABASE_URL` by hand before running tests.

```ts
import "dotenv/config";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    // Tests truncate every table, so they must never see the development
    // database. This override is the only thing standing between a test run
    // and real data.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
    // These tests share one Postgres database, so they must not run in
    // parallel against each other.
    fileParallelism: false,
  },
});
```

`fileParallelism: false` is how Vitest 4 serializes test files. The older
`poolOptions: { forks: { singleFork: true } }` no longer typechecks against
Vitest 4's config type.

- [ ] **Step 3: Create `src/test/setup.ts`**

```ts
import { beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";

if (!process.env.DATABASE_URL?.includes("test")) {
  throw new Error(
    'Refusing to run tests: DATABASE_URL must contain "test". ' +
      "Point it at a scratch database, not development or production.",
  );
}

export async function resetDb() {
  // Order matters: children before parents, since foreign keys are enforced.
  // Task 2 adds the Session, User and Org deletes when those models exist —
  // referencing them before then would not typecheck.
  await prisma.job.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.crew.deleteMany();
}

beforeEach(async () => {
  await resetDb();
});
```

The guard is the important part. A test run truncates every table; pointed at the development database it destroys real work.

- [ ] **Step 4: Create `src/test/factories.ts` as a placeholder**

```ts
// Factories are implemented in Task 6, once the Org, User and Session models
// exist in the schema.
export {};
```

- [ ] **Step 5: Add the test script to `package.json`**

Add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"db:push:test": "prisma db push --url $TEST_DATABASE_URL"
```

`db:push:test` matters because there are now two databases. Every schema change
has to reach both, or the tests run against a stale shape.

- [ ] **Step 6: Document the test database in `.env.example`**

The real `TEST_DATABASE_URL` is already set in `.env`. This documents it for
anyone setting the project up fresh.

```bash
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"

# Must contain "test" in the name. Tests truncate every table on this database
# before each test, so it must never point at development or production data.
# vitest.config.ts injects this as DATABASE_URL for test runs.
TEST_DATABASE_URL="postgresql://user:password@host/mowify_test?sslmode=require"
```

- [ ] **Step 7: Verify the setup guard works**

Run: `npm test`
Expected: exits reporting no test files found, with no DATABASE_URL guard error —
`TEST_DATABASE_URL` already points at `mowify_test`, which contains "test".

To confirm the guard is real rather than vacuous, temporarily change the `env`
line in `vitest.config.ts` to `process.env.DATABASE_URL` and run `npm test`
again. Expected: it throws "Refusing to run tests". **Change it back.**

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts src/test package.json package-lock.json .env.example
git commit -m "test: add vitest infrastructure with test-database guard"
```

---

### Task 2: Schema — new models and nullable orgId

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `Org`, `User`, `Session`, enum `Role`; nullable `orgId` on `Crew`, `Customer`, `Job`.

`orgId` is nullable in this task **on purpose**. Existing rows have no org, and a required column would reject them. Task 6 backfills and then tightens it.

- [ ] **Step 1: Add the new models to `prisma/schema.prisma`**

```prisma
enum Role {
  OWNER
  CREW
}

model Org {
  id        String     @id @default(cuid())
  name      String
  // Appears in the crew login URL, e.g. /c/acme-lawn
  slug      String     @unique
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

  // Crew credentials. Null for OWNER users. The username is unique per-org
  // rather than globally, so every company can have its own "jose".
  username String?
  pinHash  String?
  crewId   String?
  crew     Crew?   @relation(fields: [crewId], references: [id])

  active Boolean @default(true)

  failedAttempts Int       @default(0)
  lockedUntil    DateTime?

  sessions Session[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([orgId, username])
  @@index([orgId])
}

model Session {
  id String @id @default(cuid())
  // SHA-256 of the cookie token. The raw token is never stored, so a database
  // leak yields no usable session cookies.
  tokenHash String @unique
  userId    String
  user      User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
}
```

- [ ] **Step 2: Add nullable `orgId` to `Crew`**

Add these lines inside `model Crew`:

```prisma
  orgId String?
  org   Org?    @relation(fields: [orgId], references: [id])
  users User[]

  @@index([orgId])
```

The `users User[]` back-relation is required by Prisma because `User.crew` points here.

- [ ] **Step 3: Add nullable `orgId` to `Customer`**

Add inside `model Customer`:

```prisma
  orgId String?
  org   Org?    @relation(fields: [orgId], references: [id])

  @@index([orgId])
```

- [ ] **Step 4: Add nullable `orgId` to `Job`**

Add inside `model Job`:

```prisma
  orgId String?
  org   Org?    @relation(fields: [orgId], references: [id])
```

Leave `Job`'s existing indexes alone for now — Task 6 rewrites them once `orgId` is non-null.

- [ ] **Step 5: Extend the test reset to the new models**

Now that `Org`, `User` and `Session` exist, `src/test/setup.ts` can clear them.
Replace the body of `resetDb`:

```ts
export async function resetDb() {
  // Order matters: children before parents, since foreign keys are enforced.
  await prisma.session.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.org.deleteMany();
}
```

Do this after `prisma generate` in the next step, or the new model properties
will not exist on the client yet.

- [ ] **Step 6: Push the schema to both databases and regenerate the client**

Run: `npm run db:push && npm run db:push:test && npx prisma generate`
Expected: both succeed with no data loss warnings. Every added column is nullable, so no existing row is rejected.

The test database needs the same schema or Task 17's suite fails against a stale shape.

- [ ] **Step 7: Verify the client has the new types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add Org, User and Session models with nullable orgId"
```

---

### Task 3: Password and PIN hashing

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/password.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `hashSecret(plaintext: string): Promise<string>`, `verifySecret(hash: string, plaintext: string): Promise<boolean>`.

Both passwords and PINs use these. A 6-digit PIN has far less entropy than a password, so it needs the same work factor, not a reduced one.

- [ ] **Step 1: Write the failing test**

`src/lib/auth/password.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashSecret, verifySecret } from "./password";

describe("password hashing", () => {
  it("verifies a correct secret", async () => {
    const hash = await hashSecret("correct-horse-battery");
    expect(await verifySecret(hash, "correct-horse-battery")).toBe(true);
  });

  it("rejects an incorrect secret", async () => {
    const hash = await hashSecret("correct-horse-battery");
    expect(await verifySecret(hash, "wrong-password")).toBe(false);
  });

  it("verifies a numeric PIN", async () => {
    const hash = await hashSecret("481920");
    expect(await verifySecret(hash, "481920")).toBe(true);
    expect(await verifySecret(hash, "481921")).toBe(false);
  });

  it("produces a different hash for the same input each time", async () => {
    // Distinct salts mean two crew members who pick the same PIN do not share
    // a hash, so cracking one does not reveal the other.
    const a = await hashSecret("481920");
    const b = await hashSecret("481920");
    expect(a).not.toBe(b);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    expect(await verifySecret("not-a-real-hash", "anything")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/auth/password.test.ts`
Expected: FAIL — cannot resolve `./password`.

- [ ] **Step 3: Implement `src/lib/auth/password.ts`**

```ts
import "server-only";
import { hash, verify } from "@node-rs/argon2";

/**
 * Hashes a password or a PIN with argon2id.
 *
 * PINs get the same cost as passwords deliberately. Six digits is only a
 * million possibilities, so the work factor is doing more of the defensive
 * work there than it does for a password, not less.
 */
export async function hashSecret(plaintext: string): Promise<string> {
  return hash(plaintext);
}

export async function verifySecret(
  hashed: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await verify(hashed, plaintext);
  } catch {
    // A malformed or truncated hash is a failed match, not a crash that would
    // surface as a 500 on the login form.
    return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/auth/password.test.ts`
Expected: PASS, 5 tests.

If `server-only` is not resolvable under vitest, install it: `npm install server-only`, then add to `vitest.config.ts` under `test`: `alias: { "server-only": "/src/test/empty.ts" }` and create `src/test/empty.ts` containing `export {};`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/password.ts src/lib/auth/password.test.ts
git commit -m "feat: add argon2 password and PIN hashing"
```

---

### Task 4: Session tokens

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/auth/session.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/prisma`.
- Produces:
  - `SESSION_COOKIE = "mowify_session"` — exported from `src/lib/auth/cookie.ts`, re-exported here
  - `hashToken(token: string): string`
  - `sessionDuration(role: Role): number` — milliseconds
  - `createSession(userId: string, role: Role): Promise<void>`
  - `readSessionToken(): Promise<string | null>`
  - `deleteSession(): Promise<void>`
  - `deleteAllSessionsForUser(userId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

`src/lib/auth/session.test.ts`. Cookie-dependent functions are covered in Task 5 through the DAL; here we test the pure and database parts.

```ts
import { describe, it, expect } from "vitest";
import { hashToken, sessionDuration } from "./session";

describe("session tokens", () => {
  it("hashes a token deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("does not return the token itself", () => {
    // The stored value must not be reversible to the cookie value.
    expect(hashToken("abc")).not.toContain("abc");
  });

  it("gives crew a longer session than owners", () => {
    // Crew should not have to re-enter a PIN in a truck every Monday.
    expect(sessionDuration("CREW")).toBeGreaterThan(sessionDuration("OWNER"));
    expect(sessionDuration("OWNER")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(sessionDuration("CREW")).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: FAIL — cannot resolve `./session`.

- [ ] **Step 3: Create `src/lib/auth/cookie.ts`**

The cookie name alone, in a module with no imports:

```ts
export const SESSION_COOKIE = "mowify_session";
```

`proxy.ts` needs this constant. If it imported it from `session.ts`, the proxy —
which runs on **every request** — would pull in Prisma and `next/headers`
transitively. Keeping the constant dependency-free avoids that.

- [ ] **Step 4: Implement `src/lib/auth/session.ts`**

```ts
import "server-only";
import { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "./cookie";

export { SESSION_COOKIE };

const OWNER_DURATION = 7 * 24 * 60 * 60 * 1000;
const CREW_DURATION = 30 * 24 * 60 * 60 * 1000;

export function sessionDuration(role: Role): number {
  return role === "CREW" ? CREW_DURATION : OWNER_DURATION;
}

/**
 * The database stores only this hash, never the token in the cookie, so a
 * leaked database dump yields no usable sessions.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, role: Role): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDuration(role));

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function readSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function deleteSession(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Used when an owner deactivates a crew login or resets a PIN, so the change
 * takes effect on the crew member's phone immediately rather than whenever
 * their session happens to expire.
 */
export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/cookie.ts src/lib/auth/session.ts src/lib/auth/session.test.ts
git commit -m "feat: add database-backed session tokens"
```

---

### Task 5: The Data Access Layer

**Files:**
- Create: `src/lib/auth/dal.ts`

**Interfaces:**
- Consumes: `hashToken`, `readSessionToken`, `sessionDuration`, `SESSION_COOKIE` from `./session`.
- Produces:
  - `type SessionUser = { userId: string; orgId: string; role: Role; crewId: string | null; name: string }`
  - `getSessionUser(): Promise<SessionUser | null>` — no redirect, for the nav
  - `verifySession(): Promise<SessionUser>` — redirects to `/login` if absent
  - `requireOwner(): Promise<SessionUser>` — redirects if not an owner
  - `requireCrew(): Promise<SessionUser>` — redirects if not crew

This is the security boundary for the entire application. Everything downstream depends on these exact names and shapes.

- [ ] **Step 1: Read the Next.js guide first**

Read `node_modules/next/dist/docs/01-app/02-guides/authentication.md`, the "Creating a Data Access Layer (DAL)" section. This version's guidance on `cache()` and on avoiding auth checks in layouts is what this task implements.

- [ ] **Step 2: Implement `src/lib/auth/dal.ts`**

```ts
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  hashToken,
  readSessionToken,
  sessionDuration,
} from "./session";

export type SessionUser = {
  userId: string;
  orgId: string;
  role: Role;
  crewId: string | null;
  name: string;
};

/**
 * Resolves the current user, or null when signed out.
 *
 * Wrapped in React's cache so a render pass costs one query no matter how many
 * data functions call it.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Clear it out on encounter rather than accumulating dead rows.
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  // A deactivated crew member keeps their cookie until it expires, so the
  // active flag has to be checked on every request, not only at login.
  if (!session.user.active) return null;

  await refreshIfStale(session.id, session.expiresAt, session.user.role, token);

  return {
    userId: session.user.id,
    orgId: session.user.orgId,
    role: session.user.role,
    crewId: session.user.crewId,
    name: session.user.name,
  };
});

/**
 * Sliding expiry, extended only past the halfway mark so an active user is
 * never logged out mid-route without writing on every single request.
 */
async function refreshIfStale(
  sessionId: string,
  expiresAt: Date,
  role: Role,
  token: string,
): Promise<void> {
  const duration = sessionDuration(role);
  const remaining = expiresAt.getTime() - Date.now();
  if (remaining > duration / 2) return;

  const next = new Date(Date.now() + duration);
  await prisma.session.update({
    where: { id: sessionId },
    data: { expiresAt: next },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: next,
    path: "/",
  });
}

export async function verifySession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireOwner(): Promise<SessionUser> {
  const user = await verifySession();
  if (user.role !== "OWNER") redirect("/login");
  return user;
}

export async function requireCrew(): Promise<SessionUser> {
  const user = await verifySession();
  if (user.role !== "CREW") redirect("/login");
  return user;
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

There is no unit test in this task. `cookies()` and `redirect()` only work inside a Next.js request, so the DAL is verified end-to-end by the cross-org isolation suite in Task 17 — which is the test that actually matters for it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/dal.ts
git commit -m "feat: add data access layer for session authorization"
```

---

### Task 6: Backfill existing data and require orgId

**Files:**
- Create: `prisma/backfill-org.ts`, `src/lib/auth/slug.ts`, `src/lib/auth/slug.test.ts`
- Modify: `prisma/schema.prisma`, `src/test/factories.ts`, `package.json`

**Interfaces:**
- Consumes: `hashSecret` from `@/lib/auth/password`.
- Produces: `slugify(name: string): string`; `uniqueSlug(name: string, exists: (s: string) => Promise<boolean>): Promise<string>`; non-nullable `orgId` everywhere; the test factories declared in Task 1.

All existing crews, customers, and jobs belong to a single company — the user's own. That is confirmed and is what this backfill assumes.

- [ ] **Step 1: Write the failing slug test**

`src/lib/auth/slug.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Lawn Care")).toBe("acme-lawn-care");
  });

  it("strips punctuation", () => {
    expect(slugify("Bob's Mowing, LLC.")).toBe("bobs-mowing-llc");
  });

  it("collapses repeated separators", () => {
    expect(slugify("Green   &   Clean")).toBe("green-clean");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  !Yard Guys!  ")).toBe("yard-guys");
  });

  it("falls back when a name has no usable characters", () => {
    expect(slugify("!!!")).toBe("company");
  });
});

describe("uniqueSlug", () => {
  it("returns the base slug when it is free", async () => {
    expect(await uniqueSlug("Acme Lawn", async () => false)).toBe("acme-lawn");
  });

  it("appends a counter when taken", async () => {
    const taken = new Set(["acme-lawn", "acme-lawn-2"]);
    expect(await uniqueSlug("Acme Lawn", async (s) => taken.has(s))).toBe(
      "acme-lawn-3",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/auth/slug.test.ts`
Expected: FAIL — cannot resolve `./slug`.

- [ ] **Step 3: Implement `src/lib/auth/slug.ts`**

```ts
/**
 * Turns a company name into the slug that appears in its crew login URL.
 * Kept free of database access so it can be unit-tested and reused by both
 * signup and the backfill script.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A name of pure punctuation would otherwise produce an empty URL segment.
  return slug || "company";
}

export async function uniqueSlug(
  name: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(name);
  if (!(await exists(base))) return base;

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/auth/slug.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the backfill script**

`prisma/backfill-org.ts`:

```ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashSecret } from "../src/lib/auth/password";
import { slugify } from "../src/lib/auth/slug";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Moves the pre-auth data into a single Org and creates its owner.
 *
 * Idempotent: if an Org already exists the script makes no changes, so a
 * repeated run during deployment is harmless.
 */
async function main() {
  const companyName = process.env.BACKFILL_COMPANY_NAME;
  const ownerName = process.env.BACKFILL_OWNER_NAME;
  const ownerEmail = process.env.BACKFILL_OWNER_EMAIL;
  const ownerPassword = process.env.BACKFILL_OWNER_PASSWORD;

  if (!companyName || !ownerName || !ownerEmail || !ownerPassword) {
    throw new Error(
      "Set BACKFILL_COMPANY_NAME, BACKFILL_OWNER_NAME, BACKFILL_OWNER_EMAIL " +
        "and BACKFILL_OWNER_PASSWORD before running this script.",
    );
  }

  const existing = await prisma.org.findFirst();
  if (existing) {
    console.log(`Org "${existing.name}" already exists; nothing to do.`);
    return;
  }

  const org = await prisma.org.create({
    data: { name: companyName, slug: slugify(companyName) },
  });

  await prisma.user.create({
    data: {
      orgId: org.id,
      role: "OWNER",
      name: ownerName,
      email: ownerEmail.toLowerCase(),
      passwordHash: await hashSecret(ownerPassword),
    },
  });

  const crews = await prisma.crew.updateMany({
    where: { orgId: null },
    data: { orgId: org.id },
  });
  const customers = await prisma.customer.updateMany({
    where: { orgId: null },
    data: { orgId: org.id },
  });
  const jobs = await prisma.job.updateMany({
    where: { orgId: null },
    data: { orgId: org.id },
  });

  console.log(
    `Backfilled into "${org.name}" (/c/${org.slug}): ` +
      `${crews.count} crews, ${customers.count} customers, ${jobs.count} jobs.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Add the script to `package.json`**

Add to `"scripts"`: `"db:backfill-org": "tsx prisma/backfill-org.ts"`

- [ ] **Step 7: Run the backfill against your development database**

```bash
BACKFILL_COMPANY_NAME="Your Company" \
BACKFILL_OWNER_NAME="Your Name" \
BACKFILL_OWNER_EMAIL="you@example.com" \
BACKFILL_OWNER_PASSWORD="pick-a-real-password" \
npm run db:backfill-org
```

Expected: prints the counts of crews, customers, and jobs moved.

- [ ] **Step 8: Verify the backfill is idempotent**

Run the exact same command a second time.
Expected: prints `Org "Your Company" already exists; nothing to do.` and makes no
changes. A deployment that retries this script must not create a second company
or a duplicate owner.

Confirm no duplicates were created:
```bash
npx tsx -e 'import"dotenv/config";import{PrismaClient}from"@prisma/client";import{PrismaPg}from"@prisma/adapter-pg";const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});Promise.all([p.org.count(),p.user.count()]).then(([o,u])=>console.log("orgs:",o,"users:",u)).finally(()=>p.$disconnect())'
```
Expected: `orgs: 1 users: 1`.

- [ ] **Step 9: Verify no orphan rows remain**

Run:
```bash
npx tsx -e 'import{PrismaClient}from"@prisma/client";import{PrismaPg}from"@prisma/adapter-pg";import"dotenv/config";const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});Promise.all([p.crew.count({where:{orgId:null}}),p.customer.count({where:{orgId:null}}),p.job.count({where:{orgId:null}})]).then(r=>console.log("orphans:",r)).finally(()=>p.$disconnect())'
```
Expected: `orphans: [ 0, 0, 0 ]`. **Do not proceed unless all three are zero** — the next step would fail against orphan rows.

- [ ] **Step 10: Make `orgId` required and rewrite the indexes**

In `prisma/schema.prisma`, change `orgId String?` to `orgId String` and `org Org?` to `org Org` on `Crew`, `Customer`, and `Job`.

Replace `Job`'s index block with org-leading indexes, since every query is now scoped by org:

```prisma
  @@index([orgId, scheduledDate])
  @@index([orgId, crewId, scheduledDate])
  @@index([orgId, customerId])
  @@index([orgId, seriesId])
```

- [ ] **Step 11: Push to both databases and regenerate**

Run: `npm run db:push && npm run db:push:test && npx prisma generate && npx tsc --noEmit`
Expected: succeeds.

The test database has no rows, so making `orgId` required needs no backfill there. Typecheck errors in `data.ts`, `recurring.ts`, and the action files are **not** expected yet — `orgId` becoming required affects creates, which Tasks 10–13 fix. If `prisma create` calls now fail to typecheck, that is correct and those tasks resolve it.

- [ ] **Step 12: Write the test factories**

Replace `src/test/factories.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/lib/auth/password";
import { slugify } from "@/lib/auth/slug";
import { parseISODate } from "@/lib/date";

let counter = 0;
const unique = () => `${Date.now()}-${counter++}`;

export async function makeOrg(name = `Org ${unique()}`) {
  return prisma.org.create({ data: { name, slug: slugify(name) } });
}

export async function makeOwner(
  orgId: string,
  email = `owner-${unique()}@example.com`,
  password = "owner-password",
) {
  return prisma.user.create({
    data: {
      orgId,
      role: "OWNER",
      name: "Test Owner",
      email,
      passwordHash: await hashSecret(password),
    },
  });
}

export async function makeCrew(orgId: string, name = `Crew ${unique()}`) {
  return prisma.crew.create({ data: { orgId, name, color: "#22c55e" } });
}

export async function makeCrewUser(
  orgId: string,
  crewId: string,
  username = `crew-${unique()}`,
  pin = "481920",
) {
  return prisma.user.create({
    data: {
      orgId,
      role: "CREW",
      name: "Test Crew Member",
      username,
      pinHash: await hashSecret(pin),
      crewId,
    },
  });
}

export async function makeCustomer(orgId: string, name = `Cust ${unique()}`) {
  return prisma.customer.create({
    data: { orgId, name, address: "1 Main St" },
  });
}

export async function makeJob(
  orgId: string,
  crewId: string,
  customerId: string,
  dateISO = "2026-08-03",
) {
  return prisma.job.create({
    data: {
      orgId,
      crewId,
      customerId,
      serviceType: "MOW",
      frequency: "WEEKLY",
      scheduledDate: parseISODate(dateISO),
    },
  });
}
```

- [ ] **Step 13: Commit**

```bash
git add prisma/schema.prisma prisma/backfill-org.ts src/lib/auth/slug.ts src/lib/auth/slug.test.ts src/test/factories.ts package.json
git commit -m "feat: backfill existing data into an org and require orgId"
```

---

### Task 7: Owner login and logout

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/app/login/LoginForm.tsx`, `src/lib/auth/lockout.ts`, `src/lib/auth/lockout.test.ts`
- Create: `src/app/logout/actions.ts`

**Interfaces:**
- Consumes: `hashSecret`/`verifySecret`, `createSession`/`deleteSession`.
- Produces:
  - `MAX_FAILED_ATTEMPTS = 5`, `LOCKOUT_MS = 15 * 60 * 1000`
  - `isLocked(user: { lockedUntil: Date | null }): boolean`
  - `nextLockoutState(failedAttempts: number): { failedAttempts: number; lockedUntil: Date | null }`
  - `type AuthFormState = { error?: string } | undefined`
  - `login(state: AuthFormState, formData: FormData): Promise<AuthFormState>`
  - `logout(): Promise<void>`

- [ ] **Step 1: Write the failing lockout test**

`src/lib/auth/lockout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isLocked,
  nextLockoutState,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
} from "./lockout";

describe("isLocked", () => {
  it("is false when never locked", () => {
    expect(isLocked({ lockedUntil: null })).toBe(false);
  });

  it("is true while the lock is in the future", () => {
    expect(isLocked({ lockedUntil: new Date(Date.now() + 60_000) })).toBe(true);
  });

  it("is false once the lock has passed", () => {
    expect(isLocked({ lockedUntil: new Date(Date.now() - 1) })).toBe(false);
  });
});

describe("nextLockoutState", () => {
  it("counts up without locking below the threshold", () => {
    const state = nextLockoutState(0);
    expect(state.failedAttempts).toBe(1);
    expect(state.lockedUntil).toBeNull();
  });

  it("locks at exactly the threshold", () => {
    const state = nextLockoutState(MAX_FAILED_ATTEMPTS - 1);
    expect(state.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(state.lockedUntil).not.toBeNull();
  });

  it("locks for the configured duration", () => {
    const state = nextLockoutState(MAX_FAILED_ATTEMPTS - 1);
    const ms = state.lockedUntil!.getTime() - Date.now();
    expect(ms).toBeGreaterThan(LOCKOUT_MS - 5_000);
    expect(ms).toBeLessThanOrEqual(LOCKOUT_MS);
  });

  it("does not lock at one attempt below the threshold", () => {
    expect(nextLockoutState(MAX_FAILED_ATTEMPTS - 2).lockedUntil).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/auth/lockout.test.ts`
Expected: FAIL — cannot resolve `./lockout`.

- [ ] **Step 3: Implement `src/lib/auth/lockout.ts`**

```ts
/**
 * Throttles credential guessing. This matters most for crew PINs: six digits
 * is a million combinations, which a script would otherwise exhaust quickly
 * against real customer addresses and phone numbers.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export function isLocked(user: { lockedUntil: Date | null }): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
}

export function nextLockoutState(failedAttempts: number): {
  failedAttempts: number;
  lockedUntil: Date | null;
} {
  const next = failedAttempts + 1;
  return {
    failedAttempts: next,
    lockedUntil:
      next >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null,
  };
}

export function lockoutMessage(lockedUntil: Date): string {
  const minutes = Math.max(
    1,
    Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000),
  );
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask your manager to reset it.`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/auth/lockout.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Implement `src/app/login/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySecret } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { isLocked, lockoutMessage, nextLockoutState } from "@/lib/auth/lockout";

export type AuthFormState = { error?: string } | undefined;

// Deliberately identical whether the email is unknown or the password is
// wrong, so the form cannot be used to discover which accounts exist.
const GENERIC_ERROR = "Invalid email or password.";

const LoginSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(1),
});

export async function login(
  _state: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC_ERROR };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (!user || user.role !== "OWNER" || !user.passwordHash || !user.active) {
    return { error: GENERIC_ERROR };
  }

  if (isLocked(user)) return { error: lockoutMessage(user.lockedUntil!) };

  if (!(await verifySecret(user.passwordHash, parsed.data.password))) {
    const next = nextLockoutState(user.failedAttempts);
    await prisma.user.update({ where: { id: user.id }, data: next });
    return next.lockedUntil
      ? { error: lockoutMessage(next.lockedUntil) }
      : { error: GENERIC_ERROR };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null },
  });
  await createSession(user.id, user.role);
  redirect("/dashboard");
}
```

- [ ] **Step 6: Implement `src/app/logout/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { deleteSession } from "@/lib/auth/session";

export async function logout() {
  await deleteSession();
  redirect("/login");
}
```

- [ ] **Step 7: Implement `src/app/login/LoginForm.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
        />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Implement `src/app/login/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  // Someone already signed in has no use for this page.
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">Sign in to Mowify</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        For owners and office staff.
      </p>

      <LoginForm />

      <p className="mt-6 text-sm text-black/60 dark:text-white/60">
        No account yet?{" "}
        <Link href="/signup" className="underline underline-offset-4">
          Create your company
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 9: Verify manually**

Run: `npm run dev`, visit `http://localhost:3000/login`, and sign in with the owner credentials from Task 6 Step 7.
Expected: redirects to `/dashboard`. A wrong password shows "Invalid email or password." Five wrong passwords shows the lockout message.

- [ ] **Step 10: Commit**

```bash
git add src/lib/auth/lockout.ts src/lib/auth/lockout.test.ts src/app/login src/app/logout
git commit -m "feat: add owner login and logout with lockout"
```

---

### Task 8: Company signup

**Files:**
- Create: `src/app/signup/page.tsx`, `src/app/signup/actions.ts`, `src/app/signup/SignupForm.tsx`

**Interfaces:**
- Consumes: `uniqueSlug`, `hashSecret`, `createSession`, `AuthFormState`.
- Produces: `signup(state: SignupFormState, formData: FormData)` where `SignupFormState = { errors?: Record<string, string>; error?: string } | undefined`.

- [ ] **Step 1: Implement `src/app/signup/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { uniqueSlug } from "@/lib/auth/slug";

export type SignupFormState =
  | { errors?: Record<string, string>; error?: string }
  | undefined;

const SignupSchema = z.object({
  name: z.string().min(1, "Enter your name").trim(),
  companyName: z.string().min(1, "Enter your company name").trim(),
  email: z.string().email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(8, "Use at least 8 characters"),
});

export async function signup(
  _state: SignupFormState,
  formData: FormData,
): Promise<SignupFormState> {
  const parsed = SignupSchema.safeParse({
    name: formData.get("name"),
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      errors[key] ??= issue.message;
    }
    return { errors };
  }

  const { name, companyName, email, password } = parsed.data;

  const taken = await prisma.user.findUnique({ where: { email } });
  if (taken) {
    return { errors: { email: "That email is already registered." } };
  }

  const slug = await uniqueSlug(companyName, async (candidate) => {
    return (await prisma.org.count({ where: { slug: candidate } })) > 0;
  });

  // The company and its owner are meaningless without each other, so they are
  // created together or not at all.
  const user = await prisma.$transaction(async (tx) => {
    const org = await tx.org.create({ data: { name: companyName, slug } });
    return tx.user.create({
      data: {
        orgId: org.id,
        role: "OWNER",
        name,
        email,
        passwordHash: await hashSecret(password),
      },
    });
  });

  await createSession(user.id, "OWNER");
  redirect("/dashboard");
}
```

- [ ] **Step 2: Implement `src/app/signup/SignupForm.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { signup } from "./actions";

const FIELD =
  "w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent";

export default function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Your name
        </label>
        <input id="name" name="name" required className={FIELD} />
        {state?.errors?.name && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {state.errors.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="companyName" className="mb-1 block text-sm font-medium">
          Company name
        </label>
        <input id="companyName" name="companyName" required className={FIELD} />
        {state?.errors?.companyName && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {state.errors.companyName}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={FIELD}
        />
        {state?.errors?.email && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {state.errors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className={FIELD}
        />
        {state?.errors?.password && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {state.errors.password}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Creating…" : "Create company"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Implement `src/app/signup/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import SignupForm from "./SignupForm";

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">Create your company</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        You can add logins for your crew once you are in.
      </p>

      <SignupForm />

      <p className="mt-6 text-sm text-black/60 dark:text-white/60">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Verify manually**

Run `npm run dev`, visit `/signup`, create a second company with a different email.
Expected: lands on `/dashboard`. Re-submitting the same email shows a field-level "already registered" error. Creating a company with the same name as an existing one succeeds, with a `-2` suffixed slug.

- [ ] **Step 5: Commit**

```bash
git add src/app/signup
git commit -m "feat: add company signup"
```

---

### Task 9: Crew login

**Files:**
- Create: `src/app/c/[slug]/page.tsx`, `src/app/c/[slug]/actions.ts`, `src/app/c/[slug]/CrewLoginForm.tsx`

**Interfaces:**
- Consumes: `verifySecret`, `createSession`, lockout helpers, `AuthFormState`.
- Produces: `crewLogin(state: AuthFormState, formData: FormData)`. The form posts a hidden `orgId` alongside `username` and `pin`.

Passing `orgId` from a hidden field is safe here specifically because it only *narrows* which account is looked up — the org is resolved from the public URL slug, and the credential still has to match. It is never used to grant scope.

- [ ] **Step 1: Implement `src/app/c/[slug]/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySecret } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { isLocked, lockoutMessage, nextLockoutState } from "@/lib/auth/lockout";
import type { AuthFormState } from "@/app/login/actions";

const GENERIC_ERROR = "Invalid username or PIN.";

const CrewLoginSchema = z.object({
  orgId: z.string().min(1),
  username: z.string().min(1).trim().toLowerCase(),
  pin: z.string().regex(/^\d{6}$/),
});

export async function crewLogin(
  _state: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = CrewLoginSchema.safeParse({
    orgId: formData.get("orgId"),
    username: formData.get("username"),
    pin: formData.get("pin"),
  });
  if (!parsed.success) return { error: GENERIC_ERROR };

  const user = await prisma.user.findUnique({
    where: {
      orgId_username: {
        orgId: parsed.data.orgId,
        username: parsed.data.username,
      },
    },
  });

  if (!user || user.role !== "CREW" || !user.pinHash || !user.active) {
    return { error: GENERIC_ERROR };
  }

  if (isLocked(user)) return { error: lockoutMessage(user.lockedUntil!) };

  if (!(await verifySecret(user.pinHash, parsed.data.pin))) {
    const next = nextLockoutState(user.failedAttempts);
    await prisma.user.update({ where: { id: user.id }, data: next });
    return next.lockedUntil
      ? { error: lockoutMessage(next.lockedUntil) }
      : { error: GENERIC_ERROR };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null },
  });
  await createSession(user.id, user.role);
  redirect(`/crew/${user.crewId}/today`);
}
```

- [ ] **Step 2: Implement `src/app/c/[slug]/CrewLoginForm.tsx`**

Inputs are deliberately large: this is used one-handed, outdoors, often with gloves on.

```tsx
"use client";

import { useActionState } from "react";
import { crewLogin } from "./actions";

const FIELD =
  "w-full rounded-lg border border-black/15 px-4 py-3 text-base dark:border-white/15 dark:bg-transparent";

export default function CrewLoginForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(crewLogin, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />

      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          required
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor="pin" className="mb-1 block text-sm font-medium">
          PIN
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          // Brings up the number pad instead of the full keyboard on a phone.
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoComplete="current-password"
          required
          className={`${FIELD} tracking-[0.5em]`}
        />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-black px-4 py-3 text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Implement `src/app/c/[slug]/page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/dal";
import CrewLoginForm from "./CrewLoginForm";

export default async function CrewLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const user = await getSessionUser();
  if (user) redirect("/");

  const org = await prisma.org.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!org) notFound();

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="mb-1 text-xl font-semibold">{org.name}</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        Sign in to see today&apos;s stops.
      </p>

      <CrewLoginForm orgId={org.id} />
    </div>
  );
}
```

- [ ] **Step 4: Verify manually**

Create a crew user by hand for testing:
```bash
npx tsx -e 'import"dotenv/config";import{PrismaClient}from"@prisma/client";import{PrismaPg}from"@prisma/adapter-pg";import{hashSecret}from"./src/lib/auth/password";const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});(async()=>{const c=await p.crew.findFirstOrThrow();await p.user.create({data:{orgId:c.orgId,role:"CREW",name:"Test Crew",username:"jose",pinHash:await hashSecret("481920"),crewId:c.id}});const o=await p.org.findUniqueOrThrow({where:{id:c.orgId}});console.log("visit /c/"+o.slug+" as jose / 481920")})().finally(()=>p.$disconnect())'
```
Then visit the printed URL and sign in.
Expected: lands on that crew's day view. A wrong PIN shows "Invalid username or PIN." An unknown slug 404s.

- [ ] **Step 5: Commit**

```bash
git add src/app/c
git commit -m "feat: add crew username and PIN login"
```

---

### Task 10: Scope the data layer

**Files:**
- Modify: `src/lib/data.ts`

**Interfaces:**
- Consumes: `requireOwner`, `verifySession` from `@/lib/auth/dal`.
- Produces: the same seven exported function signatures, unchanged for callers.

The signatures do not change. That is the point: each function fetches its own scope, so a caller cannot omit it.

- [ ] **Step 1: Add the import**

At the top of `src/lib/data.ts`:

```ts
import { requireOwner, verifySession } from "./auth/dal";
```

- [ ] **Step 2: Scope the six owner-only functions**

Add `const { orgId } = await requireOwner();` as the first line of `getDaySummaries`, `getActiveCrews`, `getAllCrews`, `getJobsForDate`, `searchCustomers`, and `getCustomerWithJobs`, then add `orgId` to each `where` clause.

`getDaySummaries` keeps its early return, but it must come *after* the auth call so an unauthenticated caller is still rejected:

```ts
export async function getDaySummaries(
  days: Date[],
): Promise<Record<string, DaySummary>> {
  const { orgId } = await requireOwner();
  if (days.length === 0) return {};

  const jobs = await prisma.job.findMany({
    where: {
      orgId,
      scheduledDate: { gte: days[0], lte: days[days.length - 1] },
      status: { not: "SKIPPED" },
    },
    select: { scheduledDate: true, crew: { select: { color: true } } },
  });
  // ...unchanged below
}
```

`getCustomerWithJobs` changes from `findUnique` to `findFirst`, because a compound `where` of id plus orgId is not a unique lookup:

```ts
export async function getCustomerWithJobs(customerId: string) {
  const { orgId } = await requireOwner();
  return prisma.customer.findFirst({
    where: { id: customerId, orgId },
    include: {
      jobs: {
        include: { crew: true },
        orderBy: { scheduledDate: "desc" },
      },
    },
  });
}
```

A customer belonging to another company now returns `null`, which the page already renders as a 404 — indistinguishable from a customer that does not exist.

- [ ] **Step 3: Scope `getCrewTodayJobs` for both roles**

This is the one function both owners and crew reach.

```ts
export async function getCrewTodayJobs(crewId: string, dateISO: string) {
  const user = await verifySession();

  // A crew member may only open their own day. Returning an empty result
  // rather than throwing lets the page render its existing 404.
  if (user.role === "CREW" && user.crewId !== crewId) {
    return { crew: null, jobs: [] };
  }

  const date = parseISODate(dateISO);
  const [crew, jobs] = await Promise.all([
    prisma.crew.findFirst({ where: { id: crewId, orgId: user.orgId } }),
    prisma.job.findMany({
      where: {
        orgId: user.orgId,
        crewId,
        scheduledDate: date,
        status: { not: "SKIPPED" },
      },
      include: { customer: true },
      orderBy: { orderInDay: "asc" },
    }),
  ]);
  return { crew, jobs };
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/lib/data.ts`. Errors elsewhere are expected until Tasks 11–13 land.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data.ts
git commit -m "feat: scope all data access to the signed-in org"
```

---

### Task 11: Scope recurring job generation

**Files:**
- Modify: `src/lib/recurring.ts`, `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: changed signatures —
  - `ensureOccurrencesThrough(orgId: string, through: Date): Promise<number>`
  - `attachNextDates(orgId: string, jobs: JobWithRelations[]): Promise<JobWithNextDate[]>`
  - `generateNextOccurrence(job: Job)` — unchanged signature, but copies `job.orgId`
  - `normalizeColumns(orgId: string)` — internal

This file is the least obvious and most dangerous gap. `ensureOccurrencesThrough` currently scans **every job in the database** and writes new ones. Left unscoped, one company loading its dashboard would generate jobs and rewrite stop order for every other company.

- [ ] **Step 1: Add `orgId` to `ensureOccurrencesThrough`**

Change the signature to `(orgId: string, through: Date)` and add `orgId` to all three queries inside it — the orphan lookup, the series lookup, and each object pushed to `toCreate`:

```ts
export async function ensureOccurrencesThrough(
  orgId: string,
  through: Date,
): Promise<number> {
  const orphans = await prisma.job.findMany({
    where: { orgId, frequency: { in: AUTO_GENERATED_FREQUENCIES }, seriesId: null },
    select: { id: true },
  });
  // ...unchanged orphan repair loop

  const nextPosition = await normalizeColumns(orgId);

  const rows = await prisma.job.findMany({
    where: {
      orgId,
      frequency: { in: AUTO_GENERATED_FREQUENCIES },
      seriesId: { not: null },
    },
    orderBy: { scheduledDate: "asc" },
  });
  // ...unchanged grouping
```

And in the `toCreate.push({ ... })` call, add `orgId` alongside `customerId`:

```ts
        toCreate.push({
          orgId,
          customerId: template.customerId,
          // ...rest unchanged
        });
```

- [ ] **Step 2: Add `orgId` to `normalizeColumns`**

Change its signature to `normalizeColumns(orgId: string)` and add `orgId` to the `prisma.job.findMany` at line ~156. Without this, one company's dashboard render rewrites `orderInDay` on another company's board.

- [ ] **Step 3: Add `orgId` to `attachNextDates`**

Change the signature to `(orgId: string, jobs: JobWithRelations[])` and add `orgId` to the `prisma.job.findMany` at line ~201.

- [ ] **Step 4: Copy `orgId` in `generateNextOccurrence`**

The signature stays the same — it already receives the source job. Add `orgId: job.orgId` to the `prisma.job.create` data, and `orgId: job.orgId` to the `findFirst` where clause that checks for an existing occurrence.

- [ ] **Step 5: Update `src/app/dashboard/page.tsx`**

The page already awaits data functions. Get the org from the DAL and thread it through:

```tsx
import { requireOwner } from "@/lib/auth/dal";

// inside the component, before the existing calls:
const { orgId } = await requireOwner();

await ensureOccurrencesThrough(orgId, horizonDate(/* existing args */));
// ...
const jobsWithNextDate = await attachNextDates(orgId, jobs);
```

- [ ] **Step 6: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors in `src/lib/recurring.ts` or `src/app/dashboard/page.tsx`. Remaining errors in `dashboard/actions.ts` are fixed in Task 12.

- [ ] **Step 7: Commit**

```bash
git add src/lib/recurring.ts src/app/dashboard/page.tsx
git commit -m "fix: scope recurring job generation to a single org"
```

---

### Task 12: Scope the owner-only server actions

**Files:**
- Modify: `src/app/dashboard/actions.ts`, `src/app/customers/actions.ts`

**Interfaces:**
- Consumes: `requireOwner`.
- Produces: the same eleven exported action signatures, unchanged for callers.

Eleven of the twelve actions are owner-only. `updateJobStatus` is handled separately in Task 13 because the crew view calls it.

- [ ] **Step 1: Add the import to both files**

```ts
import { requireOwner } from "@/lib/auth/dal";
```

- [ ] **Step 2: Scope the two customer actions**

```ts
export async function createCustomer(input: {
  name: string;
  address: string;
  phone?: string;
  notes?: string;
}) {
  const { orgId } = await requireOwner();
  const customer = await prisma.customer.create({ data: { ...input, orgId } });
  revalidatePath("/customers");
  return customer;
}

export async function updateCustomer(
  id: string,
  input: { name: string; address: string; phone?: string; notes?: string },
) {
  const { orgId } = await requireOwner();
  // updateMany rather than update: it takes a non-unique where clause, so a
  // customer id from another company matches zero rows instead of updating it.
  await prisma.customer.updateMany({ where: { id, orgId }, data: input });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}
```

The `update` → `updateMany` swap is the pattern for every by-id mutation below. `update` requires a unique where clause and would ignore `orgId`.

- [ ] **Step 3: Scope `createJob`**

Add `const { orgId } = await requireOwner();` as the first line. Then:
- the nested `prisma.customer.create` gains `orgId`
- the `prisma.job.count` where clause gains `orgId`
- the `prisma.job.create` data gains `orgId`
- when `input.customerId` is supplied by the client, verify it belongs to this org before using it:

```ts
  if (customerId) {
    const owned = await prisma.customer.count({ where: { id: customerId, orgId } });
    if (owned === 0) throw new Error("A customer is required");
  }
```

Without that check an owner could attach another company's customer to their own job.

- [ ] **Step 4: Scope `createCrew`, `updateCrew`, `deleteCrew`**

```ts
export async function createCrew(input: { name: string; color: string }) {
  const { orgId } = await requireOwner();
  const crew = await prisma.crew.create({ data: { ...input, orgId } });
  revalidatePath("/dashboard");
  return crew;
}

export async function updateCrew(
  id: string,
  input: { name?: string; color?: string; active?: boolean },
) {
  const { orgId } = await requireOwner();
  await prisma.crew.updateMany({ where: { id, orgId }, data: input });
  revalidatePath("/dashboard");
  revalidatePath(`/crew/${id}/today`);
}

export async function deleteCrew(id: string) {
  const { orgId } = await requireOwner();
  const jobCount = await prisma.job.count({ where: { crewId: id, orgId } });
  if (jobCount > 0) {
    throw new Error(
      `Cannot delete crew: ${jobCount} job${jobCount === 1 ? "" : "s"} still assigned to it.`,
    );
  }

  await prisma.crew.deleteMany({ where: { id, orgId } });
  revalidatePath("/dashboard");
}
```

Note `updateCrew` no longer returns the crew, since `updateMany` returns a count. Check its callers in `ManageCrewsModal.tsx` and drop any use of the return value.

- [ ] **Step 5: Scope `updateJob` and `updateJobFrequency`**

Add `const { orgId } = await requireOwner();` first, add `orgId` to every `where` clause, convert by-id `update` calls to `updateMany`, and pass `orgId` to the `ensureOccurrencesThrough(orgId, horizonDate())` calls at lines ~71 and ~101.

Any `findUnique`/`findUniqueOrThrow` by job id becomes `findFirst({ where: { id, orgId } })` with an explicit null check that throws a generic `Error("Job not found")`.

- [ ] **Step 6: Scope `moveJobInColumn`**

```ts
export async function moveJobInColumn(input: {
  jobId: string;
  direction: "up" | "down";
}) {
  const { orgId } = await requireOwner();
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, orgId },
  });
  if (!job) throw new Error("Job not found");

  const column = await prisma.job.findMany({
    where: { orgId, scheduledDate: job.scheduledDate, crewId: job.crewId },
    orderBy: [{ orderInDay: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  // ...rest unchanged
}
```

- [ ] **Step 7: Scope `bulkRescheduleDay` and `deleteJob`**

```ts
export async function bulkRescheduleDay(input: {
  dateISO: string;
  newDateISO: string;
  jobIds: string[];
}) {
  const { orgId } = await requireOwner();
  const newDate = parseISODate(input.newDateISO);
  await prisma.job.updateMany({
    where: {
      orgId,
      id: { in: input.jobIds },
      status: { in: ["SCHEDULED", "RESCHEDULED"] },
    },
    data: { scheduledDate: newDate, status: "RESCHEDULED" },
  });
  revalidatePath("/dashboard");
  const crews = await prisma.job.findMany({
    where: { orgId, id: { in: input.jobIds } },
    select: { crewId: true },
    distinct: ["crewId"],
  });
  for (const c of crews) {
    if (c.crewId) revalidatePath(`/crew/${c.crewId}/today`);
  }
}

export async function deleteJob(jobId: string, dateISO: string, crewId: string) {
  const { orgId } = await requireOwner();
  await prisma.job.deleteMany({ where: { id: jobId, orgId } });
  revalidateAffected(dateISO, crewId);
}
```

- [ ] **Step 8: Verify it typechecks and the app runs**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

Then `npm run dev`, sign in as the owner, and exercise the dashboard: create a job, reorder stops, reschedule a day, delete a job.
Expected: everything behaves as before.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/actions.ts src/app/customers/actions.ts src/app/dashboard/ManageCrewsModal.tsx
git commit -m "feat: scope owner server actions to the signed-in org"
```

---

### Task 13: Dual-role job status and crew route gating

**Files:**
- Modify: `src/app/dashboard/actions.ts`, `src/app/crew/[crewId]/today/page.tsx`

**Interfaces:**
- Consumes: `verifySession`.
- Produces: `updateJobStatus(jobId, status)` — unchanged signature, now role-aware.

`updateJobStatus` is the only action the crew view calls (`StopCard.tsx`). It must accept both roles while still preventing a crew member from touching another crew's stops.

- [ ] **Step 1: Make `updateJobStatus` role-aware**

```ts
export async function updateJobStatus(
  jobId: string,
  status: "COMPLETED" | "SKIPPED",
) {
  const user = await verifySession();

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      orgId: user.orgId,
      // A crew member may only close out stops on their own board.
      ...(user.role === "CREW" ? { crewId: user.crewId } : {}),
    },
  });
  if (!job) throw new Error("Job not found");

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: { status },
  });

  await generateNextOccurrence(updated);

  revalidateAffected(toISODate(updated.scheduledDate), updated.crewId);
}
```

`prisma.job.update` by id is safe here because the preceding `findFirst` already proved this job belongs to the caller.

- [ ] **Step 2: Add the import**

Add `verifySession` to the existing `@/lib/auth/dal` import in `actions.ts`.

- [ ] **Step 3: Gate the crew day view**

`getCrewTodayJobs` (Task 10) already returns `{ crew: null }` for a crew member requesting someone else's board, and the page already calls `notFound()` when `crew` is falsy. So `src/app/crew/[crewId]/today/page.tsx` needs no logic change — but confirm the existing `if (!crew) notFound();` is still present and above the render.

- [ ] **Step 4: Verify manually**

Sign in as the crew user from Task 9. Mark a stop complete.
Expected: it completes. Then edit the URL to another crew's id.
Expected: 404, not that crew's stops.

Sign in as the owner and open the same crew URL.
Expected: it loads, because owners may view any crew in their org.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/actions.ts src/app/crew
git commit -m "feat: allow crew to close their own stops only"
```

---

### Task 14: Proxy redirects and root routing

**Files:**
- Create: `proxy.ts` (repository root, beside `next.config.ts`)
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `SESSION_COOKIE`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Read the proxy documentation first**

Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` and `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`. This replaces `middleware.ts` from earlier Next versions and runs on the Node.js runtime. Confirm the expected file location and export shape against those docs before writing — do not assume the `middleware.ts` conventions carry over.

- [ ] **Step 2: Implement `proxy.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
// Imported from cookie.ts, not session.ts, so this runs without pulling Prisma
// into a module that executes on every request.
import { SESSION_COOKIE } from "@/lib/auth/cookie";

// Only the sign-in surfaces are reachable signed out. Everything else is
// bounced to /login before it renders.
const PUBLIC_PREFIXES = ["/login", "/signup", "/c/"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Presence only. This runs on every request including prefetches, so it must
  // not query the database — the DAL is the real check, next to the data.
  if (!req.cookies.get(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
```

- [ ] **Step 3: Route the root by role**

`src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CREW" && user.crewId) {
    redirect(`/crew/${user.crewId}/today`);
  }
  redirect("/dashboard");
}
```

- [ ] **Step 4: Verify manually**

In a private window, visit `/dashboard`.
Expected: redirected to `/login` without the dashboard rendering.

Signed in as the owner, visit `/`.
Expected: `/dashboard`. Signed in as crew, visit `/`.
Expected: that crew's day view.

- [ ] **Step 5: Commit**

```bash
git add proxy.ts src/app/page.tsx
git commit -m "feat: redirect signed-out visitors and route root by role"
```

---

### Task 15: The nav auth panel

**Files:**
- Create: `src/components/UserMenu.tsx`
- Modify: `src/components/MainNav.tsx`, `src/app/layout.tsx`

**Interfaces:**
- Consumes: `getSessionUser`, `logout`.
- Produces: `MainNav` accepts `{ user }` where `user` is `{ name: string; role: Role; crewId: string | null } | null`.

The Next.js docs warn that awaiting session data at the top of a layout holds `{children}` behind it. So the session read lives in a nested Server Component wrapped in `<Suspense>`, not in `layout.tsx` directly.

- [ ] **Step 1: Create `src/components/UserMenu.tsx`**

```tsx
import { getSessionUser } from "@/lib/auth/dal";
import { logout } from "@/app/logout/actions";

/**
 * Read in its own component rather than in the layout so awaiting the session
 * does not hold the rest of the page behind it.
 */
export default async function UserMenu() {
  const user = await getSessionUser();
  if (!user) return null;

  return (
    <div className="ml-auto flex items-center gap-4">
      {user.role === "OWNER" && (
        <a
          href="/team"
          className="text-sm text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
        >
          Team
        </a>
      )}
      <span className="text-sm text-black/50 dark:text-white/50">
        {user.name}
      </span>
      <form action={logout}>
        <button
          type="submit"
          className="text-sm text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Make `MainNav` role-aware**

`MainNav` stays a client component. It gains an optional `role` prop and hides the owner links from crew, who cannot reach those routes anyway:

```tsx
export default function MainNav({
  role,
  children,
}: {
  role?: "OWNER" | "CREW" | null;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const links = role === "OWNER" ? LINKS : [];

  return (
    <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
      <span className="text-lg font-semibold">Mowify</span>

      {links.map(({ href, label }) => {
        // ...existing link rendering unchanged
      })}

      {children}
    </nav>
  );
}
```

- [ ] **Step 3: Wire it up in `src/app/layout.tsx`**

The role is needed to decide which links render, so read it in a small server component too:

```tsx
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/dal";
import MainNav from "@/components/MainNav";
import UserMenu from "@/components/UserMenu";

async function Nav() {
  const user = await getSessionUser();
  return (
    <MainNav role={user?.role ?? null}>
      <UserMenu />
    </MainNav>
  );
}

// inside RootLayout's <header>:
<header className="border-b border-black/10 dark:border-white/10">
  <Suspense fallback={<div className="h-[49px]" />}>
    <Nav />
  </Suspense>
</header>
```

The fallback keeps a fixed height so the page does not shift when the nav resolves.

- [ ] **Step 4: Verify manually**

Signed in as the owner: nav shows Dashboard, Customers, Team, your name, Sign out.
Signed in as crew: nav shows only Mowify, the name, and Sign out.
Signed out on `/login`: no user menu.
Click Sign out.
Expected: returns to `/login`, and the back button does not restore the dashboard.

- [ ] **Step 5: Commit**

```bash
git add src/components/UserMenu.tsx src/components/MainNav.tsx src/app/layout.tsx
git commit -m "feat: add signed-in user panel to the nav"
```

---

### Task 16: Crew login management

**Files:**
- Create: `src/app/team/page.tsx`, `src/app/team/actions.ts`, `src/app/team/TeamClient.tsx`

**Interfaces:**
- Consumes: `requireOwner`, `hashSecret`, `deleteAllSessionsForUser`, `getActiveCrews`.
- Produces: `createCrewLogin`, `resetCrewPin`, `setCrewLoginActive` — all owner-only.

- [ ] **Step 1: Implement `src/app/team/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { hashSecret } from "@/lib/auth/password";
import { deleteAllSessionsForUser } from "@/lib/auth/session";

const PIN = z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits");

const CreateSchema = z.object({
  name: z.string().min(1, "Enter a name").trim(),
  username: z
    .string()
    .min(2, "Username must be at least 2 characters")
    .regex(/^[a-z0-9._-]+$/, "Use letters, numbers, dots, dashes only")
    .trim()
    .toLowerCase(),
  pin: PIN,
  crewId: z.string().min(1, "Pick a crew"),
});

export async function createCrewLogin(input: {
  name: string;
  username: string;
  pin: string;
  crewId: string;
}) {
  const { orgId } = await requireOwner();
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  // The crew must belong to this company, or an owner could attach their crew
  // member to another company's crew.
  const crew = await prisma.crew.count({
    where: { id: parsed.data.crewId, orgId },
  });
  if (crew === 0) throw new Error("Pick a crew");

  const taken = await prisma.user.count({
    where: { orgId, username: parsed.data.username },
  });
  if (taken > 0) throw new Error("That username is already in use.");

  await prisma.user.create({
    data: {
      orgId,
      role: "CREW",
      name: parsed.data.name,
      username: parsed.data.username,
      pinHash: await hashSecret(parsed.data.pin),
      crewId: parsed.data.crewId,
    },
  });

  revalidatePath("/team");
}

export async function resetCrewPin(userId: string, pin: string) {
  const { orgId } = await requireOwner();
  const parsed = PIN.safeParse(pin);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const user = await prisma.user.findFirst({
    where: { id: userId, orgId, role: "CREW" },
  });
  if (!user) throw new Error("Crew member not found");

  // Resetting the PIN also clears any lockout, which is how a crew member who
  // locked themselves out gets back in.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      pinHash: await hashSecret(pin),
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  await deleteAllSessionsForUser(user.id);
  revalidatePath("/team");
}

export async function setCrewLoginActive(userId: string, active: boolean) {
  const { orgId } = await requireOwner();
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId, role: "CREW" },
  });
  if (!user) throw new Error("Crew member not found");

  await prisma.user.update({ where: { id: user.id }, data: { active } });

  // Drop their sessions so a deactivated login stops working immediately
  // rather than whenever the cookie happens to expire.
  if (!active) await deleteAllSessionsForUser(user.id);
  revalidatePath("/team");
}
```

- [ ] **Step 2: Implement `src/app/team/page.tsx`**

```tsx
import { requireOwner } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { getActiveCrews } from "@/lib/data";
import TeamClient from "./TeamClient";

export default async function TeamPage() {
  const { orgId } = await requireOwner();

  const [org, members, crews] = await Promise.all([
    prisma.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { slug: true },
    }),
    prisma.user.findMany({
      where: { orgId, role: "CREW" },
      select: {
        id: true,
        name: true,
        username: true,
        active: true,
        lockedUntil: true,
        crew: { select: { id: true, name: true, color: true } },
      },
      orderBy: { name: "asc" },
    }),
    getActiveCrews(),
  ]);

  return (
    <TeamClient
      members={members}
      crews={crews}
      crewLoginPath={`/c/${org.slug}`}
    />
  );
}
```

- [ ] **Step 3: Implement `src/app/team/TeamClient.tsx`**

Styling follows `src/app/customers/CustomersClient.tsx` — same border, radius, and button classes.

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Crew } from "@prisma/client";
import {
  createCrewLogin,
  resetCrewPin,
  setCrewLoginActive,
} from "./actions";

type Member = {
  id: string;
  name: string;
  username: string | null;
  active: boolean;
  lockedUntil: Date | null;
  crew: { id: string; name: string; color: string } | null;
};

const FIELD =
  "w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent";

export default function TeamClient({
  members,
  crews,
  crewLoginPath,
}: {
  members: Member[];
  crews: Crew[];
  crewLoginPath: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");

  // Built in the browser so the link the owner copies is the one their crew
  // will actually open, whatever host the app is served from.
  const fullLink =
    typeof window === "undefined"
      ? crewLoginPath
      : `${window.location.origin}${crewLoginPath}`;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      await createCrewLogin({ name, username, pin, crewId });
      setName("");
      setUsername("");
      setPin("");
    });
  }

  async function handleResetPin(id: string) {
    const next = window.prompt("New 6-digit PIN:");
    if (!next) return;
    await run(() => resetCrewPin(id, next));
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold">Team</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        Logins for your crew. Each person sees only their own day.
      </p>

      <div className="mb-6 rounded-lg border border-black/10 p-4 dark:border-white/10">
        <p className="mb-2 text-sm font-medium">Crew sign-in link</p>
        <p className="mb-3 text-sm text-black/60 dark:text-white/60">
          Text this to your crew once. They bookmark it and sign in with their
          username and PIN.
        </p>
        <div className="flex gap-2">
          <input readOnly value={fullLink} className={`${FIELD} font-mono`} />
          <button
            onClick={() => {
              navigator.clipboard.writeText(fullLink);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="shrink-0 rounded-md bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <div className="mb-6 divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
        {members.length === 0 && (
          <p className="p-4 text-sm text-black/50 dark:text-white/50">
            No crew logins yet.
          </p>
        )}
        {members.map((m) => {
          const locked =
            m.lockedUntil !== null &&
            new Date(m.lockedUntil).getTime() > Date.now();
          return (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {m.name}
                  {!m.active && (
                    <span className="ml-2 text-xs text-black/40 dark:text-white/40">
                      deactivated
                    </span>
                  )}
                  {locked && (
                    <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                      locked out
                    </span>
                  )}
                </p>
                <p className="text-sm text-black/60 dark:text-white/60">
                  <span className="font-mono">{m.username}</span>
                  {m.crew && (
                    <>
                      {" · "}
                      <span
                        className="inline-block h-2 w-2 rounded-full align-middle"
                        style={{ backgroundColor: m.crew.color }}
                      />{" "}
                      {m.crew.name}
                    </>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 gap-3 text-sm">
                <button
                  disabled={busy}
                  onClick={() => handleResetPin(m.id)}
                  className="text-black/70 hover:text-black disabled:opacity-50 dark:text-white/70 dark:hover:text-white"
                >
                  Reset PIN
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(() => setCrewLoginActive(m.id, !m.active))}
                  className="text-black/70 hover:text-black disabled:opacity-50 dark:text-white/70 dark:hover:text-white"
                >
                  {m.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={handleAdd}
        className="rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <p className="mb-3 text-sm font-medium">Add a crew login</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={FIELD}
          />
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            required
            className={FIELD}
          />
          <input
            placeholder="6-digit PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            className={FIELD}
          />
          <select
            value={crewId}
            onChange={(e) => setCrewId(e.target.value)}
            required
            className={FIELD}
          >
            {crews.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={busy || crews.length === 0}
          className="mt-3 rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Add crew login
        </button>

        {crews.length === 0 && (
          <p className="mt-2 text-sm text-black/50 dark:text-white/50">
            Create a crew on the dashboard first.
          </p>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Verify manually**

As the owner, visit `/team`. Add a crew login. Open the crew login link in a private window and sign in as that person. Back as the owner, reset their PIN.
Expected: the private-window session is signed out on its next navigation, and the new PIN works. Deactivate them.
Expected: they can no longer sign in.

- [ ] **Step 5: Commit**

```bash
git add src/app/team
git commit -m "feat: add crew login management page"
```

---

### Task 17: Cross-org isolation test suite

**Files:**
- Create: `src/lib/data.isolation.test.ts`

**Interfaces:**
- Consumes: every factory from `src/test/factories.ts`.
- Produces: nothing.

This is the suite that proves the feature works. Everything else is scaffolding around it.

Server actions and the DAL both depend on `cookies()`, which only exists inside a Next.js request. These tests therefore mock the session module rather than driving HTTP, verifying that the data layer scopes correctly when told who is asking.

- [ ] **Step 1: Write the isolation tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeOrg,
  makeOwner,
  makeCrew,
  makeCrewUser,
  makeCustomer,
  makeJob,
} from "@/test/factories";

const currentUser = vi.hoisted(() => ({
  value: null as null | {
    userId: string;
    orgId: string;
    role: "OWNER" | "CREW";
    crewId: string | null;
    name: string;
  },
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
  requireCrew: async () => {
    if (currentUser.value?.role !== "CREW") throw new Error("redirect: /login");
    return currentUser.value;
  },
}));

const {
  getJobsForDate,
  getActiveCrews,
  getAllCrews,
  searchCustomers,
  getCustomerWithJobs,
  getCrewTodayJobs,
  getDaySummaries,
} = await import("@/lib/data");

const DATE = "2026-08-03";

async function seedOrg(label: string) {
  const org = await makeOrg(`${label} Landscaping`);
  const owner = await makeOwner(org.id);
  const crew = await makeCrew(org.id, `${label} Crew`);
  const customer = await makeCustomer(org.id, `${label} Customer`);
  const job = await makeJob(org.id, crew.id, customer.id, DATE);
  const crewUser = await makeCrewUser(org.id, crew.id);
  return { org, owner, crew, customer, job, crewUser };
}

let a: Awaited<ReturnType<typeof seedOrg>>;
let b: Awaited<ReturnType<typeof seedOrg>>;

beforeEach(async () => {
  a = await seedOrg("Alpha");
  b = await seedOrg("Beta");
  currentUser.value = {
    userId: a.owner.id,
    orgId: a.org.id,
    role: "OWNER",
    crewId: null,
    name: "Alpha Owner",
  };
});

describe("cross-org isolation", () => {
  it("getJobsForDate returns only this org's jobs", async () => {
    const jobs = await getJobsForDate(DATE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(a.job.id);
  });

  it("getActiveCrews returns only this org's crews", async () => {
    const crews = await getActiveCrews();
    expect(crews.map((c) => c.id)).toEqual([a.crew.id]);
  });

  it("getAllCrews returns only this org's crews", async () => {
    const crews = await getAllCrews();
    expect(crews.map((c) => c.id)).toEqual([a.crew.id]);
  });

  it("searchCustomers never returns another org's customers", async () => {
    const all = await searchCustomers("");
    expect(all.map((c) => c.id)).toEqual([a.customer.id]);

    // Searching by the other org's exact customer name must still find nothing.
    const targeted = await searchCustomers("Beta Customer");
    expect(targeted).toHaveLength(0);
  });

  it("getCustomerWithJobs returns null for another org's customer id", async () => {
    // A valid id from org B, passed directly. This is the forged-id case.
    expect(await getCustomerWithJobs(b.customer.id)).toBeNull();
    expect(await getCustomerWithJobs(a.customer.id)).not.toBeNull();
  });

  it("getDaySummaries counts only this org's jobs", async () => {
    const summaries = await getDaySummaries([new Date(Date.UTC(2026, 7, 3))]);
    expect(summaries[DATE]?.count).toBe(1);
  });

  it("getCrewTodayJobs returns no crew for another org's crew id", async () => {
    const { crew, jobs } = await getCrewTodayJobs(b.crew.id, DATE);
    expect(crew).toBeNull();
    expect(jobs).toHaveLength(0);
  });

  it("getCrewTodayJobs works for this org's own crew", async () => {
    const { crew, jobs } = await getCrewTodayJobs(a.crew.id, DATE);
    expect(crew?.id).toBe(a.crew.id);
    expect(jobs).toHaveLength(1);
  });
});

describe("crew authorization", () => {
  beforeEach(() => {
    currentUser.value = {
      userId: a.crewUser.id,
      orgId: a.org.id,
      role: "CREW",
      crewId: a.crew.id,
      name: "Alpha Crew",
    };
  });

  it("a crew member can load their own day", async () => {
    const { crew } = await getCrewTodayJobs(a.crew.id, DATE);
    expect(crew?.id).toBe(a.crew.id);
  });

  it("a crew member cannot load another crew's day in their own org", async () => {
    const other = await makeCrew(a.org.id, "Alpha Second Crew");
    const { crew, jobs } = await getCrewTodayJobs(other.id, DATE);
    expect(crew).toBeNull();
    expect(jobs).toHaveLength(0);
  });

  it("a crew member cannot reach owner-only data", async () => {
    await expect(getJobsForDate(DATE)).rejects.toThrow();
    await expect(searchCustomers("")).rejects.toThrow();
  });
});

describe("signed out", () => {
  beforeEach(() => {
    currentUser.value = null;
  });

  it("rejects every owner data function", async () => {
    await expect(getJobsForDate(DATE)).rejects.toThrow();
    await expect(getActiveCrews()).rejects.toThrow();
    await expect(searchCustomers("")).rejects.toThrow();
    await expect(getCustomerWithJobs(a.customer.id)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: all tests pass — this file plus the password, session, slug, and lockout suites from earlier tasks.

If the isolation tests fail, the fix belongs in `src/lib/data.ts`, not in the test. A failure here means real data is leaking between companies.

- [ ] **Step 3: Run the full check**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all four clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/data.isolation.test.ts
git commit -m "test: prove data cannot leak between orgs"
```

---

## Post-implementation verification

Before considering this done, confirm each by running it — not by reading the code:

- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm test` — all suites pass
- [ ] `npm run build` succeeds
- [ ] Signed out, `/dashboard` and `/customers` both redirect to `/login`
- [ ] Signed out, a crew day-view URL redirects to `/login`
- [ ] Owner A cannot see Owner B's crews, customers, or jobs anywhere in the UI
- [ ] A crew member sees only their own day view and cannot reach `/dashboard`
- [ ] A crew member marking a stop complete still generates the next recurring visit
- [ ] Deactivating a crew login signs that person out on their next navigation
- [ ] Five wrong PINs locks the account; an owner PIN reset clears the lock
- [ ] Loading one company's dashboard does not create jobs for another company
      (check `prisma.job.count()` per org before and after)

## Known follow-ups

Out of scope per the spec, both because no email provider is configured:

- **Owner password reset.** Until this exists, a forgotten owner password is a manual database fix.
- **Email verification on signup.**

Adding Resend and building both is the recommended next piece of work.
