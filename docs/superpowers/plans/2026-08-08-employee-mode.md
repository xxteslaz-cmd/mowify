# Employee Mode (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a company say it assigns work to named people rather than crews, and have the whole product use their words.

**Architecture:** One additive enum column on `Org`. A `Crew` row stays the assignable unit in both modes, so the board, phone view, recurring generation and isolation tests keep a single code path. A terminology helper turns the mode into a noun pair that is passed down as props; no component branches on the mode inline.

**Tech Stack:** Next.js 16 App Router · React 19 · Prisma 7 with `@prisma/adapter-pg` · PostgreSQL · Tailwind v4 · Vitest · Zod · argon2.

**Spec:** `docs/superpowers/specs/2026-08-08-employee-mode-design.md`

## Global Constraints

- **Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.** This version differs from training data.
- **Every commit must pass all four:** `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`. `npm test` alone is insufficient — Vitest transpiles without typechecking.
- **Never run `npm run db:push`** — it targets `DATABASE_URL`, which is live production (`neondb`). Use `npm run db:push:test` only. Production's push happens at deploy time, by the owner.
- **Server Actions must return error state, never throw it.** Production React redacts thrown messages. `redirect()` is exempt.
- **Anything reaching Prisma's `data` needs a `.strict()` Zod allowlist.** A Server Action's TypeScript parameter type is erased at runtime.
- **Zod: `.trim()` before `.min()`.**
- **Client-supplied foreign keys need an ownership check** before use.
- **`err.meta.target` is `undefined` with `@prisma/adapter-pg`** — use `p2002Fields` from `src/lib/prisma-errors.ts`.
- **Do not hard-code colours.** `src/app/globals.css` owns the tokens and the `.btn`/`.card`/`.field` classes.
- **No component reads `assigneeMode` and branches inline.** Server components read it once and pass `AssigneeTerms` down as props.
- **`requireActiveOrg()` guards company administration; the settings toggle uses `requireOwner()`** so a lapsed company is not locked out of its own preferences.
- Comments explain *why*, not *what*, in full sentences.
- Kill any dev server you start.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/assignee-terms.ts` | `AssigneeTerms` type and `assigneeTerms(mode)`. Pure, no I/O. |
| `src/lib/assignee-terms.test.ts` | Its unit tests. |
| `src/app/(app)/settings/page.tsx` | Owner-only org settings page. |
| `src/app/(app)/settings/actions.ts` | `updateAssigneeMode`. |
| `src/app/(app)/settings/SettingsClient.tsx` | The mode radio control. |
| `src/app/(app)/settings/settings.test.ts` | Action tests. |
| `src/app/(app)/dashboard/employee.test.ts` | `createEmployee` tests. |

**Modified:** `prisma/schema.prisma`, `src/lib/data.ts`, `src/components/UserMenu.tsx`, `src/app/(app)/dashboard/{DashboardBoard,ManageCrewsModal,AddJobModal,EditJobModal,page,actions}.tsx|ts`, `src/app/(app)/team/{page.tsx,TeamClient.tsx}`, `src/app/(app)/customers/{page.tsx,CustomersClient.tsx}`, `src/test/factories.ts`.

## The 17 user-visible strings

Every one of these must read correctly in both modes. This list is the acceptance criteria for Tasks 3 and 4.

| File | Line | Current text |
|---|---|---|
| `DashboardBoard.tsx` | ~156 | "Create a crew before adding jobs" |
| `DashboardBoard.tsx` | ~175 | "Manage Crews" (button) |
| `DashboardBoard.tsx` | ~222 | "Open this crew's phone view" |
| `ManageCrewsModal.tsx` | ~22 | "Manage Crews" (heading) |
| `ManageCrewsModal.tsx` | ~28 | "No crews yet." |
| `ManageCrewsModal.tsx` | ~76 | "Couldn't delete this crew — it may have jobs assigned now." |
| `ManageCrewsModal.tsx` | ~141 | "New crew color" |
| `ManageCrewsModal.tsx` | ~146 | "New crew name" |
| `AddJobModal.tsx` | ~60 | "Select a crew." |
| `AddJobModal.tsx` | ~228 | "Crew" (field label) |
| `EditJobModal.tsx` | ~35 | "Select a crew." |
| `EditJobModal.tsx` | ~81 | "Crew" (field label) |
| `CustomersClient.tsx` | ~117 | "Select a crew for the job." |
| `CustomersClient.tsx` | ~200 | "(add a crew first)" |
| `CustomersClient.tsx` | ~261 | "Crew" (field label) |
| `TeamClient.tsx` | ~90 | "Crew sign-in link" |
| `TeamClient.tsx` | ~179 | "Add a crew login" |

Plus the `/team` page heading ("Team") and `deleteCrew`'s thrown message in `dashboard/actions.ts` ("Cannot delete crew: N jobs still assigned to it.").

The crew phone view needs **no** change — it renders `crew.name`, never the word.

---

### Task 1: Schema and the terminology helper

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/assignee-terms.ts`
- Create: `src/lib/assignee-terms.test.ts`
- Modify: `src/lib/data.ts`
- Modify: `src/test/factories.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export type AssigneeTerms = {
  one: string;   // "crew"      | "employee"
  many: string;  // "crews"     | "employees"
  One: string;   // "Crew"      | "Employee"
  Many: string;  // "Crews"     | "Employees"
};
export function assigneeTerms(mode: AssigneeMode): AssigneeTerms;
```
  Plus `AssigneeMode` from `@prisma/client`, `Org.assigneeMode`, and `getAssigneeMode(): Promise<AssigneeMode>` in `src/lib/data.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/assignee-terms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assigneeTerms } from "@/lib/assignee-terms";

describe("assigneeTerms", () => {
  it("uses crew wording in CREW mode", () => {
    expect(assigneeTerms("CREW")).toEqual({
      one: "crew",
      many: "crews",
      One: "Crew",
      Many: "Crews",
    });
  });

  it("uses employee wording in EMPLOYEE mode", () => {
    expect(assigneeTerms("EMPLOYEE")).toEqual({
      one: "employee",
      many: "employees",
      One: "Employee",
      Many: "Employees",
    });
  });

  it("falls back to crew wording for an unrecognised mode", () => {
    // Fail closed to the default the schema declares, so a future enum value
    // shows the existing wording rather than rendering "undefined" at users.
    expect(assigneeTerms("SOMETHING_ELSE" as never).One).toBe("Crew");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/assignee-terms.test.ts`
