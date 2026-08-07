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

    const pending = await prisma.pendingSignup.findFirstOrThrow({
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

    const pending = await prisma.pendingSignup.findFirstOrThrow({
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

    const pending = await prisma.pendingSignup.findFirstOrThrow({
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

  it("a second signup for the same email CANNOT touch the first one's row", async () => {
    // This is the account-takeover regression test. Reusing one row per email
    // let an unauthenticated request overwrite the passwordHash and claimHash
    // of a signup that was mid-payment: the victim paid, and the webhook then
    // provisioned the company with the attacker's password and claim.
    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);
    const victim = await prisma.pendingSignup.findFirstOrThrow({
      where: { email: "dana@example.com" },
    });

    created.nextId = "cs_test_2";
    cookieJar.value = new Map();
    await expect(
      signup(undefined, form({ password: "attacker-password" })),
    ).rejects.toThrow(/redirect:/);

    const victimAfter = await prisma.pendingSignup.findUniqueOrThrow({
      where: { id: victim.id },
    });
    expect(victimAfter.passwordHash).toBe(victim.passwordHash);
    expect(victimAfter.claimHash).toBe(victim.claimHash);
    expect(victimAfter.checkoutSessionId).toBe(victim.checkoutSessionId);

    // The second attempt got its own row, not a rewrite of the first.
    expect(await prisma.pendingSignup.count()).toBe(2);
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
      await prisma.pendingSignup.findFirst({ where: { email: "stale@example.com" } }),
    ).toBeNull();
    expect(
      await prisma.pendingSignup.findFirst({ where: { email: "done@example.com" } }),
    ).not.toBeNull();
  });

  it("rejects whitespace-only input", async () => {
    const state = await signup(undefined, form({ companyName: "   " }));
    expect(state?.errors?.companyName).toBeTruthy();
    expect(await prisma.pendingSignup.count()).toBe(0);
  });
});
