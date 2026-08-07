import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner } from "@/test/factories";

const currentUser = vi.hoisted(() => ({
  value: null as null | {
    userId: string;
    orgId: string;
    role: "OWNER" | "CREW";
    crewId: string | null;
    name: string;
  },
}));

const portal = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  fail: false,
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

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    billingPortal: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          if (portal.fail) throw new Error("Stripe is down");
          portal.created.push(params);
          return { url: "https://portal.stripe.test/session" };
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

const { openBillingPortal } = await import("@/app/(app)/billing/actions");

beforeEach(() => {
  currentUser.value = null;
  portal.created = [];
  portal.fail = false;
});

async function actAsOwnerOf(status: string | null, customerId: string | null) {
  const org = await makeOrg();
  await prisma.org.update({
    where: { id: org.id },
    data: { subscriptionStatus: status, stripeCustomerId: customerId },
  });
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

describe("openBillingPortal", () => {
  it("returns a portal URL for the caller's own Stripe customer", async () => {
    await actAsOwnerOf("active", "cus_1");

    const result = await openBillingPortal();

    expect(result).toEqual({ url: "https://portal.stripe.test/session" });
    expect(portal.created[0]).toMatchObject({ customer: "cus_1" });
  });

  it("works for a LAPSED org, which is the whole point of this page", async () => {
    await actAsOwnerOf("past_due", "cus_2");

    const result = await openBillingPortal();

    expect(result).toEqual({ url: "https://portal.stripe.test/session" });
  });

  it("returns a readable error instead of throwing when Stripe is down", async () => {
    await actAsOwnerOf("active", "cus_1");
    portal.fail = true;

    const result = await openBillingPortal();

    // Returned, not thrown: production React redacts thrown Server Action
    // messages and the owner would see boilerplate instead.
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/billing/i);
  });

  it("returns an error when the org has no Stripe customer", async () => {
    await actAsOwnerOf(null, null);

    const result = await openBillingPortal();

    expect(result).toHaveProperty("error");
    expect(portal.created).toEqual([]);
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

    await expect(openBillingPortal()).rejects.toThrow("redirect: /login");
  });
});