Expected: FAIL — cannot resolve `@/lib/assignee-terms`.

- [ ] **Step 3: Add the schema column**

In `prisma/schema.prisma`, add the enum next to the other enums:

```prisma
enum AssigneeMode {
  CREW
  EMPLOYEE
}
```

And inside `model Org`, above `createdAt`:

```prisma
  // Whether this company organises work into crews or assigns it to named
  // people. Presentation only — a Crew row is the assignable unit either way,
  // which is what keeps the board, the phone view and recurring generation on
  // a single code path.
  assigneeMode AssigneeMode @default(CREW)
```

- [ ] **Step 4: Push to the TEST database only**

```bash
npm run db:push:test
```

Expected: reports the database is in sync. **Do not run `npm run db:push`** — that targets production.

- [ ] **Step 5: Implement the helper**

Create `src/lib/assignee-terms.ts`:

```ts
import type { AssigneeMode } from "@prisma/client";

/**
 * The noun a company uses for the thing work is assigned to.
 *
 * Kept as a single source rather than ternaries at each call site: this
 * wording appears in seventeen places, and scattering it makes it impossible
 * to change in one edit or to verify it is consistent.
 */
export type AssigneeTerms = {
  one: string;
  many: string;
  One: string;
  Many: string;
};

const TERMS: Record<AssigneeMode, AssigneeTerms> = {
  CREW: { one: "crew", many: "crews", One: "Crew", Many: "Crews" },
  EMPLOYEE: {
    one: "employee",
    many: "employees",
    One: "Employee",
    Many: "Employees",
  },
};

export function assigneeTerms(mode: AssigneeMode): AssigneeTerms {
  // Fall back rather than index blindly: an enum value added later should
  // show the existing wording, not render "undefined" at a customer.
  return TERMS[mode] ?? TERMS.CREW;
}
```

