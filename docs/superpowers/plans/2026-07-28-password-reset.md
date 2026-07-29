# Password Reset and Email Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner recover a forgotten password by email, change a password they know, and verify their email address.

**Architecture:** One `Token` model tagged with a `purpose`, storing only a SHA-256 of the emailed value — the same pattern as `Session`. A thin Resend wrapper that never throws, so an email outage cannot fail a user-facing operation. Four new public routes plus one owner route.

**Tech Stack:** Next.js 16.2.12 (App Router), React 19.2.4, Prisma 7.9 with `@prisma/adapter-pg`, PostgreSQL, Tailwind v4, TypeScript, Vitest, Zod, argon2. Adding: `resend`.

**Spec:** `docs/superpowers/specs/2026-07-28-password-reset-design.md`

## Global Constraints

- **Every commit must be green:** `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`. The suite is at **62 passing** at the start of this plan. Running only `npm test` is insufficient — Vitest transpiles without typechecking.
- **Zod: `.trim()` before `.min()`.** The reverse order lets whitespace-only input pass and store as empty. This bug has already been paid for twice in this codebase.
- **Any object reaching Prisma's `data` goes through a `.strict()` zod allowlist.** A Server Action parameter's TypeScript type is erased at runtime and enforces nothing. Spreading raw client input allowed a cross-tenant write once already.
- **Import hashing from `@/lib/auth/password`, never `@/lib/auth/hash`.** An ESLint rule enforces this; `hash.ts` is only for `prisma/**` and `src/test/**`.
- **Never reveal whether an email address is registered** — not in message, status, or timing. Do the same work on a miss as on a hit.
- **Raw tokens are never stored, logged, or returned by an action.** Only the SHA-256 goes in the database.
- **Reset token lifetime 1 hour; verification token lifetime 7 days.** Constants in the token module, never magic numbers at call sites.
- **`orgId` never comes from client input.**
- Comment style explains *why*, not *what*, in full sentences.
- This is Next.js 16: `middleware.ts` is `proxy.ts` (at `src/proxy.ts`), and route `params` are async.
- **Database safety:** `DATABASE_URL` points at live production data. Never write to it. `TEST_DATABASE_URL` is a disposable test database. Never run `npm run db:seed`.

---

## File Structure

**New:**

| File | Responsibility |
|---|---|
| `src/lib/auth/token.ts` | Issue, verify and consume purpose-tagged tokens |
| `src/lib/auth/token.test.ts` | Token lifecycle and cross-purpose tests |
| `src/lib/email/client.ts` | Resend wrapper that never throws |
| `src/lib/email/templates.ts` | The two email messages |
| `src/app/forgot-password/` | `page.tsx`, `actions.ts`, `ForgotPasswordForm.tsx` |
| `src/app/reset-password/[token]/` | `page.tsx`, `actions.ts`, `ResetPasswordForm.tsx` |
| `src/app/verify-email/[token]/page.tsx` | Consumes a verification token |
| `src/app/account/` | `page.tsx`, `actions.ts`, `AccountClient.tsx` |
| `src/components/VerifyBanner.tsx` | Reminder for unverified owners |
| `src/app/auth-flows.test.ts` | Security-property suite |

**Modified:** `prisma/schema.prisma`, `src/lib/auth/session.ts`, `src/app/signup/actions.ts`, `src/app/layout.tsx`, `src/components/UserMenu.tsx`, `src/proxy.ts`, `src/app/login/page.tsx`, `.env.example`, `package.json`.

---

### Task 1: Token schema

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `TokenPurpose` enum, `Token` model, `User.emailVerifiedAt`, `User.tokens`.

- [ ] **Step 1: Add the enum and model**

```prisma
enum TokenPurpose {
  PASSWORD_RESET
  EMAIL_VERIFICATION
}

model Token {
  id String @id @default(cuid())
  // SHA-256 of the value that goes in the email link. The raw token is never
  // stored, so a database leak yields nothing usable.
  tokenHash  String       @unique
  purpose    TokenPurpose
  userId     String
  user       User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt  DateTime
  // Set on redemption and never cleared. Single use is the security model: an
  // emailed link may be forwarded, archived, or sit in a mailbox for months.
  consumedAt DateTime?
  createdAt  DateTime     @default(now())

  @@index([userId, purpose])
}
```

- [ ] **Step 2: Extend `User`**

Add inside `model User`:

```prisma
  emailVerifiedAt DateTime?
  tokens          Token[]
```

- [ ] **Step 3: Push to both databases**

Run: `npm run db:push && npm run db:push:test && npx prisma generate`
Expected: both succeed. Every added field is nullable or new, so no existing row is rejected. **If either warns about dropping or truncating data, stop** — do not pass `--accept-data-loss`.

