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
