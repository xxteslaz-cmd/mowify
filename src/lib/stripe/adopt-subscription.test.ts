import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg } from "@/test/factories";

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
  }),
}));

const { handleStripeEvent } = await import("@/lib/stripe/handle-event");

function subscriptionEvent(id: string) {
  return {
    id: "evt_sub",
    type: "customer.subscription.updated",
    data: { object: { id } },
  } as never;
}

function sub(overrides: Record<string, unknown>) {
  return {
    status: "active",
    trial_end: null,
    items: { data: [{ current_period_end: 1790000000 }] },
    ...overrides,
  };
}

beforeEach(() => {
  canceled.ids = [];
  subscriptions.value = new Map();
});

describe("resolving which org a subscription belongs to", () => {
  it("still finds the org by subscription id, the ordinary path", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: {
        stripeSubscriptionId: "sub_known",
        stripeCustomerId: "cus_known",
        subscriptionStatus: "trialing",
      },
    });
    subscriptions.value.set(
      "sub_known",
      sub({ id: "sub_known", customer: "cus_known", status: "active" }),
    );

    await handleStripeEvent(subscriptionEvent("sub_known"));

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.subscriptionStatus).toBe("active");
  });

  it("adopts a resubscribe via metadata.orgId", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: {
        stripeSubscriptionId: "sub_old",
        stripeCustomerId: "cus_1",
        subscriptionStatus: "canceled",
      },
    });
    // The old one is dead, which is why they are restarting.
    subscriptions.value.set(
      "sub_old",
      sub({ id: "sub_old", customer: "cus_1", status: "canceled" }),
    );
    subscriptions.value.set(
      "sub_new",
      sub({ id: "sub_new", customer: "cus_1", metadata: { orgId: org.id } }),
    );

    await handleStripeEvent(subscriptionEvent("sub_new"));

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.stripeSubscriptionId).toBe("sub_new");
    expect(after.subscriptionStatus).toBe("active");
    expect(canceled.ids).toEqual([]);
  });

  it("writes the customer id for a grandfathered org that had none", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: null },
    });
    subscriptions.value.set(
      "sub_first",
      sub({ id: "sub_first", customer: "cus_brand_new", metadata: { orgId: org.id } }),
    );

    await handleStripeEvent(subscriptionEvent("sub_first"));

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.stripeCustomerId).toBe("cus_brand_new");
    expect(after.stripeSubscriptionId).toBe("sub_first");
  });

  it("falls back to the customer id for a subscription made outside our flow", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { stripeCustomerId: "cus_dash", subscriptionStatus: "canceled" },
    });
    // No metadata — created from the Stripe Dashboard by hand.
    subscriptions.value.set(
      "sub_dash",
      sub({ id: "sub_dash", customer: "cus_dash" }),
    );

    await handleStripeEvent(subscriptionEvent("sub_dash"));

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.stripeSubscriptionId).toBe("sub_dash");
    expect(after.subscriptionStatus).toBe("active");
  });

  it("ignores a subscription belonging to nobody", async () => {
    subscriptions.value.set(
      "sub_orphan",
      sub({ id: "sub_orphan", customer: "cus_nobody" }),
    );

    await handleStripeEvent(subscriptionEvent("sub_orphan"));

    expect(canceled.ids).toEqual([]);
  });
});

describe("the double-subscription guard", () => {
  it("cancels the newcomer when the org already has a live subscription", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: {
        stripeSubscriptionId: "sub_live",
        stripeCustomerId: "cus_1",
        subscriptionStatus: "active",
      },
    });
    subscriptions.value.set(
      "sub_live",
      sub({ id: "sub_live", customer: "cus_1", status: "active" }),
    );
    subscriptions.value.set(
      "sub_second",
      sub({ id: "sub_second", customer: "cus_1", metadata: { orgId: org.id } }),
    );

    await handleStripeEvent(subscriptionEvent("sub_second"));

    // The customer keeps the one they already pay for, and the duplicate is
    // cancelled rather than left billing quietly alongside it.
    expect(canceled.ids).toEqual(["sub_second"]);
    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.stripeSubscriptionId).toBe("sub_live");
  });

  it("treats a trialing subscription as live for that purpose", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: {
        stripeSubscriptionId: "sub_trial",
        stripeCustomerId: "cus_1",
        subscriptionStatus: "trialing",
      },
    });
    subscriptions.value.set(
      "sub_trial",
      sub({ id: "sub_trial", customer: "cus_1", status: "trialing" }),
    );
    subscriptions.value.set(
      "sub_second",
      sub({ id: "sub_second", customer: "cus_1", metadata: { orgId: org.id } }),
    );

    await handleStripeEvent(subscriptionEvent("sub_second"));

    expect(canceled.ids).toEqual(["sub_second"]);
  });

  it("adopts the new one when the held subscription is genuinely dead", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: {
        stripeSubscriptionId: "sub_dead",
        stripeCustomerId: "cus_1",
        subscriptionStatus: "canceled",
      },
    });
    subscriptions.value.set(
      "sub_dead",
      sub({ id: "sub_dead", customer: "cus_1", status: "canceled" }),
    );
    subscriptions.value.set(
      "sub_fresh",
      sub({ id: "sub_fresh", customer: "cus_1", metadata: { orgId: org.id } }),
    );

    await handleStripeEvent(subscriptionEvent("sub_fresh"));

    expect(canceled.ids).toEqual([]);
    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.stripeSubscriptionId).toBe("sub_fresh");
  });
});

