# Password reset and email verification for Mowify

**Date:** 2026-07-28
**Status:** Approved, ready for implementation planning
**Follows:** `2026-07-27-auth-design.md`, which listed both of these as non-goals

## Problem

Multi-tenant authentication shipped without any way to recover an account. Both
gaps were deliberate — no email provider was configured — and both are now the
sharpest edges in the product:

- **A forgotten owner password is unrecoverable.** The only fix is editing the
  database by hand. That is tolerable while there is only one company and
  its owner has database access. It is not tolerable for a customer.
- **No email address is ever verified.** A typo at signup produces an account
  whose password can never be reset, because the reset would be sent to an
  address nobody reads.

A third gap surfaced while designing this: there is no way to change a password
you still know. That is the operation people reach for most often, and it shares
all its machinery with reset.

## Goals

- An owner who has forgotten their password can recover it themselves, by email.
- An owner who knows their password can change it.
- Owners are prompted to verify their email, and can do so at any time.
- No flow reveals whether a given email address is registered.
- A reset token cannot be replayed, shared, or used for a purpose it was not issued for.

## Non-goals

- **Changing the account email address.** It needs verification on the new
  address to avoid becoming an account-takeover path, and that is a separate
  piece of work. The email remains fixed at signup.
- **Crew PIN self-service recovery.** Crew members have no email address. Their
  owner already resets PINs from `/team`, which is the correct channel — it
  requires a human who knows the person.
- **Blocking unverified accounts.** See the decision below.
- Multi-factor authentication, social login, session listing or remote sign-out.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Email provider | Resend, with a domain the owner controls | The only option that delivers to arbitrary addresses. Without a verified domain, Resend delivers only to the account holder's own address, which silently fails for every future customer |
| Token storage | One `Token` model with a `purpose` field | Shared hashing, expiry and single-use logic; mirrors the existing `Session` pattern. Two models would duplicate that logic in places that drift |
| Token secrecy | SHA-256 stored, raw value only in the email | Same property as `Session`: a database leak yields no usable tokens |
| Reset token lifetime | 1 hour | It is a live credential sitting in an inbox |
| Verification token lifetime | 7 days | Proves nothing dangerous; should not strand someone who reads email on Monday |
| Unverified accounts | Full access, with a reminder banner | A hard block means a bounced or spam-filtered email locks a paying customer out, recoverable only by manual database surgery — the same class of problem this work exists to remove |
| Change password | Requires the current password | A stolen session must not be enough to lock the real owner out |

## Data model