- [ ] **Step 6: Add the data-layer read**

In `src/lib/data.ts`, following the file's existing pattern (each function calls `requireOwner()` itself and scopes by its own `orgId` — do **not** add an `orgId` parameter):

```ts
export async function getAssigneeMode() {
  const { orgId } = await requireOwner();
  const org = await prisma.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { assigneeMode: true },
  });
  return org.assigneeMode;
}
```

- [ ] **Step 7: Let the test factory set the mode**

In `src/test/factories.ts`, extend `makeOrg` so tests can create an employee-mode company. Keep the existing default so every current caller is unaffected:

```ts
export async function makeOrg(
  name = `Org ${unique()}`,
  assigneeMode: "CREW" | "EMPLOYEE" = "CREW",
) {
  return prisma.org.create({ data: { name, slug: slugify(name), assigneeMode } });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- src/lib/assignee-terms.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 9: Full check and commit**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`

```bash
git add prisma/schema.prisma src/lib/assignee-terms.ts src/lib/assignee-terms.test.ts src/lib/data.ts src/test/factories.ts
git commit -m "Add assigneeMode and the terminology helper"
```

---

### Task 2: The settings page

**Files:**
- Create: `src/app/(app)/settings/page.tsx`
- Create: `src/app/(app)/settings/actions.ts`
- Create: `src/app/(app)/settings/SettingsClient.tsx`
- Create: `src/app/(app)/settings/settings.test.ts`
- Modify: `src/components/UserMenu.tsx`

**Interfaces:**
- Consumes: `assigneeTerms` and `getAssigneeMode` (Task 1).
- Produces:
```ts
export type SettingsResult = { ok: true } | { error: string };
// Parameter is `unknown`, not AssigneeMode: a Server Action's TypeScript
// parameter type is erased at runtime, so the value must be parsed.
export function updateAssigneeMode(mode: unknown): Promise<SettingsResult>;
```

- [ ] **Step 1: Write the failing test**

Create `src/app/(app)/settings/settings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
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
  requireActiveOrg: async () => {
    if (currentUser.value?.role !== "OWNER") throw new Error("redirect: /login");
    return currentUser.value;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateAssigneeMode } = await import("@/app/(app)/settings/actions");

// makeJob's real argument order is (orgId, crewId, customerId, dateISO) — an
// earlier plan in this repo got it wrong. Confirm it in src/test/factories.ts
// before running, and fix the call rather than the factory.

beforeEach(() => {
  currentUser.value = null;
});

async function actAsOwnerOfNewOrg() {
  const org = await makeOrg();
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

describe("updateAssigneeMode", () => {
  it("defaults a new company to CREW", async () => {
    const org = await makeOrg();
    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.assigneeMode).toBe("CREW");
  });

  it("switches to EMPLOYEE", async () => {
    const org = await actAsOwnerOfNewOrg();

    const result = await updateAssigneeMode("EMPLOYEE");

    expect(result).toEqual({ ok: true });
    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.assigneeMode).toBe("EMPLOYEE");
  });

  it("switches back to CREW", async () => {
    const org = await actAsOwnerOfNewOrg();
    await updateAssigneeMode("EMPLOYEE");

    await updateAssigneeMode("CREW");

    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.assigneeMode).toBe("CREW");
  });

  it("rejects a value outside the enum without writing", async () => {
    const org = await actAsOwnerOfNewOrg();

    const result = await updateAssigneeMode("DROP TABLE" as never);

    expect(result).toHaveProperty("error");
    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.assigneeMode).toBe("CREW");
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

    await expect(updateAssigneeMode("EMPLOYEE")).rejects.toThrow("redirect: /login");
  });

  it("switching there and back leaves every row untouched", async () => {
    // This is what "non-destructive" means, and asserting it is the only way
    // to know a future change has not started hiding or deleting rows.
    const org = await actAsOwnerOfNewOrg();
    const crew = await makeCrew(org.id);
    const customer = await makeCustomer(org.id);
    const job = await makeJob(org.id, crew.id, customer.id, "2026-09-01");
    const crewUser = await makeCrewUser(org.id, crew.id);

    await updateAssigneeMode("EMPLOYEE");
    await updateAssigneeMode("CREW");

    expect(await prisma.crew.findUnique({ where: { id: crew.id } })).not.toBeNull();
    expect(await prisma.job.findUnique({ where: { id: job.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: crewUser.id } })).not.toBeNull();
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(1);
    expect(await prisma.job.count({ where: { orgId: org.id } })).toBe(1);
  });

  it("never touches another company", async () => {
    const mine = await actAsOwnerOfNewOrg();
    const theirs = await makeOrg();

    await updateAssigneeMode("EMPLOYEE");

    expect(
      (await prisma.org.findUniqueOrThrow({ where: { id: mine.id } })).assigneeMode,
    ).toBe("EMPLOYEE");
    expect(
      (await prisma.org.findUniqueOrThrow({ where: { id: theirs.id } })).assigneeMode,
    ).toBe("CREW");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- "src/app/(app)/settings/settings.test.ts"`
