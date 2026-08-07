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
