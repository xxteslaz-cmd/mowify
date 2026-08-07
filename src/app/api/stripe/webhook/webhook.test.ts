import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makePendingSignup } from "@/test/factories";

const canceled = vi.hoisted(() => ({ ids: [] as string[] }));
const subscriptions = vi.hoisted(() => ({
  value: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    subscriptions: {
      cancel: async (id: string) => {
        canceled.ids.push(id);
        return { id, status: "canceled" };
      },
      retrieve: async (id: string) => {
        const sub = subscriptions.value.get(id);
        if (!sub) throw new Error(`no such subscription: ${id}`);
        return sub;
      },
    },
    webhooks: {
      constructEventAsync: async (...args: unknown[]) => {
        const { default: StripeClient } = await import("stripe");
        return new StripeClient("sk_test_x").webhooks.constructEventAsync(
          ...(args as Parameters<Stripe["webhooks"]["constructEventAsync"]>),
        );
      },
    },
  }),
}));

const { handleStripeEvent } = await import("@/lib/stripe/handle-event");

function completedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        client_reference_id: "REPLACE",
        customer: "cus_1",
        subscription: "sub_1",
        ...overrides,
      },
    },
  } as never;
}

beforeEach(() => {
  canceled.ids = [];
  subscriptions.value = new Map([
    [
      "sub_1",
      {
        id: "sub_1",
        status: "trialing",
        trial_end: 1790000000,
        items: { data: [{ current_period_end: 1790000000 }] },
      },
    ],
  ]);
});

describe("checkout.session.completed", () => {
  it("creates the org and owner from the pending signup", async () => {
    const pending = await makePendingSignup({ email: "new@example.com" });

    await handleStripeEvent(completedEvent({ client_reference_id: pending.id }));

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "new@example.com" },
    });
    expect(user.role).toBe("OWNER");

    const org = await prisma.org.findUniqueOrThrow({ where: { id: user.orgId } });
    expect(org.subscriptionStatus).toBe("trialing");
    expect(org.stripeCustomerId).toBe("cus_1");
    expect(org.stripeSubscriptionId).toBe("sub_1");
  });

  it("consumes the row and discards the stored password hash", async () => {
    const pending = await makePendingSignup({ email: "new@example.com" });

    await handleStripeEvent(completedEvent({ client_reference_id: pending.id }));

    const fresh = await prisma.pendingSignup.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(fresh.consumedAt).not.toBeNull();
    expect(fresh.orgId).not.toBeNull();
    expect(fresh.passwordHash).toBeNull();
  });

  it("is idempotent: a replayed event creates exactly one org", async () => {
    const pending = await makePendingSignup({ email: "new@example.com" });
    const event = completedEvent({ client_reference_id: pending.id });

    await handleStripeEvent(event);
    await handleStripeEvent(event);

    expect(await prisma.org.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
    expect(canceled.ids).toEqual([]);
  });

  it("cancels a SECOND checkout completed for the same signup", async () => {
    const pending = await makePendingSignup({ email: "new@example.com" });

    await handleStripeEvent(completedEvent({ client_reference_id: pending.id }));
    await handleStripeEvent(
      completedEvent({
        client_reference_id: pending.id,
        id: "cs_test_2",
        subscription: "sub_2",
      }),
    );

    expect(await prisma.org.count()).toBe(1);
    expect(canceled.ids).toEqual(["sub_2"]);
    // The original subscription is the one that survives.
    const org = await prisma.org.findFirstOrThrow();
    expect(org.stripeSubscriptionId).toBe("sub_1");
  });

  it("cancels the subscription when the email was taken in the gap", async () => {
    const other = await makeOrg();
    const pending = await makePendingSignup({ email: "clash@example.com" });
    await makeOwner(other.id, "clash@example.com");

    await handleStripeEvent(completedEvent({ client_reference_id: pending.id }));

    expect(canceled.ids).toEqual(["sub_1"]);
    // The pre-existing org is untouched and no second one appears.
    expect(await prisma.org.count()).toBe(1);

    const fresh = await prisma.pendingSignup.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(fresh.failedReason).toBe("email-taken");
    expect(fresh.consumedAt).toBeNull();
    expect(fresh.orgId).toBeNull();
  });

  it("honours a completion for an expired but unswept row", async () => {
    const pending = await makePendingSignup({
      email: "late@example.com",
      expiresAt: new Date(Date.now() - 1000),
    });

    await handleStripeEvent(completedEvent({ client_reference_id: pending.id }));

    // Taking payment and then refusing to create the account is the worst
    // outcome this design can produce. Our expiry clock does not outrank
    // Stripe confirming a card.
    expect(
      await prisma.user.findUnique({ where: { email: "late@example.com" } }),
    ).not.toBeNull();
  });

  it("does nothing for an unknown client_reference_id", async () => {
    await handleStripeEvent(completedEvent({ client_reference_id: "nope" }));
    expect(await prisma.org.count()).toBe(0);
  });
});