- [ ] **Step 4: Verify green**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all clean, 62 tests passing.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add Token model and emailVerifiedAt"
```

---

### Task 2: Token module

**Files:**
- Create: `src/lib/auth/token.ts`, `src/lib/auth/token.test.ts`

**Interfaces:**
- Consumes: `hashToken` from `./session`.
- Produces:
  - `RESET_TOKEN_MS = 60 * 60 * 1000`
  - `VERIFICATION_TOKEN_MS = 7 * 24 * 60 * 60 * 1000`
  - `RESET_COOLDOWN_MS = 60 * 1000`
  - `tokenLifetime(purpose: TokenPurpose): number`
  - `issueToken(userId: string, purpose: TokenPurpose): Promise<string>` — returns the RAW token, the only time it exists outside the email
  - `consumeToken(raw: string, purpose: TokenPurpose): Promise<{ userId: string } | null>`
  - `isWithinCooldown(userId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

`src/lib/auth/token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner } from "@/test/factories";
import {
  issueToken,
  consumeToken,
  isWithinCooldown,
  tokenLifetime,
  RESET_TOKEN_MS,
  VERIFICATION_TOKEN_MS,
} from "./token";

async function owner() {
  const org = await makeOrg();
  return makeOwner(org.id);
}

describe("tokenLifetime", () => {
  it("gives a reset token one hour and a verification token seven days", () => {
    // A reset token is a live credential sitting in an inbox; a verification
    // token proves nothing dangerous, so it can be generous.
    expect(tokenLifetime("PASSWORD_RESET")).toBe(RESET_TOKEN_MS);
    expect(tokenLifetime("EMAIL_VERIFICATION")).toBe(VERIFICATION_TOKEN_MS);
    expect(RESET_TOKEN_MS).toBeLessThan(VERIFICATION_TOKEN_MS);
  });
});

describe("issueToken", () => {
  it("returns a raw token that is not what gets stored", async () => {
    const user = await owner();
    const raw = await issueToken(user.id, "PASSWORD_RESET");
    const row = await prisma.token.findFirstOrThrow({ where: { userId: user.id } });
    expect(raw.length).toBeGreaterThan(20);
    expect(row.tokenHash).not.toBe(raw);
    expect(row.tokenHash).not.toContain(raw);
  });

  it("supersedes prior unconsumed tokens of the same purpose", async () => {
    const user = await owner();
    const first = await issueToken(user.id, "PASSWORD_RESET");
    await issueToken(user.id, "PASSWORD_RESET");
    // The older emailed link must stop working the moment a new one is sent.
    expect(await consumeToken(first, "PASSWORD_RESET")).toBeNull();
  });

  it("does not supersede tokens of a different purpose", async () => {
    const user = await owner();
    const verify = await issueToken(user.id, "EMAIL_VERIFICATION");
    await issueToken(user.id, "PASSWORD_RESET");
    expect(await consumeToken(verify, "EMAIL_VERIFICATION")).not.toBeNull();
  });
});

describe("consumeToken", () => {
  it("returns the user for a valid token", async () => {
    const user = await owner();
    const raw = await issueToken(user.id, "PASSWORD_RESET");
    expect(await consumeToken(raw, "PASSWORD_RESET")).toEqual({ userId: user.id });
  });

  it("rejects a token on its second use", async () => {
    // Single use is the entire security model: an emailed link can be
    // forwarded or sit in a mailbox indefinitely.
    const user = await owner();
    const raw = await issueToken(user.id, "PASSWORD_RESET");
    await consumeToken(raw, "PASSWORD_RESET");
    expect(await consumeToken(raw, "PASSWORD_RESET")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const user = await owner();
    const raw = await issueToken(user.id, "PASSWORD_RESET");
    await prisma.token.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await consumeToken(raw, "PASSWORD_RESET")).toBeNull();
  });

  it("rejects a token used for the wrong purpose", async () => {
    // If purpose were dropped from the lookup, a 7-day verification token
    // would silently become a password-reset token.
    const user = await owner();
    const verify = await issueToken(user.id, "EMAIL_VERIFICATION");
    expect(await consumeToken(verify, "PASSWORD_RESET")).toBeNull();

    const reset = await issueToken(user.id, "PASSWORD_RESET");
    expect(await consumeToken(reset, "EMAIL_VERIFICATION")).toBeNull();
  });

  it("rejects a garbage token without throwing", async () => {
    expect(await consumeToken("not-a-real-token", "PASSWORD_RESET")).toBeNull();
  });

  it("lets only one of many simultaneous redemptions succeed", async () => {
    const user = await owner();
    const raw = await issueToken(user.id, "PASSWORD_RESET");

    // The claim step re-filters on consumedAt inside the update, which is what
    // makes redemption atomic. Sequential reuse is caught by the initial
    // lookup, so only a concurrent race reaches this guard — without it, every
    // one of these calls would succeed and a forwarded link could be redeemed
    // repeatedly.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeToken(raw, "PASSWORD_RESET")),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(19);
  });
});

describe("isWithinCooldown", () => {
  it("is false when no token was ever issued", async () => {
    const user = await owner();
    expect(await isWithinCooldown(user.id)).toBe(false);
  });

  it("is true immediately after issuing", async () => {
    const user = await owner();
    await issueToken(user.id, "PASSWORD_RESET");
    expect(await isWithinCooldown(user.id)).toBe(true);
  });

  it("is false once the cooldown has passed", async () => {
    const user = await owner();
    await issueToken(user.id, "PASSWORD_RESET");
    await prisma.token.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    expect(await isWithinCooldown(user.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/auth/token.test.ts`
Expected: FAIL — cannot resolve `./token`.

- [ ] **Step 3: Implement `src/lib/auth/token.ts`**

```ts
import "server-only";
import { randomBytes } from "crypto";
import type { TokenPurpose } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashToken } from "./session";

export const RESET_TOKEN_MS = 60 * 60 * 1000;
export const VERIFICATION_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_COOLDOWN_MS = 60 * 1000;

export function tokenLifetime(purpose: TokenPurpose): number {
  return purpose === "PASSWORD_RESET" ? RESET_TOKEN_MS : VERIFICATION_TOKEN_MS;
}

/**
 * Issues a token and returns the RAW value — the only moment it exists outside
 * the email. Only its hash is stored, so a database leak yields nothing usable.
 *
 * Prior unconsumed tokens of the same purpose are marked consumed rather than
 * deleted, so the older emailed link stops working while its createdAt still
 * survives for the cooldown check.
 */
export async function issueToken(
  userId: string,
  purpose: TokenPurpose,
): Promise<string> {
  await prisma.token.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const raw = randomBytes(32).toString("base64url");
  await prisma.token.create({
    data: {
      tokenHash: hashToken(raw),
      purpose,
      userId,
      expiresAt: new Date(Date.now() + tokenLifetime(purpose)),
    },
  });
  return raw;
}

/**
 * Redeems a token, or returns null if it is unknown, expired, already used, or
 * issued for a different purpose.
 *
 * The purpose is part of the lookup, not an afterthought: without it a
 * seven-day verification token would work as a password-reset token.
 */
export async function consumeToken(
  raw: string,
  purpose: TokenPurpose,
): Promise<{ userId: string } | null> {
  const token = await prisma.token.findFirst({
    where: {
      tokenHash: hashToken(raw),
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!token) return null;

  // Stamping by id with consumedAt still null makes redemption atomic: two
  // simultaneous clicks on the same link cannot both succeed.
  const claimed = await prisma.token.updateMany({
    where: { id: token.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  return { userId: token.userId };
}

/**
 * Anyone can POST the reset form repeatedly, so without this it is an
 * email-bomb aimed at someone else's inbox.
 */
export async function isWithinCooldown(userId: string): Promise<boolean> {
  const recent = await prisma.token.findFirst({
    where: {
      userId,
      purpose: "PASSWORD_RESET",
      createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) },
    },
  });
  return recent !== null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/auth/token.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Verify green and commit**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean, 74 tests passing.

```bash
git add src/lib/auth/token.ts src/lib/auth/token.test.ts
git commit -m "feat: add purpose-tagged single-use tokens"
```

---

### Task 3: Email module

**Files:**
- Create: `src/lib/email/client.ts`, `src/lib/email/templates.ts`
- Modify: `package.json`, `.env.example`, `eslint.config.mjs`

**Interfaces:**
- Produces:
  - `sendEmail(input: { to: string; subject: string; html: string }): Promise<boolean>` — never throws; returns whether it sent
  - `appUrl(path: string): string`
  - `resetPasswordEmail(link: string): { subject: string; html: string }`
  - `verifyEmailEmail(link: string): { subject: string; html: string }`

- [ ] **Step 1: Install Resend**

```bash
npm install resend
```

- [ ] **Step 2: Document the new environment variables in `.env.example`**

Append:

```bash
# Resend API key. Password reset and verification emails silently do not send
# without it, which is why sendEmail logs loudly when it is missing.
RESEND_API_KEY=""

# Must be an address on a domain verified in Resend. Until a domain is
# verified, Resend only delivers to the account holder's own address.
EMAIL_FROM="Mowify <noreply@example.com>"

# Absolute origin used to build links in emails. An email has no request
# context, so this cannot be derived — setting it wrong sends people to
# localhost.
APP_URL="http://localhost:3000"
```

- [ ] **Step 3: Implement `src/lib/email/client.ts`**

```ts
import "server-only";
import { Resend } from "resend";

/**
 * Builds an absolute URL for an email link. Emails have no request context, so
 * the origin has to come from configuration rather than headers.
 */
export function appUrl(path: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/**
 * Sends an email and reports whether it worked.
 *
 * Deliberately never throws. No user-facing operation — signing up, requesting
 * a reset — should fail because an email provider is having a bad day. Callers
 * decide what to do with a false.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.error(
      "Email not sent: RESEND_API_KEY or EMAIL_FROM is not configured.",
    );
    return false;
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
    if (error) {
      console.error("Email not sent:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Email not sent:", err);
    return false;
  }
}
```

- [ ] **Step 4: Implement `src/lib/email/templates.ts`**

No external images or scripts: a remote asset would leak a `Referer` header containing the token URL.

```ts
const WRAP = (body: string) =>
  `<div style="font-family:system-ui,sans-serif;max-width:480px;line-height:1.5">${body}</div>`;

const BUTTON = (href: string, label: string) =>
  `<p><a href="${href}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${label}</a></p>`;

export function resetPasswordEmail(link: string) {
  return {
    subject: "Reset your Mowify password",
    html: WRAP(
      `<p>Someone asked to reset the password for this Mowify account.</p>` +
        BUTTON(link, "Choose a new password") +
        `<p>This link works once and expires in an hour.</p>` +
        `<p>If this wasn't you, ignore this email — your password has not changed.</p>`,
    ),
  };
}

export function verifyEmailEmail(link: string) {
  return {
    subject: "Confirm your Mowify email",
    html: WRAP(
      `<p>Confirm this address so you can recover your account if you ever forget your password.</p>` +
        BUTTON(link, "Confirm my email") +
        `<p>This link expires in seven days.</p>`,
    ),
  };
}
```

- [ ] **Step 5: Restrict who may import the email client**

The email module is server-only. Add `@/lib/email/client` to the existing `no-restricted-imports` rule in `eslint.config.mjs`, alongside the `@/lib/auth/hash` entry, with an override permitting `src/app/**/actions.ts` and `src/test/**`. Read the existing rule first and match its shape.

- [ ] **Step 6: Verify green and commit**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean, 74 tests passing.

```bash
git add package.json package-lock.json .env.example eslint.config.mjs src/lib/email
git commit -m "feat: add Resend email client and templates"
```

---

### Task 4: Session helper for change-password

**Files:**
- Modify: `src/lib/auth/session.ts`
- Create: `src/lib/auth/session-others.test.ts`

**Interfaces:**
- Produces: `deleteOtherSessionsForUser(userId: string, keepRawToken: string): Promise<void>`

`deleteAllSessionsForUser` must keep deleting everything — the reset path and crew deactivation both depend on that. This is a sibling, not a replacement.

- [ ] **Step 1: Write the failing test**

`src/lib/auth/session-others.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner } from "@/test/factories";
import { hashToken, deleteOtherSessionsForUser } from "./session";

describe("deleteOtherSessionsForUser", () => {
  it("keeps the acting session and drops the rest", async () => {
    const org = await makeOrg();
    const user = await makeOwner(org.id);
    const keep = "keep-this-token";
    const drop = "drop-this-token";
    const expiresAt = new Date(Date.now() + 60_000);

    await prisma.session.createMany({
      data: [
        { tokenHash: hashToken(keep), userId: user.id, expiresAt },
        { tokenHash: hashToken(drop), userId: user.id, expiresAt },
      ],
    });

    await deleteOtherSessionsForUser(user.id, keep);

    const rows = await prisma.session.findMany({ where: { userId: user.id } });
    // Changing your password should sign you out everywhere except the tab
    // you are currently using.
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(keep));
  });

  it("leaves other users' sessions alone", async () => {
    const org = await makeOrg();
    const a = await makeOwner(org.id);
    const b = await makeOwner(org.id);
    const expiresAt = new Date(Date.now() + 60_000);

    await prisma.session.createMany({
      data: [
        { tokenHash: hashToken("a-1"), userId: a.id, expiresAt },
        { tokenHash: hashToken("b-1"), userId: b.id, expiresAt },
      ],
    });

    await deleteOtherSessionsForUser(a.id, "a-1");

    expect(await prisma.session.count({ where: { userId: b.id } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/auth/session-others.test.ts`
Expected: FAIL — `deleteOtherSessionsForUser` is not exported.

- [ ] **Step 3: Add the function to `src/lib/auth/session.ts`**

Append, leaving `deleteAllSessionsForUser` untouched:

```ts
/**
 * Signs a user out everywhere except the session performing the action.
 *
 * Used when changing a password: everywhere else should stop working, but the
 * tab doing the changing should not sign itself out mid-flow.
 */
export async function deleteOtherSessionsForUser(
  userId: string,
  keepRawToken: string,
): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId, tokenHash: { not: hashToken(keepRawToken) } },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/auth/session-others.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Verify green and commit**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean, 76 tests passing.

```bash
git add src/lib/auth/session.ts src/lib/auth/session-others.test.ts
git commit -m "feat: add deleteOtherSessionsForUser"
```

---

### Task 5: Requesting a reset

**Files:**
- Create: `src/app/forgot-password/page.tsx`, `actions.ts`, `ForgotPasswordForm.tsx`
- Modify: `src/proxy.ts`, `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `issueToken`, `isWithinCooldown`, `sendEmail`, `appUrl`, `resetPasswordEmail`, `verifySecret`, `AuthFormState`.
- Produces: `requestReset(state: AuthFormState, formData: FormData): Promise<AuthFormState>`.

- [ ] **Step 1: Add the new public paths to `src/proxy.ts`**

Without this, a logged-out person clicking a reset link is bounced straight to `/login` — the flow cannot work at all.

```ts
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/c/",
  "/forgot-password",
  "/reset-password/",
  "/verify-email/",
];
```

- [ ] **Step 2: Implement `src/app/forgot-password/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { issueToken, isWithinCooldown } from "@/lib/auth/token";
import { sendEmail, appUrl } from "@/lib/email/client";
import { resetPasswordEmail } from "@/lib/email/templates";
import type { AuthFormState } from "@/app/login/actions";

