import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makePendingSignup } from "@/test/factories";

describe("PendingSignup schema", () => {
  it("stores a signup awaiting payment", async () => {
    const pending = await makePendingSignup({ email: "a@example.com" });
    expect(pending.consumedAt).toBeNull();
    expect(pending.orgId).toBeNull();
    expect(pending.passwordHash).not.toBeNull();
  });

  it("allows several rows per email, so one attempt cannot overwrite another", async () => {
    const first = await makePendingSignup({ email: "dup@example.com" });
    const second = await makePendingSignup({ email: "dup@example.com" });
    // Each attempt owns its own claim. Reusing one row per email let an
    // unauthenticated request rewrite a mid-payment signup's credentials.
    expect(second.id).not.toBe(first.id);
    expect(second.claimHash).not.toBe(first.claimHash);
  });

  it("allows only one row per claim hash", async () => {
    await makePendingSignup({ email: "one@example.com", claimHash: "shared" });
    await expect(
      makePendingSignup({ email: "two@example.com", claimHash: "shared" }),
    ).rejects.toThrow();
  });

  it("defaults an org to no subscription at all", async () => {
    const org = await makeOrg();
    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.subscriptionStatus).toBeNull();
    expect(fresh.stripeCustomerId).toBeNull();
    expect(fresh.trialEndsAt).toBeNull();
  });
});