Expected: FAIL — the actions module does not exist.

- [ ] **Step 3: Implement the action**

Create `src/app/(app)/settings/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";

export type SettingsResult = { ok: true } | { error: string };

// A Server Action's parameter type is erased at runtime, so the value that
// reaches Prisma must be checked against the enum rather than trusted.
const ModeSchema = z.enum(["CREW", "EMPLOYEE"]);

/**
 * requireOwner and not requireActiveOrg: this is a display preference, not
 * company administration, and locking a lapsed company out of its own
 * settings serves nobody. Creating people and logins stays gated.
 */
export async function updateAssigneeMode(mode: unknown): Promise<SettingsResult> {
  const { orgId } = await requireOwner();

  const parsed = ModeSchema.safeParse(mode);
  if (!parsed.success) return { error: "Pick a valid option." };

  await prisma.org.update({
    where: { id: orgId },
    data: { assigneeMode: parsed.data },
  });

  // Every screen that names the assignee re-renders with the new wording.
  revalidatePath("/", "layout");

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- "src/app/(app)/settings/settings.test.ts"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Build the page and client**

Create `src/app/(app)/settings/SettingsClient.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import type { AssigneeMode } from "@prisma/client";
import { updateAssigneeMode } from "./actions";

const OPTIONS: { value: AssigneeMode; label: string; hint: string }[] = [
  {
    value: "CREW",
    label: "We work in crews",
    hint: "Jobs are assigned to a crew, and a crew can have several people.",
  },
  {
    value: "EMPLOYEE",
    label: "We assign work to people",
    hint: "Jobs are assigned to a named employee. Nothing is deleted if you switch back.",
  },
];

export default function SettingsClient({ mode }: { mode: AssigneeMode }) {
  const [current, setCurrent] = useState<AssigneeMode>(mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: AssigneeMode) {
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      const result = await updateAssigneeMode(next);
      if ("error" in result) {
        setCurrent(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer gap-3 rounded-md border border-border p-3"
        >
          <input
            type="radio"
            name="assigneeMode"
            className="mt-1"
            checked={current === option.value}
            disabled={pending}
            onChange={() => choose(option.value)}
          />
          <span>
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="block text-sm text-muted">{option.hint}</span>
          </span>
        </label>
      ))}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
```

Create `src/app/(app)/settings/page.tsx`:

```tsx
import { getAssigneeMode } from "@/lib/data";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const mode = await getAssigneeMode();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <div className="card mt-4 p-6">
        <h2 className="text-sm font-medium">How do you assign work?</h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          This changes the wording across the app. Your existing jobs and
          people are not affected either way.
        </p>
        <SettingsClient mode={mode} />
      </div>
    </div>
  );
}
```

Check `src/app/(app)/billing/page.tsx` for the real card and heading conventions before committing, and match them rather than the placeholders above.

- [ ] **Step 6: Add the nav link**

In `src/components/UserMenu.tsx`, add a Settings link inside the existing `user.role === "OWNER"` block, after Account and before Billing, copying the sibling links' `className` exactly:

```tsx
          <a
            href="/settings"
            className="text-sm text-muted hover:text-foreground md:rounded-md md:px-3 md:py-1.5 md:hover:bg-foreground/5 md:hover:text-foreground"
          >
            Settings
          </a>