// Identical whether or not the account exists. Anything else turns this form
// into a way to discover which email addresses are registered.
const SENT = "If that email is registered, we've sent a reset link.";

const RequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export async function requestReset(
  _state: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = RequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: SENT };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (user && user.role === "OWNER" && user.active && user.email) {
    // Checked before superseding anything: the cooldown reads prior tokens'
    // createdAt, and issueToken marks them consumed.
    if (!(await isWithinCooldown(user.id))) {
      const raw = await issueToken(user.id, "PASSWORD_RESET");
      const { subject, html } = resetPasswordEmail(
        appUrl(`/reset-password/${raw}`),
      );
      // A send failure is logged inside sendEmail and deliberately ignored
      // here: reporting it would confirm the address exists.
      await sendEmail({ to: user.email, subject, html });
    }
  }

  return { error: SENT };
}
```

- [ ] **Step 3: Implement `src/app/forgot-password/ForgotPasswordForm.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { requestReset } from "./actions";

export default function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestReset, undefined);

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

      {state?.error && (
        <p role="status" className="text-sm text-black/70 dark:text-white/70">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Implement `src/app/forgot-password/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import ForgotPasswordForm from "./ForgotPasswordForm";

export default async function ForgotPasswordPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">Reset your password</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        We&apos;ll email you a link to choose a new one.
      </p>

      <ForgotPasswordForm />

      <p className="mt-6 text-sm text-black/60 dark:text-white/60">
        <Link href="/login" className="underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Link it from the login page**

In `src/app/login/page.tsx`, add below the form:

```tsx
      <p className="mt-4 text-sm text-black/60 dark:text-white/60">
        <Link href="/forgot-password" className="underline underline-offset-4">
          Forgot your password?
        </Link>
      </p>
```

- [ ] **Step 6: Verify green and commit**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean, 76 tests passing.

```bash
git add src/app/forgot-password src/proxy.ts src/app/login/page.tsx
git commit -m "feat: add forgot-password request flow"
```

---

### Task 6: Completing a reset

**Files:**
- Create: `src/app/reset-password/[token]/page.tsx`, `actions.ts`, `ResetPasswordForm.tsx`

**Interfaces:**
- Consumes: `consumeToken`, `hashSecret`, `deleteAllSessionsForUser`.
- Produces: `completeReset(state: ResetFormState, formData: FormData): Promise<ResetFormState>` where `ResetFormState = { error?: string } | undefined`.

- [ ] **Step 1: Implement `src/app/reset-password/[token]/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { consumeToken } from "@/lib/auth/token";
import { hashSecret } from "@/lib/auth/password";
import { deleteAllSessionsForUser } from "@/lib/auth/session";

export type ResetFormState = { error?: string } | undefined;

const EXPIRED = "That link is no longer valid. Request a new one.";

const ResetSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Use at least 8 characters"),
  })
  .strict();