describe("subscription lifecycle", () => {
  async function orgWithSubscription(status: string) {
    const org = await makeOrg();
    return prisma.org.update({
      where: { id: org.id },
      data: {
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        subscriptionStatus: status,
      },
    });
  }

  it("mirrors a status change onto the org", async () => {
    const org = await orgWithSubscription("trialing");
    subscriptions.value.set("sub_1", {
      id: "sub_1",
      status: "past_due",
      trial_end: null,
      items: { data: [{ current_period_end: 1790000000 }] },
    });

    await handleStripeEvent({
      id: "evt_2",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    } as never);

    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.subscriptionStatus).toBe("past_due");
  });

  it("recovers an org when payment succeeds again", async () => {
    const org = await orgWithSubscription("past_due");
    subscriptions.value.set("sub_1", {
      id: "sub_1",
      status: "active",
      trial_end: null,
      items: { data: [{ current_period_end: 1790000000 }] },
    });

    await handleStripeEvent({
      id: "evt_3",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    } as never);

    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.subscriptionStatus).toBe("active");
  });

  it("never touches another company's subscription", async () => {
    const mine = await orgWithSubscription("trialing");
    const theirs = await makeOrg();
    await prisma.org.update({
      where: { id: theirs.id },
      data: {
        stripeCustomerId: "cus_2",
        stripeSubscriptionId: "sub_2",
        subscriptionStatus: "active",
      },
    });
    subscriptions.value.set("sub_1", {
      id: "sub_1",
      status: "canceled",
      trial_end: null,
      items: { data: [{ current_period_end: 1790000000 }] },
    });

    await handleStripeEvent({
      id: "evt_4",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1" } },
    } as never);

    expect(
      (await prisma.org.findUniqueOrThrow({ where: { id: mine.id } })).subscriptionStatus,
    ).toBe("canceled");
    expect(
      (await prisma.org.findUniqueOrThrow({ where: { id: theirs.id } })).subscriptionStatus,
    ).toBe("active");
  });

  it("ignores a subscription that belongs to no org here", async () => {
    subscriptions.value.set("sub_9", {
      id: "sub_9",
      status: "active",
      trial_end: null,
      items: { data: [{ current_period_end: 1790000000 }] },
    });

    await expect(
      handleStripeEvent({
        id: "evt_5",
        type: "customer.subscription.updated",
        data: { object: { id: "sub_9" } },
      } as never),
    ).resolves.toBeUndefined();
  });
});

describe("signature verification", () => {
  it("rejects a forged body and writes nothing", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_ID = "price_x";
    process.env.APP_URL = "https://app.example.com";

    const pending = await makePendingSignup({ email: "forged@example.com" });
    const { POST } = await import("@/app/api/stripe/webhook/route");

    const body = JSON.stringify({
      id: "evt_forged",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_forged",
          client_reference_id: pending.id,
          customer: "cus_x",
          subscription: "sub_1",
        },
      },
    });

    const response = await POST(
      new Request("https://app.example.com/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
        body,
      }),
    );

    expect(response.status).toBe(400);
    // The forged event must not have created a tenant on this server.
    expect(await prisma.org.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a request with no signature header at all", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(
      new Request("https://app.example.com/api/stripe/webhook", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
  });
});