```

- [ ] **Step 7: Full check and commit**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`

```bash
git add "src/app/(app)/settings" src/components/UserMenu.tsx
git commit -m "Add an owner-only settings page with the assignee mode"
```

---

### Task 3: Terminology on the dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/(app)/dashboard/DashboardBoard.tsx`
- Modify: `src/app/(app)/dashboard/ManageCrewsModal.tsx`
- Modify: `src/app/(app)/dashboard/AddJobModal.tsx`
- Modify: `src/app/(app)/dashboard/EditJobModal.tsx`
- Modify: `src/app/(app)/dashboard/actions.ts` (the `deleteCrew` message)

**Interfaces:**
- Consumes: `assigneeTerms`, `getAssigneeMode`, `AssigneeTerms` (Task 1).
- Produces: no new exports. `DashboardBoard`, `ManageCrewsModal`, `AddJobModal` and `EditJobModal` each gain a required `terms: AssigneeTerms` prop.

- [ ] **Step 1: Read the mode in the page and pass it down**

In `src/app/(app)/dashboard/page.tsx`, add `getAssigneeMode()` to the existing `Promise.all` (do not add a serial `await` — it would delay the page), convert it with `assigneeTerms(mode)`, and pass the result to `DashboardBoard` as `terms`.

- [ ] **Step 2: Thread `terms` through the four components**

Add `terms: AssigneeTerms` to each component's props type and pass it from `DashboardBoard` into the three modals it renders.

Replace each string from the table at the top of this plan. The exact replacements:

| Location | Becomes |
|---|---|
| `DashboardBoard` empty state | `` `Create a ${terms.one} before adding jobs` `` |
| `DashboardBoard` button | `` `Manage ${terms.Many}` `` |
| `DashboardBoard` phone-view title | `` `Open this ${terms.one}'s phone view` `` |
| `ManageCrewsModal` heading | `` `Manage ${terms.Many}` `` |
| `ManageCrewsModal` empty state | `` `No ${terms.many} yet.` `` |
| `ManageCrewsModal` delete error | `` `Couldn't delete this ${terms.one} — it may have jobs assigned now.` `` |
| `ManageCrewsModal` colour input | `` `New ${terms.one} color` `` |
| `ManageCrewsModal` name input | `` `New ${terms.one} name` `` |
| `AddJobModal` validation | `` `Select a ${terms.one}.` `` |
| `AddJobModal` field label | `{terms.One}` |
| `EditJobModal` validation | `` `Select a ${terms.one}.` `` |
| `EditJobModal` field label | `{terms.One}` |

Leave the file names, component names, prop names and variable names alone. `ManageCrewsModal` keeps its name — renaming files is churn that makes the diff hard to review, and the spec is explicit that a `Crew` row remains the underlying unit.

- [ ] **Step 3: Fix the server-side delete message**

`deleteCrew` in `src/app/(app)/dashboard/actions.ts` throws `Cannot delete crew: N jobs still assigned to it.` The action has `orgId` already, so read the mode there and use the right noun:

```ts
  const org = await prisma.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { assigneeMode: true },
  });
  const terms = assigneeTerms(org.assigneeMode);
  if (jobCount > 0) {
    throw new Error(
      `Cannot delete ${terms.one}: ${jobCount} job${jobCount === 1 ? "" : "s"} still assigned to it.`,
    );
  }
```