export async function completeReset(
  _state: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const parsed = ResetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const claimed = await consumeToken(parsed.data.token, "PASSWORD_RESET");
  if (!claimed) return { error: EXPIRED };

  const passwordHash = await hashSecret(parsed.data.password);

  await prisma.user.update({
    where: { id: claimed.userId },
    // Clearing the lockout is part of recovery: someone who forgot their
    // password has usually locked themselves out guessing at it.
    data: { passwordHash, failedAttempts: 0, lockedUntil: null },
  });

  // If the reset happened because the account was compromised, leaving the
  // attacker's session alive would defeat the whole operation.
  await deleteAllSessionsForUser(claimed.userId);

  redirect("/login?reset=1");
}
```

- [ ] **Step 2: Implement `src/app/reset-password/[token]/ResetPasswordForm.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { completeReset } from "./actions";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(completeReset, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
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
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Implement `src/app/reset-password/[token]/page.tsx`**

Route `params` are async in this Next version.

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth/session";
import ResetPasswordForm from "./ResetPasswordForm";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Checked without consuming, so rendering the form does not burn the token.
  // Unknown, expired and already-used all render the same page, so this cannot
  // be used to probe which tokens are real.
  const valid = await prisma.token.findFirst({
    where: {
      tokenHash: hashToken(token),
      purpose: "PASSWORD_RESET",
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  if (!valid) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="mb-1 text-xl font-semibold">This link has expired</h1>
        <p className="mb-6 text-sm text-black/60 dark:text-white/60">
          Reset links work once and last an hour.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block rounded-lg bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-xl font-semibold">Choose a new password</h1>
      <ResetPasswordForm token={token} />
    </div>
  );
}
```

- [ ] **Step 4: Verify green and commit**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean, 76 tests passing.

```bash
git add src/app/reset-password
git commit -m "feat: add password reset completion"
```

---

### Task 7: Change password while signed in

**Files:**
- Create: `src/app/account/page.tsx`, `actions.ts`, `AccountClient.tsx`
- Modify: `src/components/UserMenu.tsx`

**Interfaces:**
- Consumes: `requireOwner`, `verifySecret`, `hashSecret`, `readSessionToken`, `deleteOtherSessionsForUser`.
- Produces: `changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>`, `resendVerification(): Promise<void>`.

- [ ] **Step 1: Implement `src/app/account/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { hashSecret, verifySecret } from "@/lib/auth/password";
import { readSessionToken, deleteOtherSessionsForUser } from "@/lib/auth/session";
import { issueToken } from "@/lib/auth/token";
import { sendEmail, appUrl } from "@/lib/email/client";
import { verifyEmailEmail } from "@/lib/email/templates";

const ChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "Use at least 8 characters"),
  })
  .strict();

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}) {
  const { userId } = await requireOwner();
  const parsed = ChangeSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash) throw new Error("Current password is incorrect");

  // Proving you know the current password matters: a stolen session should not
  // be enough to lock the real owner out of their own account.
  if (!(await verifySecret(user.passwordHash, parsed.data.currentPassword))) {
    throw new Error("Current password is incorrect");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashSecret(parsed.data.newPassword) },
  });

  // Sign out everywhere else, but not the tab doing the changing.
  const current = await readSessionToken();
  if (current) await deleteOtherSessionsForUser(userId, current);

  revalidatePath("/account");
}

