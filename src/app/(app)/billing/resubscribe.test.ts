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

const checkout = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  fail: false,
  url: "https://checkout.stripe.test/session" as string | null,
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
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          if (checkout.fail) throw new Error("Stripe is down");
          checkout.created.push(params);
          return { id: "cs_resub_1", url: checkout.url };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async () => ({ url: "https://portal.stripe.test/session" }),
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

const { startResubscribe } = await import("@/app/(app)/billing/actions");

beforeEach(() => {
  currentUser.value = null;
  checkout.created = [];
  checkout.fail = false;
  checkout.url = "https://checkout.stripe.test/session";
});

async function actAsOwnerOf(status: string | null, customerId: string | null) {
  const org = await makeOrg();
  await prisma.org.update({
    where: { id: org.id },
    data: { subscriptionStatus: status, stripeCustomerId: customerId },
  });
  const owner = await makeOwner(org.id, `owner-${org.id}@example.com`);
  currentUser.value = {
    userId: owner.id,
    orgId: org.id,
    role: "OWNER",
    crewId: null,
    name: "Owner",
  };
  return { org, owner };
}

describe("startResubscribe", () => {
  it("opens checkout for a cancelled org against its existing customer", async () => {
    const { org } = await actAsOwnerOf("canceled", "cus_lapsed");

    const result = await startResubscribe();

    expect(result).toEqual({ url: "https://checkout.stripe.test/session" });
    expect(checkout.created[0]).toMatchObject({
      mode: "subscription",
      customer: "cus_lapsed",
      // Reaching the org from the webhook depends entirely on this: the new
      // subscription's id is on no Org row yet, so the ordinary lookup misses.
      subscription_data: { metadata: { orgId: org.id } },
    });
  });

  it("never grants a second free trial", async () => {
    await actAsOwnerOf("canceled", "cus_lapsed");

    await startResubscribe();

    const params = checkout.created[0];
    // Stripe hands the same customer another trial without complaint — "it is
    // the responsibility of your system to implement a check" — so the absence
    // of this parameter IS the check. Without it, cancel-and-restart cycling is
    // an unlimited free plan, and Terms section 3 sells one trial per company.
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params).not.toHaveProperty("trial_period_days");
  });

  it("works for a grandfathered org that has no Stripe customer at all", async () => {
    // The second half of the gap AGENTS.md records: no customer id means the
    // portal button never rendered, so these orgs had no in-app recovery.
    const { owner } = await actAsOwnerOf(null, null);

    const result = await startResubscribe();

    expect(result).toHaveProperty("url");
    expect(checkout.created[0]).toMatchObject({ customer_email: owner.email });
    expect(checkout.created[0]).not.toHaveProperty("customer");
  });

  it("refuses when the subscription is already active", async () => {
    await actAsOwnerOf("active", "cus_live");

    const result = await startResubscribe();

    expect(result).toHaveProperty("error");
    // Never reached Stripe at all — no chance of a second subscription.
    expect(checkout.created).toEqual([]);
  });

  it("refuses during a trial, which is also an active subscription", async () => {
    await actAsOwnerOf("trialing", "cus_trial");

    const result = await startResubscribe();

    expect(result).toHaveProperty("error");
    expect(checkout.created).toEqual([]);
  });

  it("returns a readable error instead of throwing when Stripe is down", async () => {
    await actAsOwnerOf("canceled", "cus_lapsed");
    checkout.fail = true;

    const result = await startResubscribe();

    // Returned, not thrown: production React redacts thrown Server Action
    // messages, so a throw here shows the owner boilerplate instead.
    expect(result).toHaveProperty("error");
  });

  it("errors rather than redirecting nowhere when Stripe returns no URL", async () => {
    await actAsOwnerOf("canceled", "cus_lapsed");
    checkout.url = null;

    const result = await startResubscribe();

    expect(result).toHaveProperty("error");
  });
});
