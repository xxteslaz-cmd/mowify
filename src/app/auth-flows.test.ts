import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCrewUser } from "@/test/factories";
// Imported from password.ts, not hash.ts directly: the ESLint restriction on
// @/lib/auth/hash only exempts src/test/**, and this file lives under
// src/app/ so it doesn't match that exemption. password.ts re-exports the
// same functions behind the "server-only" guard, which vitest.config.ts
// aliases away for tests, so it works here identically to hash.ts would.
import { verifySecret } from "@/lib/auth/password";
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
  return {
    ...actual,
    readSessionToken: async () => currentToken.value,
    // createSession writes a cookie, which needs a request scope Vitest has
    // no way to provide. Signup's account creation is what these tests are
    // about, not the cookie write.
    createSession: async () => {},
  };
});

const { requestReset } = await import("@/app/forgot-password/actions");
const { completeReset } = await import("@/app/reset-password/[token]/actions");
const { changePassword, emailMyResetLink, requestEmailChange, cancelEmailChange } = await import(
  "@/app/account/actions"
);
const { signup } = await import("@/app/signup/actions");
const { issueToken, consumeToken } = await import("@/lib/auth/token");
const { confirmEmail } = await import("@/app/verify-email/[token]/actions");
const VerifyEmailPage = (await import("@/app/verify-email/[token]/page")).default;
const { confirmEmailChange } = await import(
  "@/app/account/change-email/[token]/actions"
);
const ChangeEmailPage = (await import("@/app/account/change-email/[token]/page"))
  .default;

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

