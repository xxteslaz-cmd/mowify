# Employee mode: assigning work to people instead of crews

**Date:** 2026-08-08
**Status:** Approved, ready for implementation planning
**Scope:** Phase 1 of 2. Phase 2 (several people on one job) is recorded at the
end and is deliberately out of scope here.

## Problem

The product assumes a company organises work into crews. Plenty of small
landscaping outfits don't — a two-person operation thinks in people, not teams,
and being asked to invent a crew called "Crew 1" to hold one person is friction
at exactly the moment a new customer is deciding whether this fits them.

Everything needed to support that already exists. A crew with one person in it
*is* an employee. What's missing is a company being able to say so, and the
product using their words.

## Goals

- A company can say "we don't work in crews" and never see the word again.
- Work is assigned to named people, and each person sees their own day.
- Adding a person and giving them a phone login is one step, not two.
- No existing company is affected unless it opts in.
- Switching is reversible and never destroys or hides data.

## Non-goals

- **Several people on one job.** That is phase 2, and it is the expensive half:
  `Job.crewId` becomes a join table and the board, per-person ordering, and
  recurring generation all change. Phase 1 keeps one assignee per job, which is
  what the product already does.
- **A separate `Employee` entity.** A `Crew` row already models "a unit work is
  assigned to, which may have logins attached". Adding a parallel entity would
  double every query, every board path, and the isolation tests, to express a
  distinction the user never sees.
- **Removing crews from the product.** Companies that work in crews keep
  working in crews. This is a per-company mode, not a replacement.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| What an employee *is* | An existing `Crew` row, presented differently | The data model already fits. One code path for board, phone view, recurring generation and isolation tests |
| Scope of the mode | Presentation only in phase 1 | No migration, no risk to the 105 production jobs, ships quickly |
| Default | `CREW` | Existing companies see no change whatsoever |
| Switching | Free in both directions, instant, non-destructive | The owner may be experimenting; an irreversible setting in a product this small is a trap |
| Existing crews on switch | Become employees, keeping their jobs | See below — this reverses an earlier instruction, deliberately |
| Where the setting lives | New owner-only `/settings` page | `/account` is personal (password, email). This is company-wide |

### On "hide the crew data"

An earlier instruction was to keep crew data hidden until the company switches
back. Shown the consequence — this company's three crews carry all 105 of its
jobs, so hiding the crews would empty its calendar — the owner chose visibility.

The resolution: **nothing is hidden.** The same rows are shown, never called
crews. What disappears in employee mode is the word and the team-shaped
framing, not the data. Switching back is a pure relabel.

This is recorded because "hidden" and "visible" read as contradictory in the
history, and the reasoning for landing on visible is the useful part.

## What the mode changes

| | Crew mode (default) | Employee mode |
|---|---|---|
| Wording | Crew / Crews | Employee / Employees |
| Board columns | One per crew | One per employee |
| Job assignment field | "Crew" | "Employee" |
| Dashboard modal | "Manage Crews" | "Manage Employees" |
| Add form | Name + colour; logins added separately on `/team` | Name + colour + optional username and PIN, in one step |
| `/team` page | "Team" | "Employees" |

Everything else is byte-identical. The mode does not change what a job is, who
may complete one, how recurring visits are generated, or how many people a job
can have.

## Data model

One additive column. No migration, no backfill, no data movement.

```prisma
enum AssigneeMode {
  CREW
  EMPLOYEE
}

// On Org:
  // Whether this company organises work into crews or assigns it to named
  // people. Presentation only — a Crew row is the assignable unit either way,
  // which is what keeps the board, the phone view and recurring generation on
  // a single code path.
  assigneeMode AssigneeMode @default(CREW)
```

`Job.crewId` is untouched. `Crew` is untouched.

## The settings page

`/settings`, owner-only via `requireOwner()`, reachable from the user menu
beside Team, Account and Billing. Not gated behind `requireActiveOrg()` — it is
a read plus a single preference write, and locking a lapsed company out of its
own settings serves nobody.

It holds one control for now: how this company assigns work, as two options
with a sentence explaining each. Changing it is a Server Action returning error
state, never throwing.

The page is built so a second setting can be added without restructuring it.