- [ ] **Step 4: Verify no crew wording survives on the dashboard**

Run:

```bash
grep -rnoE '"[^"]*[Cc]rew[^"]*"|>[^<>{]*[Cc]rew[^<>{]*<' "src/app/(app)/dashboard" \
  | grep -vE 'import|from "|className|href=|Crew\[\]|CrewWithJobCount|crewId|ManageCrewsModal'
```

Expected: no user-visible strings remain. Hits on identifiers (`crewId`, type names, the import of `ManageCrewsModal`) are fine and expected.

- [ ] **Step 5: Full check and commit**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`

```bash
git add "src/app/(app)/dashboard"
git commit -m "Use the company's own word for assignees on the dashboard"
```

---

### Task 4: Terminology on team and customers

**Files:**
- Modify: `src/app/(app)/team/page.tsx`
- Modify: `src/app/(app)/team/TeamClient.tsx`
- Modify: `src/app/(app)/customers/page.tsx`
- Modify: `src/app/(app)/customers/CustomersClient.tsx`

**Interfaces:**
- Consumes: `assigneeTerms`, `getAssigneeMode`, `AssigneeTerms` (Task 1).
- Produces: no new exports. `TeamClient` and `CustomersClient` each gain a required `terms: AssigneeTerms` prop.

- [ ] **Step 1: Thread `terms` into both pages**

Both pages already `await` several things in a `Promise.all`. Add `getAssigneeMode()` to each, convert with `assigneeTerms`, pass down as `terms`.

- [ ] **Step 2: Replace the strings**

| Location | Becomes |
|---|---|
| `/team` page heading | `` `${terms.Many}` `` — "Team" becomes "Crews" or "Employees" |
| `TeamClient` sign-in link heading | `` `${terms.One} sign-in link` `` |
| `TeamClient` add-login heading | `` `Add a ${terms.one} login` `` |
| `CustomersClient` validation | `` `Select a ${terms.one} for the job.` `` |
| `CustomersClient` empty hint | `` `(add a ${terms.one} first)` `` |
| `CustomersClient` field label | `{terms.One}` |

- [ ] **Step 3: Verify no crew wording survives**

Run:

```bash
grep -rnoE '"[^"]*[Cc]rew[^"]*"|>[^<>{]*[Cc]rew[^<>{]*<' "src/app/(app)/team" "src/app/(app)/customers" \
  | grep -vE 'import|from "|className|href=|Crew\[\]|CrewWithJobCount|crewId|crewLoginPath'
```

Expected: no user-visible strings remain.

- [ ] **Step 4: Full check and commit**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`

```bash
git add "src/app/(app)/team" "src/app/(app)/customers"
git commit -m "Use the company's own word for assignees on team and customers"
```

---

### Task 5: Adding an employee and their login in one step

**Files:**
- Modify: `src/app/(app)/dashboard/actions.ts`
- Modify: `src/app/(app)/dashboard/ManageCrewsModal.tsx`
- Test: `src/app/(app)/dashboard/employee.test.ts`

**Interfaces:**
- Consumes: `requireActiveOrg`, `hashSecret` from `@/lib/auth/password`, `p2002Fields` from `@/lib/prisma-errors`.
- Produces:
```ts
export type CreateAssigneeResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createAssigneeWithLogin(input: {
  name: string;
  color: string;
  username?: string;
  pin?: string;
}): Promise<CreateAssigneeResult>;
```

- [ ] **Step 1: Write the failing test**