// Distinct from linkToken above: the change-email confirm link has two path
// segments before the token ("/account/change-email/TOKEN"), so the
// single-segment pattern used for the other links would capture "change-email"
// as if it were the token instead.
function changeEmailLinkToken(html: string): string {
  const m = html.match(
    /https:\/\/mowify\.test\/account\/change-email\/([A-Za-z0-9_-]+)/,
  );
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

  it("does not issue a reset token for a crew member's account, even if one somehow has an email set", async () => {
    const org = await makeOrg();
    const crew = await makeCrew(org.id);
    const crewUser = await makeCrewUser(org.id, crew.id);
    // Crew normally have no email and sign in with a PIN their owner sets, so
    // this flow is owner-only by construction. This seeds an email onto a
    // CREW row anyway, so the assertion below is actually exercising the
    // `role === "OWNER"` check rather than passing vacuously because
    // findUnique never found a row.
    await prisma.user.update({
      where: { id: crewUser.id },
      data: { email: "crew@example.com" },
    });

    await requestReset(undefined, form({ email: "crew@example.com" }));

    expect(await prisma.token.count()).toBe(0);
    expect(sent.calls).toHaveLength(0);
  });

  it("does not issue a reset token for a deactivated owner's account", async () => {
    const { user } = await seedOwner();
    await prisma.user.update({
      where: { id: user.id },
      data: { active: false },
    });

    await requestReset(undefined, form({ email: user.email! }));

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

    // changePassword returns its error rather than throwing: a production
    // build redacts thrown Server Action errors down to an opaque digest, so
    // the real message has to travel back as a value instead.
    const result = await changePassword({
      currentPassword: "not-the-password",
      newPassword: "attacker-chosen",
    });

    expect(result?.error).toBeTruthy();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // A stolen session must not be enough to lock the real owner out.
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("locks out after repeated wrong current-password guesses", async () => {
    const user = await signedIn();

    for (let i = 0; i < 5; i++) {
      await changePassword({
        currentPassword: "not-the-password",
        newPassword: "attacker-chosen",
      });
    }

    // A stolen session must not be able to guess the current password
    // unthrottled: a correct guess is a permanent takeover.
    const result = await changePassword({
      currentPassword: "original-password",
      newPassword: "attacker-chosen",
    });
    expect(result?.error).toMatch(/too many attempts/i);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifySecret(after.passwordHash!, "original-password")).toBe(true);
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

describe("email verification", () => {
  it("does not consume the token when the page is merely fetched", async () => {
    // Corporate mail scanners fetch every URL they find in an inbox. If
    // rendering burned the token, the scanner would consume it and the human
    // would arrive to find their own link already used.
    const { user } = await seedOwner();
    const raw = await issueToken(user.id, "EMAIL_VERIFICATION");

    await VerifyEmailPage({ params: Promise.resolve({ token: raw }) });

    const row = await prisma.token.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(row.consumedAt).toBeNull();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerifiedAt).toBeNull();

    // And the link still works for the person it was sent to.
    await expect(
      confirmEmail(undefined, form({ token: raw })),
    ).rejects.toThrow("redirect: /dashboard");
  });

  it("stamps emailVerifiedAt when the button is submitted", async () => {
    const { user } = await seedOwner();
    const raw = await issueToken(user.id, "EMAIL_VERIFICATION");

    await expect(
      confirmEmail(undefined, form({ token: raw })),
    ).rejects.toThrow("redirect: /dashboard");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerifiedAt).not.toBeNull();
  });

  it("refuses a second submission of the same link", async () => {
    const { user } = await seedOwner();
    const raw = await issueToken(user.id, "EMAIL_VERIFICATION");
    await expect(
      confirmEmail(undefined, form({ token: raw })),
    ).rejects.toThrow("redirect: /dashboard");

    const second = await confirmEmail(undefined, form({ token: raw }));
    expect(second?.error).toBeTruthy();
  });

  it("refuses a password-reset token", async () => {
    // Purpose binding: a one-hour reset token must not verify an email, and a
    // seven-day verification token must not reset a password.
    const { user } = await seedOwner();
    const reset = await issueToken(user.id, "PASSWORD_RESET");

    const result = await confirmEmail(undefined, form({ token: reset }));

    expect(result?.error).toBeTruthy();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerifiedAt).toBeNull();
  });
});

describe("changing the account email", () => {
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

  async function requestChange(newEmail = "new-address@example.com") {
    await requestEmailChange({ newEmail, currentPassword: "original-password" });
    const mail = sent.calls.find((c) => c.to === newEmail);
    if (!mail) throw new Error("no confirmation email sent to the new address");
    return changeEmailLinkToken(mail.html);
  }

  it("rejects a wrong current password and leaves the account alone", async () => {
    const user = await signedIn();

    // A stolen session must not be enough to move the account: the current
    // password has to be verified the same way changePassword requires it.
    const result = await requestEmailChange({
      newEmail: "attacker@example.com",
      currentPassword: "not-the-password",
    });

    expect(result?.error).toBeTruthy();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe(user.email);
    expect(after.pendingEmail).toBeNull();
    expect(sent.calls).toHaveLength(0);
  });

  it("locks out after repeated wrong current-password guesses", async () => {
    await signedIn();

    for (let i = 0; i < 5; i++) {
      await requestEmailChange({
        newEmail: "attacker@example.com",
        currentPassword: "not-the-password",
      });
    }

    // A stolen session must not be able to guess the current password
    // unthrottled: a correct guess would let an attacker move the account to
    // an address they control.
    const result = await requestEmailChange({
      newEmail: "attacker@example.com",
      currentPassword: "original-password",
    });
    expect(result?.error).toMatch(/too many attempts/i);
    expect(sent.calls).toHaveLength(0);
  });

  it("sets pendingEmail and leaves email unchanged until the token is confirmed", async () => {
    const user = await signedIn();

    await requestChange("new-address@example.com");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe(user.email);
    expect(after.pendingEmail).toBe("new-address@example.com");

    // One mail to the new address to confirm, one warning to the old address
    // naming it — the only signal the real owner gets if this wasn't them.
    expect(sent.calls).toHaveLength(2);
    const toNew = sent.calls.find((c) => c.to === "new-address@example.com");
    const toOld = sent.calls.find((c) => c.to === user.email);
    expect(toNew?.html).toContain("https://mowify.test/account/change-email/");
    expect(toOld?.html).toContain("new-address@example.com");
  });

  it("does not consume the token when the confirm page is merely fetched", async () => {
    // Same bug this closes on /verify-email: a corporate mail scanner fetches
    // every URL in an inbox, and a GET must not be able to burn the link
    // before the owner clicks it themselves.
    const user = await signedIn();
    const raw = await requestChange();

    await ChangeEmailPage({ params: Promise.resolve({ token: raw }) });

    const row = await prisma.token.findFirstOrThrow({
      where: { userId: user.id, purpose: "EMAIL_CHANGE" },
    });
    expect(row.consumedAt).toBeNull();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe(user.email);

    // And the link still works for the person it was sent to.
    await expect(
      confirmEmailChange(undefined, form({ token: raw })),
    ).rejects.toThrow("redirect: /account");
  });

  it("confirming moves the address, clears pendingEmail, stamps emailVerifiedAt, and drops other sessions but not the acting one", async () => {
    const user = await signedIn();
    const oldEmail = user.email!;
    const raw = await requestChange("new-address@example.com");

    await expect(
      confirmEmailChange(undefined, form({ token: raw })),
    ).rejects.toThrow("redirect: /account");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe("new-address@example.com");
    expect(after.email).not.toBe(oldEmail);
    expect(after.pendingEmail).toBeNull();
    expect(after.emailVerifiedAt).not.toBeNull();

    const rows = await prisma.session.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken("acting-session"));
  });

  it("refuses to reuse the same confirm link", async () => {
    const user = await signedIn();
    const raw = await requestChange("new-address@example.com");

    await expect(
      confirmEmailChange(undefined, form({ token: raw })),
    ).rejects.toThrow("redirect: /account");

    const second = await confirmEmailChange(undefined, form({ token: raw }));
    expect(second?.error).toBeTruthy();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe("new-address@example.com"); // unchanged by the replay
  });

  it("an EMAIL_CHANGE token cannot reset a password", async () => {
    // Purpose binding: a one-hour email-change token must not be usable to
    // reset a password, exactly as PASSWORD_RESET and EMAIL_VERIFICATION
    // tokens must not substitute for one another.
    const { user } = await seedOwner();
    const changeToken = await issueToken(user.id, "EMAIL_CHANGE");

    const result = await completeReset(
      undefined,
      form({ token: changeToken, password: "should-not-apply" }),
    );

    expect(result?.error).toBeTruthy();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifySecret(after.passwordHash!, "should-not-apply")).toBe(false);
  });

  it("produces a readable error rather than a raw crash if the address is taken before confirmation", async () => {
    const user = await signedIn();
    const raw = await requestChange("new-address@example.com");

    // Simulates another signup claiming the address in the intervening hour.
    // Done directly against the database, since this app's own signup flow
    // would otherwise also refuse the duplicate at its own pre-check rather
    // than exercising the unique-constraint path this test is after.
    const otherOrg = await makeOrg();
    await prisma.user.create({
      data: {
        orgId: otherOrg.id,
        role: "OWNER",
        name: "Someone else",
        email: "new-address@example.com",
        passwordHash: user.passwordHash,
      },
    });

    const result = await confirmEmailChange(undefined, form({ token: raw }));

    expect(result?.error).toBeTruthy();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // The write that would have moved the address is exactly the one that hit
    // the unique constraint, so the original account must still be unmoved.
    expect(after.email).not.toBe("new-address@example.com");
    // And pendingEmail must not be left pointing at an address that can never
    // be confirmed with this (now-consumed) token — otherwise /account would
    // show a stale "confirm to finish" banner forever.
    expect(after.pendingEmail).toBeNull();
  });

  it("cancelling clears the pending address and the outstanding token", async () => {
    const user = await signedIn();
    const raw = await requestChange("new-address@example.com");

    await cancelEmailChange();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pendingEmail).toBeNull();

    // The link from before the cancellation must no longer work.
    const result = await confirmEmailChange(undefined, form({ token: raw }));
    expect(result?.error).toBeTruthy();
  });

  it("suppresses a second request inside the cooldown, without touching the first link", async () => {
    // Without this, any owner account (free to create via signup) could mail
    // an arbitrary attacker-chosen inbox as fast as this action is invoked.
    const user = await signedIn();
    const raw = await requestChange("new-address@example.com");
    sent.calls.length = 0;

    const result = await requestEmailChange({
      newEmail: "second-address@example.com",
      currentPassword: "original-password",
    });

    expect(result?.error).toBeTruthy();
    expect(sent.calls).toHaveLength(0);

    // The cooldown suppresses a second send; it must not invalidate the link
    // already issued.
    await expect(
      confirmEmailChange(undefined, form({ token: raw })),
    ).rejects.toThrow("redirect: /account");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe("new-address@example.com");
  });

  // Reviewer-supplied attack probes. The scenario: an attacker with a stolen
  // session AND the current password (the request-time check alone cannot
  // stop someone who has both) requests a move to their own address. The
  // token reaches their inbox. The warning email tells the real owner to
  // change their password — or, for a full compromise, to reset it — "if
  // this wasn't you." Both of those remedies are worthless if the attacker's
  // already-issued link still works afterwards.
  describe("attack probes: reacting to the warning email must actually stop the move", () => {
    it("PROBE A — a password change cancels an in-flight email change", async () => {
      const user = await signedIn();
      const oldEmail = user.email!;
      const raw = await requestChange("attacker@evil.example");

      // The owner reacts to the warning email exactly as it instructs.
      await changePassword({
        currentPassword: "original-password",
        newPassword: "a-brand-new-password",
      });

      const afterPasswordChange = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(afterPasswordChange.pendingEmail).toBeNull();

      // The attacker, who already holds the confirmation link, must not
      // still be able to move the account after the owner "fixed" things.
      const result = await confirmEmailChange(undefined, form({ token: raw }));
      expect(result?.error).toBeTruthy();

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.email).toBe(oldEmail);
    });

    it("PROBE B — a completed password reset cancels an in-flight email change", async () => {
      const user = await signedIn();
      const oldEmail = user.email!;
      const raw = await requestChange("attacker@evil.example");

      // The owner reacts to a full compromise the way the warning email's
      // advice implies: requesting and completing a password reset, which
      // normally drops every session.
      await requestReset(undefined, form({ email: oldEmail }));
      const resetMail = sent.calls.find(
        (c) => c.to === oldEmail && c.html.includes("/reset-password/"),
      );
      if (!resetMail) throw new Error("no reset email sent");
      const resetToken = linkToken(resetMail.html);

      await expect(
        completeReset(
          undefined,
          form({ token: resetToken, password: "recovered-password" }),
        ),
      ).rejects.toThrow("redirect: /login");

      const afterReset = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(afterReset.pendingEmail).toBeNull();
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

      // The attacker's already-held confirmation link must not still work
      // after this recovery — the worst case from the review, since a full
      // reset that still lets the account move afterwards is worse than no
      // warning at all.
      const result = await confirmEmailChange(undefined, form({ token: raw }));
      expect(result?.error).toBeTruthy();

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.email).toBe(oldEmail);
    });

    it("PROBE C — the confirming request with no session of its own drops every session", async () => {
      // The realistic case: the confirm link is emailed to the NEW address
      // and normally opened on a device or browser with no cookie for this
      // account at all — which is also why the route is public. A test that
      // only exercises the acting-session path (as the earlier "drops other
      // sessions" test does) never proves anything about production, where
      // there usually is no acting session.
      const user = await signedIn();
      const raw = await requestChange("new-address@example.com");
      currentToken.value = null;

      await expect(
        confirmEmailChange(undefined, form({ token: raw })),
      ).rejects.toThrow("redirect: /account");

      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    });
  });
});