export async function resendVerification() {
  const { userId } = await requireOwner();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.email || user.emailVerifiedAt) return;

  const raw = await issueToken(userId, "EMAIL_VERIFICATION");
  const { subject, html } = verifyEmailEmail(appUrl(`/verify-email/${raw}`));
  await sendEmail({ to: user.email, subject, html });
  revalidatePath("/account");
}
```

- [ ] **Step 2: Implement `src/app/account/AccountClient.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changePassword, resendVerification } from "./actions";

const FIELD =
  "w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent";

export default function AccountClient({
  email,
  verified,
}: {
  email: string;
  verified: boolean;
}) {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrent("");
      setNew("");
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold">Account</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">{email}</p>

      <div className="mb-6 rounded-lg border border-black/10 p-4 dark:border-white/10">
        <p className="mb-2 text-sm font-medium">Email</p>
        {verified ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            Confirmed.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-black/60 dark:text-white/60">
              Not confirmed yet. Confirming means you can recover this account
              if you ever forget your password.
            </p>
            <button
              disabled={busy || sent}
              onClick={async () => {
                setBusy(true);
                await resendVerification();
                setSent(true);
                setBusy(false);
              }}
              className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {sent ? "Sent" : "Send confirmation email"}
            </button>
          </>
        )}
      </div>

      <form
        onSubmit={submit}
        className="rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <p className="mb-3 text-sm font-medium">Change password</p>

        <div className="space-y-3">
          <input
            type="password"
            placeholder="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            required
            className={FIELD}
          />
          <input
            type="password"
            placeholder="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            required
            className={FIELD}
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="mt-3 text-sm text-black/60 dark:text-white/60">
            Password changed. Other devices have been signed out.
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-3 rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Change password
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/app/account/page.tsx`**

```tsx
import { requireOwner } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import AccountClient from "./AccountClient";

