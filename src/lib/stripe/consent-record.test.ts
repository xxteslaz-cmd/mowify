import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makePendingSignup } from "@/test/factories";

const mail = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; html: string }>,
  succeed: true,
}));
const subscriptions = vi.hoisted(() => ({
  value: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/email/client", () => ({
  sendEmail: async (input: { to: string; subject: string; html: string }) => {
    if (!mail.succeed) return false;
    mail.sent.push(input);
    return true;
  },
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    subscriptions: {
      cancel: async (id: string) => ({ id, status: "canceled" }),
      retrieve: async (id: string) => {
        const sub = subscriptions.value.get(id);
        if (!sub) throw new Error(`no such subscription: ${id}`);
        return sub;
      },
    },
  }),
}));

const { handleStripeEvent } = await import("@/lib/stripe/handle-event");

function completedEvent(pendingId: string) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        client_reference_id: pendingId,
        customer: "cus_1",
        subscription: "sub_1",
      },
    },
  } as never;
}

beforeEach(() => {
  mail.sent = [];
  mail.succeed = true;
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

async function pendingWithConsent(email = "consenting@example.com") {
  const pending = await makePendingSignup({ email });
  return prisma.pendingSignup.update({
    where: { id: pending.id },
    data: {
      trialConsentAt: new Date("2026-08-31T12:00:00.000Z"),
      consentTermsVersion: "2026-08-31",
      consentDisclosure: "Your free trial lasts 30 days and costs nothing.",
    },
  });
}

describe("the durable consent record", () => {
  it("is written when provisioning succeeds", async () => {
    const pending = await pendingWithConsent();

    await handleStripeEvent(completedEvent(pending.id));

    const record = await prisma.consentRecord.findFirstOrThrow();
    expect(record.email).toBe("consenting@example.com");
    expect(record.kind).toBe("TRIAL_SUBSCRIPTION");
    expect(record.termsVersion).toBe("2026-08-31");
    expect(record.disclosure).toMatch(/30 days/);
  });

  it("expires three years after the agreement, not three years from now", async () => {
    const pending = await pendingWithConsent();

    await handleStripeEvent(completedEvent(pending.id));

    const record = await prisma.consentRecord.findFirstOrThrow();
    // Stored rather than computed, so the retention a record was taken under
    // travels with it.
    expect(record.agreedAt.toISOString()).toBe("2026-08-31T12:00:00.000Z");
    expect(record.expiresAt.toISOString()).toBe("2029-08-31T12:00:00.000Z");
  });

  it("survives the deletion of the org it describes", async () => {
    // This is the test that protects the retention promise from the deletion
    // job. The Privacy Policy says account data goes 30 days after
    // cancellation and consent proof is kept three years; a foreign key to Org
    // would make the first promise destroy the second, two years and eleven
    // months early — exactly when a disputed charge makes it the only evidence
    // that exists.
    const pending = await pendingWithConsent();
    await handleStripeEvent(completedEvent(pending.id));

    const record = await prisma.consentRecord.findFirstOrThrow();
    expect(record.orgId).not.toBeNull();

    await prisma.pendingSignup.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.org.deleteMany();

    const survivor = await prisma.consentRecord.findUnique({
      where: { id: record.id },
    });
    expect(survivor).not.toBeNull();
    // It still identifies who consented, without the rows that are now gone.
    expect(survivor?.email).toBe("consenting@example.com");
    expect(survivor?.companyName).toBeTruthy();
  });

  it("is not written when provisioning fails", async () => {
    const pending = await pendingWithConsent();
    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: { passwordHash: null },
    });

    await handleStripeEvent(completedEvent(pending.id));

    expect(await prisma.consentRecord.count()).toBe(0);
  });
});

describe("the signup acknowledgement", () => {
  it("restates the terms and the cancellation method", async () => {
    const pending = await pendingWithConsent();

    await handleStripeEvent(completedEvent(pending.id));

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("consenting@example.com");
    expect(mail.sent[0].html).toMatch(/cancel/i);
    expect(mail.sent[0].html).toMatch(/30 days/);
  });

  it("is not sent a second time when Stripe replays the event", async () => {
    const pending = await pendingWithConsent();

    await handleStripeEvent(completedEvent(pending.id));
    await handleStripeEvent(completedEvent(pending.id));

    expect(mail.sent).toHaveLength(1);
  });

  it("does not undo the account when the mail provider is down", async () => {
    const pending = await pendingWithConsent();
    mail.succeed = false;

    await handleStripeEvent(completedEvent(pending.id));

    // sendEmail never throws. A provider outage must not roll back a company
    // that has already been paid for.
    const org = await prisma.org.findFirst();
    expect(org).not.toBeNull();
    expect(await prisma.consentRecord.count()).toBe(1);
  });
});