describe("the trial reminder flag", () => {
  it("is cleared when the org moves onto a different subscription", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: {
        stripeSubscriptionId: "sub_old",
        stripeCustomerId: "cus_1",
        subscriptionStatus: "canceled",
        trialReminderSentAt: new Date("2026-01-01"),
      },
    });
    subscriptions.value.set(
      "sub_old",
      sub({ id: "sub_old", customer: "cus_1", status: "canceled" }),
    );
    subscriptions.value.set(
      "sub_new",
      sub({ id: "sub_new", customer: "cus_1", metadata: { orgId: org.id } }),
    );

    await handleStripeEvent(subscriptionEvent("sub_new"));

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.trialReminderSentAt).toBeNull();
  });

  it("survives an ordinary update to the same subscription", async () => {
    // Stripe sends a great many subscription.updated events. Clearing the flag
    // on each one would re-arm the reminder and mail the same owner repeatedly.
    const org = await makeOrg();
    const sentAt = new Date("2026-01-01T00:00:00.000Z");
    await prisma.org.update({
      where: { id: org.id },
      data: {
        stripeSubscriptionId: "sub_same",
        stripeCustomerId: "cus_1",
        subscriptionStatus: "trialing",
        trialReminderSentAt: sentAt,
      },
    });
    subscriptions.value.set(
      "sub_same",
      sub({ id: "sub_same", customer: "cus_1", status: "trialing" }),
    );

    await handleStripeEvent(subscriptionEvent("sub_same"));

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.trialReminderSentAt).toEqual(sentAt);
  });
});

describe("the retention clock", () => {
  async function orgWith(status: string, lapsedAt: Date | null) {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: {
        stripeSubscriptionId: "sub_clock",
        stripeCustomerId: "cus_1",
        subscriptionStatus: status,
        lapsedAt,
      },
    });
    return org;
  }

  it("starts when an active company lapses", async () => {
    const org = await orgWith("active", null);
    subscriptions.value.set(
      "sub_clock",
      sub({ id: "sub_clock", customer: "cus_1", status: "canceled" }),
    );

    await handleStripeEvent(subscriptionEvent("sub_clock"));

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.lapsedAt).not.toBeNull();
  });

  it("does NOT restart while the company stays lapsed", async () => {
    // Stripe sends many events for a lapsed subscription. Refreshing the
    // timestamp on each would restart the 30 days every time and nothing would
    // ever be deleted.
    const original = new Date("2026-01-01T00:00:00.000Z");
    const org = await orgWith("canceled", original);
    subscriptions.value.set(
      "sub_clock",
      sub({ id: "sub_clock", customer: "cus_1", status: "canceled" }),
    );

    await handleStripeEvent(subscriptionEvent("sub_clock"));

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.lapsedAt).toEqual(original);
  });

  it("clears when the company becomes active again", async () => {
    const org = await orgWith("canceled", new Date("2026-01-01"));
    subscriptions.value.set(
      "sub_clock",
      sub({ id: "sub_clock", customer: "cus_1", status: "active" }),
    );

    await handleStripeEvent(subscriptionEvent("sub_clock"));

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.lapsedAt).toBeNull();
  });

  it("is set for a lapsed org that somehow had none recorded", async () => {
    const org = await orgWith("canceled", null);
    subscriptions.value.set(
      "sub_clock",
      sub({ id: "sub_clock", customer: "cus_1", status: "past_due" }),
    );

    await handleStripeEvent(subscriptionEvent("sub_clock"));

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.lapsedAt).not.toBeNull();
  });
});