export default async function AccountPage() {
  const { userId } = await requireOwner();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true },
  });

  return (
    <AccountClient
      email={user.email ?? ""}
      verified={user.emailVerifiedAt !== null}
    />
  );
}
```

- [ ] **Step 4: Link it from the nav**

In `src/components/UserMenu.tsx`, add an `Account` link beside the existing owner-only `Team` link, matching its classes.

- [ ] **Step 5: Verify green and commit**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean, 76 tests passing.

```bash
git add src/app/account src/components/UserMenu.tsx
git commit -m "feat: add account page with change password"
```

---

### Task 8: Email verification

**Files:**
- Create: `src/app/verify-email/[token]/page.tsx`, `src/components/VerifyBanner.tsx`
- Modify: `src/app/signup/actions.ts`, `src/app/layout.tsx`

**Interfaces:**
- Consumes: `consumeToken`, `issueToken`, `sendEmail`, `appUrl`, `verifyEmailEmail`, `getSessionUser`.

- [ ] **Step 1: Send a verification email at signup**

In `src/app/signup/actions.ts`, after the successful `if (!user) { ... }` guard and **before** `createSession`, add:

```ts
  // Deliberately after the account exists and deliberately not awaited into a
  // failure path: a Resend outage must still produce a working account. The
  // owner can resend from /account.
  const rawVerify = await issueToken(user.id, "EMAIL_VERIFICATION");
  const verifyMail = verifyEmailEmail(appUrl(`/verify-email/${rawVerify}`));
  await sendEmail({ to: email, subject: verifyMail.subject, html: verifyMail.html });
```

with the matching imports. `sendEmail` never throws, so no try/catch is needed — but do not change that property without revisiting this.

- [ ] **Step 2: Implement `src/app/verify-email/[token]/page.tsx`**

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { consumeToken } from "@/lib/auth/token";

export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claimed = await consumeToken(token, "EMAIL_VERIFICATION");

  if (claimed) {
    await prisma.user.update({
      where: { id: claimed.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">
        {claimed ? "Email confirmed" : "This link has expired"}
      </h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        {claimed
          ? "You can now recover your account by email if you forget your password."
          : "Confirmation links work once and last seven days. Send a new one from your account page."}
      </p>
      <Link
        href={claimed ? "/dashboard" : "/account"}
        className="inline-block rounded-lg bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
      >
        {claimed ? "Go to dashboard" : "Go to account"}
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/components/VerifyBanner.tsx`**

