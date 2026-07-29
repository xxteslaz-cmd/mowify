# Changing the account email address

**Date:** 2026-07-29
**Status:** Approved
**Supersedes:** the "Changing the account email address" non-goal in `2026-07-28-password-reset-design.md`

## Problem

The account email is fixed at signup. A typo produces an account whose password
can never be reset, because the reset goes to an address nobody reads — and the
owner has no way to correct it themselves.

It was deferred because doing it naively creates an account-takeover path:
someone holding a stolen session changes the email to their own, then uses
password reset to lock the real owner out permanently. Any design has to close
that.

## Goals

- An owner can move their account to a different email address.
- A typo cannot strand them at an address they do not control.
- A stolen session alone cannot move the account.
- The real owner is warned while they can still react.

## Non-goals

- Changing a crew member's username. Crew have no email; their owner manages
  them from `/team`.
- Multiple addresses per account, or a separate billing address.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Authorisation | Current password required | Same reasoning as change-password: a stolen session must not be enough |
| When it applies | Only after the NEW address confirms | A typo would otherwise move the account somewhere unreachable, which is the exact failure this feature exists to prevent |
| Old address | Gets a warning email | The only signal a real owner receives if someone with a stolen session is moving their account. Without it, the first they know is being locked out |
| Link lifetime | 1 hour | It changes a security-critical value, so treat it as a credential, like a reset link |
| Storage | `User.pendingEmail` plus an `EMAIL_CHANGE` token | Reuses the existing token machinery; one nullable column and one enum value |

## Data model

- `TokenPurpose` gains `EMAIL_CHANGE`.
- `User` gains `pendingEmail String?`.

`pendingEmail` is not unique-constrained: two owners may both have a pending
change to the same address, and only the first to confirm gets it. The
uniqueness that matters is on `User.email`, which already exists.

## Flow

### Requesting

1. `requireOwner()`.
2. Validate the new address; reject if it equals the current one.
3. Verify the current password with the same argon2 path as login. Apply the
   same lockout as `changePassword` — `isLocked` / `nextLockoutState` /
   `priorFailures` — so this cannot be used to brute-force the password.
4. Reject if the address already belongs to another account. Return a
   field-level error; the address being taken is not a secret worth protecting
   here, since signup already rejects duplicates visibly.
5. Set `pendingEmail`, issue an `EMAIL_CHANGE` token (1 hour), and send the
   confirmation link to the **new** address.
6. Send a warning to the **old** address naming the new one, telling them to
   change their password if it was not them.

### Confirming

1. `/account/change-email/[token]` looks the token up read-only and renders a
   confirm button. It must not consume on GET — mail scanners fetch every URL
   in an inbox, which is the bug already fixed once on the verification route.
2. On submit: consume the token, then in one transaction move `pendingEmail`
   into `email`, clear `pendingEmail`, and stamp `emailVerifiedAt` — the new
   address has just proven itself, so it starts verified.
3. Re-check uniqueness inside that transaction. Another signup may have taken
   the address in the intervening hour; a `P2002` on `email` must surface as a
   readable error, not a raw crash. Use the existing `p2002Fields` helper —
   this project's Prisma driver leaves `meta.target` undefined.
4. Delete every session except the acting one, as `changePassword` does. If the
   change was made by an attacker, the owner's other sessions should not
   survive it.

### Cancelling

Requesting a new change supersedes any prior pending one — `issueToken` already
marks earlier tokens of the same purpose consumed. `/account` shows the pending
address with a "cancel" action that clears `pendingEmail` and consumes the
outstanding token.

## Error handling

- A wrong current password returns a field-level error and counts toward the
  lockout.
- An expired, consumed or unknown token renders one identical page.
- The address being taken returns a field-level error at request time, and a
  readable error at confirm time if it was taken in between.

## Testing

- The current password is required, and a wrong one counts toward the lockout.
- `email` is unchanged until the token is confirmed.
- Fetching the confirm page does not consume the token.
- Confirming moves the address, clears `pendingEmail`, stamps
  `emailVerifiedAt`, and drops other sessions but not the acting one.
- A token cannot be reused, and an `EMAIL_CHANGE` token cannot reset a password.
- An address taken between request and confirm produces a readable error rather
  than a raw Prisma failure.

For the security-critical cases, verify the test fails when the protection is
removed rather than trusting a green run.