## Terminology

A single helper owns the wording:

```ts
// src/lib/assignee-terms.ts
export type AssigneeTerms = {
  one: string;      // "crew" | "employee"
  many: string;     // "crews" | "employees"
  One: string;      // "Crew" | "Employee"
  Many: string;     // "Crews" | "Employees"
};

export function assigneeTerms(mode: AssigneeMode): AssigneeTerms;
```

The mode is read once, server-side, from the org on each page that needs it,
turned into terms, and passed down as props. **No component reads
`assigneeMode` and branches on it inline** — a dozen scattered ternaries is how
this kind of feature rots, and it makes the wording impossible to change later
in one place. Client components receive `AssigneeTerms`, never the raw mode.

Surfaces to update: the dashboard board column headers and its "Manage Crews"
button, `ManageCrewsModal`, `AddJobModal`, `EditJobModal`, the `/team` page and
its client, and the crew phone view's heading.

## Adding an employee

In employee mode the manage modal gains two optional fields, username and
6-digit PIN, so a person and their phone login are created together. In crew
mode the form is unchanged.

An employee with no login is valid — someone who doesn't use the app but whose
day still needs planning. `/team` remains the place to reset a PIN, deactivate
a login, or add one later.

The login half reuses `createCrewLogin`'s existing validation: username unique
per-org, PIN hashed with argon2, never stored raw.

**This form stays gated behind `requireActiveOrg()`**, unlike the settings
toggle. Creating people and logins is company administration and already sits
behind that gate; only the display preference is exempt. Creating the person
and the login must succeed or fail together, so a rejected username leaves no
half-made employee behind.

## Switching

Both directions are allowed at any time and take effect immediately. Because a
job always has exactly one assignee in phase 1, no combination of data can be
made invalid by switching, so there is nothing to guard against.

Phase 2 introduces the one unsafe direction (employee → crew while some job has
several people on it) and the guard that belongs with it.

## Deliberately unchanged

- `Job.crewId`, `Job.orderInDay`, and every query that reads them.
- `updateJobStatus` keeps calling only `verifySession()`, so a lapsed company's
  people can still mark stops complete.
- Recurring generation.
- The crew phone view's route and behaviour.
- `requireActiveOrg()` gating on the fourteen owner write paths. The new
  settings action is a preference write, not company administration, and is
  gated with `requireOwner()` for the reason given above.

## Testing

- `assigneeTerms` returns the right pair for each mode, including capitalised
  forms.
- The settings action rejects a crew member and an unauthenticated caller, and
  writes only the caller's own org — the cross-org case belongs in the existing
  isolation suites.
- A new company defaults to `CREW`.
- Switching to `EMPLOYEE` and back changes no `Crew`, `Job`, or `User` row.
  This is the test that proves "non-destructive" rather than asserting it.
- In employee mode the manage form creates the person and, when a username and
  PIN are supplied, the login too — and creates the person alone when they are
  not.
- A duplicate username in the combined form is rejected without leaving an
  orphaned employee behind.

Per `AGENTS.md`, verify the security-relevant tests fail when the protection is
removed rather than trusting a green run.

## Risks

Low. The only schema change is an additive enum column with a default, so
existing rows need no backfill and no company changes behaviour until it opts
in. The realistic failure mode is cosmetic: a missed surface still saying
"crew" in employee mode. The terminology helper plus a grep for the literal
word across `src/app` and `src/components` is the guard.

Production schema is applied with `prisma db push`; per the ruling on
2026-08-04, the production push happens at deploy time by the owner, not from
inside the implementation.

## Phase 2, recorded so it is not rediscovered

Several people on one job. `Job.crewId` and `Job.orderInDay` move into a
`JobAssignment` join keyed on `(jobId, crewId)` carrying its own `orderInDay`,
so each person orders their own day. A job appears in every assignee's column
with the co-workers named on the card. Job status stays a single field — any
assignee completing it completes it for everyone. Switching employee → crew is
refused while any job has more than one person, listing the offending jobs.

This is a migration on a required foreign key with live data behind it, and
deserves the same staged treatment the billing schema change got: add the join,
backfill, verify every job has exactly one assignment, and only then drop the
old columns.