```tsx
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/dal";

/**
 * Read in its own component, like UserMenu, so awaiting it does not hold the
 * rest of the page behind it.
 */
export default async function VerifyBanner() {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") return null;

  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { emailVerifiedAt: true },
  });
  if (!row || row.emailVerifiedAt) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm">
      Confirm your email so you can recover your account if you forget your
      password.{" "}
      <a href="/account" className="underline underline-offset-4">
        Confirm now
      </a>
    </div>
  );
}
```

- [ ] **Step 4: Render the banner in `src/app/layout.tsx`**

Inside the existing `<Suspense>`-wrapped shell, below `<Nav />` and above `{children}`, wrap it in its own `<Suspense fallback={null}>` so it never delays the nav.

- [ ] **Step 5: Verify green and commit**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean, 76 tests passing.

```bash
git add src/app/verify-email src/components/VerifyBanner.tsx src/app/signup/actions.ts src/app/layout.tsx
git commit -m "feat: add email verification with reminder banner"
```

---

### Task 9: Security-property suite

**Files:**
- Create: `src/app/auth-flows.test.ts`

**Interfaces:**
- Consumes: everything above, plus `src/test/factories.ts`.

These assert the properties the spec names, at the action level rather than the helper level. Follow the mocking pattern already established in `src/app/actions.isolation.test.ts` and `src/lib/data.isolation.test.ts` — read both first.

- [ ] **Step 1: Write the suite**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCrewUser } from "@/test/factories";
import { hashSecret, verifySecret } from "@/lib/auth/hash";
import { hashToken } from "@/lib/auth/session";

const currentUser = vi.hoisted(() => ({
  value: null as null | {
    userId: string;
    orgId: string;
    role: "OWNER" | "CREW";
    crewId: string | null;
    name: string;
  },
}));

// Captures what would have been emailed, so the link can be inspected without
// sending anything.
const sent = vi.hoisted(() => ({
  calls: [] as { to: string; subject: string; html: string }[],
}));

const currentToken = vi.hoisted(() => ({ value: null as string | null }));

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