Create `src/app/(app)/dashboard/employee.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCrewUser } from "@/test/factories";

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
  requireActiveOrg: async () => {
    if (currentUser.value?.role !== "OWNER") throw new Error("redirect: /login");
    return currentUser.value;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createAssigneeWithLogin } = await import("@/app/(app)/dashboard/actions");

async function actAsOwner() {
  const org = await makeOrg(undefined, "EMPLOYEE");
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

beforeEach(() => {
  currentUser.value = null;
});

describe("createAssigneeWithLogin", () => {
  it("creates the person alone when no login is supplied", async () => {
    const org = await actAsOwner();

    const result = await createAssigneeWithLogin({ name: "Jose", color: "#22c55e" });

    expect(result).toMatchObject({ ok: true });
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(1);
    expect(await prisma.user.count({ where: { orgId: org.id, role: "CREW" } })).toBe(0);
  });

  it("creates the person and their login together", async () => {
    const org = await actAsOwner();

    const result = await createAssigneeWithLogin({
      name: "Maria",
      color: "#22c55e",
      username: "maria",
      pin: "481920",
    });

    expect(result).toMatchObject({ ok: true });
    const crew = await prisma.crew.findFirstOrThrow({ where: { orgId: org.id } });
    const user = await prisma.user.findFirstOrThrow({
      where: { orgId: org.id, role: "CREW" },
    });
    expect(user.name).toBe("Maria");
    expect(user.username).toBe("maria");
    expect(user.crewId).toBe(crew.id);
    // The PIN must never be recoverable from the row.
    expect(user.pinHash).not.toBe("481920");
    expect(user.pinHash).toMatch(/^\$argon2/);
  });

  it("leaves NO orphaned person behind when the username is taken", async () => {
    const org = await actAsOwner();
    const existingCrew = await makeCrew(org.id);
    await makeCrewUser(org.id, existingCrew.id, "taken");

    const before = await prisma.crew.count({ where: { orgId: org.id } });
    const result = await createAssigneeWithLogin({
      name: "Dan",
      color: "#22c55e",
      username: "taken",
      pin: "481920",
    });

    expect(result).toMatchObject({ ok: false });
    // The whole point of the transaction: a rejected login must not leave a
    // half-made employee the owner then has to find and delete.
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(before);
  });

  it("rejects a PIN that is not six digits, creating nothing", async () => {
    const org = await actAsOwner();

    const result = await createAssigneeWithLogin({
      name: "Dan",
      color: "#22c55e",
      username: "dan",
      pin: "12",
    });

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(0);
  });

  it("rejects whitespace-only names", async () => {
    const org = await actAsOwner();

    const result = await createAssigneeWithLogin({ name: "   ", color: "#22c55e" });

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(0);
  });

  it("refuses a crew member", async () => {
    const org = await makeOrg(undefined, "EMPLOYEE");
    currentUser.value = {
      userId: "x",
      orgId: org.id,
      role: "CREW",
      crewId: null,
      name: "Crew",
    };

    await expect(
      createAssigneeWithLogin({ name: "Jose", color: "#22c55e" }),
    ).rejects.toThrow("redirect: /login");
  });
});
```

Check `makeCrewUser`'s real signature in `src/test/factories.ts` before running and adjust the call above to match — do not change the factory to fit the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- "src/app/(app)/dashboard/employee.test.ts"`
Expected: FAIL — `createAssigneeWithLogin` is not exported.

- [ ] **Step 3: Implement the action**

Add to `src/app/(app)/dashboard/actions.ts`:

```ts
const AssigneeWithLoginInput = z
  .object({
    name: z.string().trim().min(1, "Enter a name"),
    color: z.string().trim().min(1, "Pick a color"),
    username: z.string().trim().min(1).optional(),
    pin: z.string().regex(/^\d{6}$/, "Use a 6-digit PIN").optional(),
  })
  .strict()
  .refine((v) => (v.username === undefined) === (v.pin === undefined), {
    message: "Enter both a username and a PIN, or neither",
  });

export type CreateAssigneeResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Creates a person and, optionally, their phone login in one step.
 *
 * Both rows are written in one transaction: a rejected username must not leave
 * a half-made employee behind for the owner to find and delete.
 *
 * Returns error state rather than throwing — production React redacts thrown
 * Server Action messages, so a throw would show boilerplate instead of the
 * reason.
 */
export async function createAssigneeWithLogin(input: {
  name: string;
  color: string;
  username?: string;
  pin?: string;
}): Promise<CreateAssigneeResult> {
  const { orgId } = await requireActiveOrg();

  const parsed = AssigneeWithLoginInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { name, color, username, pin } = parsed.data;

  // argon2 is deliberately expensive; hash before opening the transaction so
  // the database connection is not held across it.
  const pinHash = pin ? await hashSecret(pin) : null;

  try {
    const crew = await prisma.$transaction(async (tx) => {
      const created = await tx.crew.create({ data: { name, color, orgId } });
      if (username && pinHash) {
        await tx.user.create({
          data: {
            orgId,
            role: "CREW",
            name,
            username,
            pinHash,
            crewId: created.id,
          },
        });
      }
      return created;
    });
    revalidatePath("/dashboard");
    return { ok: true, id: crew.id };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      p2002Fields(err).includes("username")
    ) {
      return { ok: false, error: "That username is already in use." };
    }
    console.error(
      "Assignee not created:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
```