describe("signup does not send email", () => {
  it("creates the account without mailing anyone", async () => {
    // Signup is unauthenticated. Mailing from it let anyone script an
    // arbitrary recipient list and burn the sending domain's reputation, so
    // verification is started from /account instead.
    await expect(
      signup(
        undefined,
        form({
          name: "New Owner",
          companyName: "Fresh Yard Co",
          email: "fresh-owner@example.com",
          password: "a-good-password",
        }),
      ),
    ).rejects.toThrow("redirect: /dashboard");

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "fresh-owner@example.com" },
    });
    expect(user.emailVerifiedAt).toBeNull();

    // Nothing mailed, and no token left lying around for one.
    expect(sent.calls).toHaveLength(0);
    expect(await prisma.token.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("emailing yourself a reset link", () => {
  async function signedInOwner() {
    const { org, user } = await seedOwner();
    currentUser.value = {
      userId: user.id,
      orgId: org.id,
      role: "OWNER",
      crewId: null,
      name: "Owner",
    };
    return user;
  }

  it("sends a usable reset link to the account's own address", async () => {
    const user = await signedInOwner();

    const result = await emailMyResetLink();

    expect(result?.sent).toBe(true);
    // The recipient comes from the database, never from caller input, so this
    // cannot be pointed at somebody else's inbox.
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0].to).toBe(user.email);

    const raw = linkToken(sent.calls[0].html);
    await expect(
      completeReset(undefined, form({ token: raw, password: "chosen-by-me" })),
    ).rejects.toThrow("redirect: /login");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifySecret(after.passwordHash!, "chosen-by-me")).toBe(true);
  });

  it("respects the cooldown instead of mailing repeatedly", async () => {
    await signedInOwner();
    await emailMyResetLink();
    sent.calls.length = 0;

    const second = await emailMyResetLink();

    expect(second?.sent).toBeUndefined();
    expect(second?.error).toBeTruthy();
    expect(sent.calls).toHaveLength(0);
  });

  it("cannot be called by a crew member", async () => {
    const org = await makeOrg();
    const crew = await makeCrew(org.id);
    const crewUser = await makeCrewUser(org.id, crew.id);
    currentUser.value = {
      userId: crewUser.id,
      orgId: org.id,
      role: "CREW",
      crewId: crew.id,
      name: "Crew",
    };

    await expect(emailMyResetLink()).rejects.toThrow();
    expect(sent.calls).toHaveLength(0);
  });
});