### New

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
  // Set on redemption and never cleared. Single use is the security model:
  // an emailed link may be forwarded, archived, or sit in a mailbox for months.
  consumedAt DateTime?
  createdAt  DateTime     @default(now())

  @@index([userId, purpose])
}
```

### Changed

`User` gains `emailVerifiedAt DateTime?` and a `tokens Token[]` back-relation.
Null means unverified, which is what drives the banner.

### Lifetimes

- `PASSWORD_RESET`: 1 hour.
- `EMAIL_VERIFICATION`: 7 days.

Both are constants in the token module, not magic numbers at call sites.

## Email infrastructure

New `src/lib/email/`:

- **`client.ts`** — a thin wrapper over Resend exposing `sendEmail({ to, subject, html })`.
  It never throws: a send failure is logged and reported through the return
  value, because no caller should fail a user-facing operation because an email
  provider is having a bad day.
- **`templates.ts`** — the two messages, as functions returning subject and HTML.
  Plain, inline-styled HTML; no external images, which would leak a `Referer`
  containing the token URL.

Three new environment variables, documented in `.env.example`:

- `RESEND_API_KEY`
- `EMAIL_FROM` — must be on the verified domain
- `APP_URL` — the absolute origin for links. An email has no request context, so
  this cannot be derived. Getting it wrong sends customers to `localhost`.

The email module is server-only and must never be imported by client code, the
same rule the ESLint restriction already enforces for `hash.ts`.

## Flows

### Routes

| Route | Access | Purpose |
|---|---|---|
| `/forgot-password` | public | Email field. Always responds "If that email is registered, we've sent a link." |
| `/reset-password/[token]` | public | Validates the token before rendering. Valid → new-password form. Invalid, expired or consumed → one page offering a fresh request. |
| `/verify-email/[token]` | public | Validates the token without consuming it and renders a confirm button; the action consumes it and stamps `emailVerifiedAt`. Mail scanners fetch every URL in an inbox, so a GET must not spend the link. |
| `/account` | owner | Change password. Also shows verification status with a resend button when unverified. |

### Requesting a reset

1. Validate the email's shape. Look the user up.
2. Whether or not the user exists, perform the same work and return the same
   response. Do not return early on a miss — the login timing oracle found in
   the auth work came from exactly that shape.
3. **Check the cooldown first.** If any `PASSWORD_RESET` token for that user was
   created within the last 60 seconds, skip sending and return the same
   response. Anyone can POST this endpoint repeatedly; without a cooldown it is
   an email-bomb vector aimed at a third party's inbox.
4. Otherwise: invalidate their prior unconsumed `PASSWORD_RESET` tokens by
   **stamping `consumedAt`, not deleting them**, then issue a new one and send
   the email.

The order matters, and so does stamping rather than deleting. The cooldown is
computed from prior tokens' `createdAt`; if the previous token were deleted
first, the cooldown would have no record to find and would never fire.

### Completing a reset

1. Hash the token from the URL and look it up by `tokenHash` **and**
   `purpose: PASSWORD_RESET`.
2. Reject if missing, expired, or `consumedAt` is set.
3. On success, in one transaction: set the new `passwordHash`, stamp
   `consumedAt`, clear `failedAttempts` and `lockedUntil`.
4. Delete every session for that user via `deleteAllSessionsForUser`. If the
   reset happened because the account was compromised, leaving the attacker's
   session alive defeats the entire operation.
5. Redirect to `/login` so they sign in with the new password.

Stamping `consumedAt` inside the same transaction as the password write is what
makes redemption atomic — two simultaneous submissions of the same link cannot
both succeed.

### Changing a password while signed in

1. `requireOwner()`.
2. Verify the supplied current password with the same argon2 path as login.
3. Write the new hash, then delete every session for the user **except the
   current one**. Changing your password should not sign you out of the tab you
   are using, but should sign out everywhere else.

The existing `deleteAllSessionsForUser` deletes every session unconditionally,
which is right for a reset but wrong here. This flow needs a sibling —
`deleteOtherSessionsForUser(userId, keepTokenHash)` — added alongside it in
`src/lib/auth/session.ts`. Do not change the existing function's behaviour; the
reset path and the crew-deactivation path both depend on it deleting everything.

### Verification

Signup issues an `EMAIL_VERIFICATION` token and sends the email. **That send
must not be able to fail signup** — a Resend outage must still produce a working
account, and the person can resend from `/account`.

`/verify-email/[token]` looks the token up by hash and purpose, rejects
missing/expired/consumed, then stamps `emailVerifiedAt` and `consumedAt`.

The banner renders in the same nested Server Component as the nav's user menu,
so it costs no extra query — `getSessionUser` already runs there. It shows only
for owners with `emailVerifiedAt === null`, and never on the auth pages.

## Error handling

- **Reset requests** return an identical message, at an identical cost, whether
  or not the account exists. A Resend failure is logged server-side and does not
  change the response; saying "we couldn't send to that address" would confirm
  the address exists.
- **Bad tokens** — wrong, expired, or consumed — render one identical page, so
  the page cannot be used to probe which tokens are real.
- **Wrong current password** on `/account` returns a field-level error. No
  lockout: an attacker who can reach that form already holds a session, so
  throttling buys nothing.
- **Validation** uses `.trim()` before `.min()`, and every object reaching Prisma
  passes through a `.strict()` allowlist. Both are bugs this codebase has already
  paid for once.

## Security properties

The design must preserve all of these, and the tests exist to prove them:

1. A token is single-use. A consumed token is rejected on every later attempt.
2. A token is purpose-bound. A `PASSWORD_RESET` token is rejected by the verify
   endpoint and vice versa.
3. Raw tokens are never stored, never logged, and never returned by an action.
4. No endpoint reveals whether an email address is registered.
5. A completed reset terminates every existing session for that user.
6. Changing a password requires proving you know the current one.

### The known residual risk

A reset link places a live credential in a URL, which lands in browser history
and, if the page ever gained an external image or script, in a `Referer` header.
The pages here are self-contained, so there is no leak path today. This is
named rather than left implicit; the mitigations are the one-hour lifetime,
single use, and dropping every session on redemption.

## Testing

Cover the places where a bug is a breach:

- **Token helpers:** hash round-trip; expired token rejected; **a consumed token
  rejected on a second use** — single use is the whole security model, so this
  test must fail if `consumedAt` is ignored.
- **Cross-purpose confusion:** a `PASSWORD_RESET` token rejected by the verify
  path, and an `EMAIL_VERIFICATION` token rejected by the reset path. This is
  the sharpest edge of the one-table design: if `purpose` is dropped from a
  lookup, a 7-day verification token silently becomes a password-reset token.
- **Cooldown:** a second request inside 60 seconds sends nothing but returns the
  same response; issuing a new token invalidates prior unconsumed ones, and the
  now-invalidated token is rejected if someone clicks the older email.
- **Reset side effects:** every session gone, lockout cleared.
- **Change password:** wrong current password rejected; the acting session
  survives while others are dropped.
- **Email client mocked:** called with the right recipient and an absolute link
  built from `APP_URL`; a send failure does not fail signup.

For the security-critical tests, verify they genuinely fail when the protection
is removed rather than trusting a green run. That practice caught a test with no
teeth during the authentication work.

## Implementation notes

New dependency: `resend`.

`AGENTS.md` requires reading the relevant guide in `node_modules/next/dist/docs/`
before writing code, as this Next.js version has breaking changes. Relevant here:
`01-app/02-guides/authentication.md` and the dynamic-route and Server Action
conventions, since `[token]` route params are async in this version.

Setup the owner must complete before this works end to end: create a Resend
account, add and verify a domain via its DNS records, then set `RESEND_API_KEY`,
`EMAIL_FROM` and `APP_URL`. Until the domain is verified, Resend delivers only
to the account holder's own address.