Add whatever imports this needs (`Prisma`, `hashSecret` from `@/lib/auth/password`, `p2002Fields`) if the file lacks them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- "src/app/(app)/dashboard/employee.test.ts"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the transaction is load-bearing**

Temporarily replace the `prisma.$transaction(...)` wrapper with two sequential `prisma.crew.create` / `prisma.user.create` calls outside a transaction.

Run: `npm test -- "src/app/(app)/dashboard/employee.test.ts"`
Expected: FAIL on "leaves NO orphaned person behind when the username is taken" — the crew count will have grown by one.

**Restore the transaction** and re-run to confirm PASS. Put both outputs in your report. `AGENTS.md` records that tests here have passed against deliberately broken code before.

- [ ] **Step 6: Wire the form**

In `ManageCrewsModal.tsx`, the add form gains two optional inputs in employee mode and routes through the new action. In crew mode the form and its `createCrew` call are unchanged.

Read the file's existing add-form block first and match its markup and class names; the sketch below shows the logic, not the styling:

```tsx
// Alongside the existing name/color state:
const [username, setUsername] = useState("");
const [pin, setPin] = useState("");
const [addError, setAddError] = useState<string | null>(null);
const employeeMode = terms.one === "employee";

async function add() {
  setAddError(null);
  if (!employeeMode) {
    await createCrew({ name, color });
  } else {
    const result = await createAssigneeWithLogin({
      name,
      color,
      // Send neither when both are blank, so an employee without a login is
      // still valid; the action rejects one without the other.
      username: username.trim() || undefined,
      pin: pin.trim() || undefined,
    });
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
  }
  setName("");
  setUsername("");
  setPin("");
  onChanged();
}
```

Render the two extra inputs only when `employeeMode`, labelled `Username (optional)` and `6-digit PIN (optional)`. Show `addError` inline with the same `text-danger` treatment the file already uses for its delete failure.

- [ ] **Step 7: Full check and commit**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`

```bash
git add "src/app/(app)/dashboard"
git commit -m "Add an employee and their login in one step"
```

---

## Final verification

- [ ] `npx tsc --noEmit && npm run lint && npm run build && npm test` — all four pass.
- [ ] Both "prove it is load-bearing" steps were actually run and actually failed before being reverted (Task 5 Step 5 is the only one; Task 2's cross-org test needs no mutation check because it asserts a second org's untouched value directly).
- [ ] Every one of the 17 strings in the table reads correctly in both modes.
- [ ] `git grep -n "assigneeMode" src/app src/components` — only `settings/`, the four page-level reads, and `deleteCrew`. No client component branches on it.
- [ ] Switching modes and back leaves `Crew`, `Job` and `User` rows untouched.
- [ ] No dev server left running.

## Before this reaches production

The new column must exist in production **before** the code that selects it is deployed, or every owner-facing page 500s. Order:

1. Apply `assigneeMode` to production (additive, defaulted — no backfill needed).
2. Deploy.

This is the owner's call, exactly as the billing schema change was. The safe route is the one used on 2026-08-04: preview with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, confirm it is a single additive `ALTER TABLE ... ADD COLUMN`, then apply that reviewed SQL directly.