vi.mock("@/lib/email/client", () => ({
  appUrl: (path: string) => `https://mowify.test${path}`,
  sendEmail: async (input: { to: string; subject: string; html: string }) => {
    sent.calls.push(input);
    return true;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect: ${to}`);
  },
}));

// readSessionToken needs a request context that does not exist under Vitest,
// so the acting session's raw token is supplied here instead.
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, readSessionToken: async () => currentToken.value };
});

const { requestReset } = await import("@/app/forgot-password/actions");
const { completeReset } = await import("@/app/reset-password/[token]/actions");
const { changePassword } = await import("@/app/account/actions");
const { issueToken, consumeToken } = await import("@/lib/auth/token");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function linkToken(html: string): string {
  const m = html.match(/https:\/\/mowify\.test\/[a-z-]+\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("no link found in email");
  return m[1];
}

async function seedOwner(password = "original-password") {
  const org = await makeOrg();
  const user = await makeOwner(org.id, undefined, password);
  return { org, user };
}

beforeEach(() => {
  sent.calls.length = 0;
  currentUser.value = null;
  currentToken.value = null;
});

describe("requesting a reset", () => {
  it("responds identically for an unknown email and creates no token", async () => {
    const { user } = await seedOwner();
    const known = await requestReset(undefined, form({ email: user.email! }));
    sent.calls.length = 0;

    const unknown = await requestReset(
      undefined,
      form({ email: "nobody@example.com" }),
    );

    // Identical wording is what stops this form being used to discover which
    // addresses are registered.
    expect(unknown).toEqual(known);
    expect(sent.calls).toHaveLength(0);
    expect(await prisma.token.count()).toBe(1); // only the known one
  });

  it("issues exactly one token and emails the owner", async () => {
    const { user } = await seedOwner();
    await requestReset(undefined, form({ email: user.email! }));

    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0].to).toBe(user.email);
    expect(sent.calls[0].html).toContain("https://mowify.test/reset-password/");

    const tokens = await prisma.token.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].purpose).toBe("PASSWORD_RESET");
  });

  it("sends nothing on a second request inside the cooldown", async () => {
    const { user } = await seedOwner();
    await requestReset(undefined, form({ email: user.email! }));
    const first = linkToken(sent.calls[0].html);
    sent.calls.length = 0;

    await requestReset(undefined, form({ email: user.email! }));

    expect(sent.calls).toHaveLength(0);
    // The first link must still work — the cooldown suppresses the email, it
    // does not invalidate what was already sent.
    expect(await consumeToken(first, "PASSWORD_RESET")).not.toBeNull();
  });

  it("does not issue a reset token for a crew member's account", async () => {
    const org = await makeOrg();
    const crew = await makeCrew(org.id);
    await makeCrewUser(org.id, crew.id);
    // Crew have no email and sign in with a PIN their owner sets, so this
    // flow is owner-only by construction.
    await requestReset(undefined, form({ email: "crew@example.com" }));
    expect(await prisma.token.count()).toBe(0);
    expect(sent.calls).toHaveLength(0);
  });
});

describe("completing a reset", () => {
  it("changes the password, clears the lockout and drops every session", async () => {
    const { user } = await seedOwner();
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 5, lockedUntil: new Date(Date.now() + 60_000) },
    });
    await prisma.session.create({
      data: {
        tokenHash: hashToken("live-session"),
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await requestReset(undefined, form({ email: user.email! }));
    const raw = linkToken(sent.calls[0].html);

    await expect(
      completeReset(undefined, form({ token: raw, password: "brand-new-password" })),
    ).rejects.toThrow("redirect: /login");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifySecret(after.passwordHash!, "brand-new-password")).toBe(true);
    expect(after.failedAttempts).toBe(0);
    expect(after.lockedUntil).toBeNull();
    // If the reset happened because the account was compromised, leaving the
    // attacker's session alive would defeat the whole operation.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("refuses to reuse the same link", async () => {
    const { user } = await seedOwner();
    await requestReset(undefined, form({ email: user.email! }));
    const raw = linkToken(sent.calls[0].html);

    await expect(
      completeReset(undefined, form({ token: raw, password: "first-new-password" })),
    ).rejects.toThrow("redirect: /login");

    const second = await completeReset(
      undefined,
      form({ token: raw, password: "second-new-password" }),
    );
    expect(second?.error).toBeTruthy();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifySecret(after.passwordHash!, "second-new-password")).toBe(false);
  });

  it("rejects a verification token used as a reset token", async () => {
    const { user } = await seedOwner();
    const verify = await issueToken(user.id, "EMAIL_VERIFICATION");

    const result = await completeReset(
      undefined,
      form({ token: verify, password: "should-not-apply" }),
    );

    expect(result?.error).toBeTruthy();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifySecret(after.passwordHash!, "should-not-apply")).toBe(false);
  });

  it("rejects a reset token used to verify an email", async () => {
    const { user } = await seedOwner();
    const reset = await issueToken(user.id, "PASSWORD_RESET");
    expect(await consumeToken(reset, "EMAIL_VERIFICATION")).toBeNull();
  });
});

describe("changing a password while signed in", () => {
  async function signedIn(password = "original-password") {
    const { org, user } = await seedOwner(password);
    currentUser.value = {
      userId: user.id,
      orgId: org.id,
      role: "OWNER",
      crewId: null,
      name: "Owner",
    };
    currentToken.value = "acting-session";
    await prisma.session.createMany({
      data: [
        {
          tokenHash: hashToken("acting-session"),
          userId: user.id,
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          tokenHash: hashToken("other-device"),
          userId: user.id,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    return user;
  }

  it("rejects a wrong current password and leaves the hash alone", async () => {
    const user = await signedIn();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    await expect(
      changePassword({
        currentPassword: "not-the-password",
        newPassword: "attacker-chosen",
      }),
    ).rejects.toThrow();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // A stolen session must not be enough to lock the real owner out.
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("changes the password and signs out other devices only", async () => {
    const user = await signedIn();

    await changePassword({
      currentPassword: "original-password",
      newPassword: "a-better-password",
    });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifySecret(after.passwordHash!, "a-better-password")).toBe(true);

    const rows = await prisma.session.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken("acting-session"));
  });
});
```

Note the factory call `makeOwner(org.id, undefined, password)` — check the
signature in `src/test/factories.ts` before writing, and adjust if it differs.
`hashSecret` is imported from `@/lib/auth/hash` because this is a test file,
which the ESLint restriction permits.

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: PASS. Report the new total.

- [ ] **Step 3: Prove the tests have teeth**

For at least the cross-purpose test (10) and the session-invalidation test (5), temporarily break the protection — remove `purpose` from `consumeToken`'s where clause, and remove the `deleteAllSessionsForUser` call — run the suite, and confirm your tests FAIL. Then restore with `git checkout --` and confirm green.

A test that passes against the broken code is worthless. Report which test caught which break.

- [ ] **Step 4: Verify green and commit**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`

```bash
git add src/app/auth-flows.test.ts
git commit -m "test: prove reset and verification security properties"
```

---

## Post-implementation verification

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` all clean
- [ ] Signed out, `/forgot-password`, `/reset-password/x` and `/verify-email/x` are all reachable (they are in `PUBLIC_PREFIXES`)
- [ ] Requesting a reset for an unregistered address looks identical to a registered one
- [ ] A reset link works once and is dead afterwards
- [ ] Completing a reset signs out every device
- [ ] Changing a password keeps the current tab signed in
- [ ] An unverified owner sees the banner; it disappears after verifying
- [ ] Live data unchanged: 3 crews, 5 customers, 105 jobs, 1 user

## Deployment notes

This feature does nothing without configuration. The environment running it needs:

- `RESEND_API_KEY`
- `EMAIL_FROM` — an address on a domain verified in Resend
- `APP_URL` — the absolute production origin
- `DATABASE_URL` — already required

Until a domain is verified in Resend, delivery is limited to the account
holder's own address. Emails to customers will silently fail, and `sendEmail`
logs rather than throws, so the failure is quiet by design.
