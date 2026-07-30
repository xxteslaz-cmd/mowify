import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner } from "@/test/factories";
import {
  issueToken,
  consumeToken,
  isWithinCooldown,
  tokenLifetime,
  RESET_TOKEN_MS,
  VERIFICATION_TOKEN_MS,
} from "./token";

async function owner() {
  const org = await makeOrg();
  return makeOwner(org.id);
}

describe("tokenLifetime", () => {
  it("gives a reset token one hour and a verification token seven days", () => {
    // A reset token is a live credential sitting in an inbox; a verification
    // token proves nothing dangerous, so it can be generous.
    expect(tokenLifetime("PASSWORD_RESET")).toBe(RESET_TOKEN_MS);
    expect(tokenLifetime("EMAIL_VERIFICATION")).toBe(VERIFICATION_TOKEN_MS);
    expect(RESET_TOKEN_MS).toBeLessThan(VERIFICATION_TOKEN_MS);
  });
});

describe("issueToken", () => {
  it("returns a raw token that is not what gets stored", async () => {
    const user = await owner();
    const raw = await issueToken(user.id, "PASSWORD_RESET");
    const row = await prisma.token.findFirstOrThrow({ where: { userId: user.id } });
    expect(raw.length).toBeGreaterThan(20);
    expect(row.tokenHash).not.toBe(raw);
    expect(row.tokenHash).not.toContain(raw);
  });

  it("supersedes prior unconsumed tokens of the same purpose", async () => {
    const user = await owner();
    const first = await issueToken(user.id, "PASSWORD_RESET");
    await issueToken(user.id, "PASSWORD_RESET");
    // The older emailed link must stop working the moment a new one is sent.
    expect(await consumeToken(first, "PASSWORD_RESET")).toBeNull();
  });

  it("does not supersede tokens of a different purpose", async () => {
    const user = await owner();
    const verify = await issueToken(user.id, "EMAIL_VERIFICATION");
    await issueToken(user.id, "PASSWORD_RESET");
    expect(await consumeToken(verify, "EMAIL_VERIFICATION")).not.toBeNull();
  });
});

describe("consumeToken", () => {
  it("returns the user for a valid token", async () => {
    const user = await owner();
    const raw = await issueToken(user.id, "PASSWORD_RESET");
    expect(await consumeToken(raw, "PASSWORD_RESET")).toEqual({ userId: user.id });
  });

  it("rejects a token on its second use", async () => {
    // Single use is the entire security model: an emailed link can be
    // forwarded or sit in a mailbox indefinitely.
    const user = await owner();
    const raw = await issueToken(user.id, "PASSWORD_RESET");
    await consumeToken(raw, "PASSWORD_RESET");
    expect(await consumeToken(raw, "PASSWORD_RESET")).toBeNull();
  });

  it("lets only one of many simultaneous redemptions succeed", async () => {
    const user = await owner();
    const raw = await issueToken(user.id, "PASSWORD_RESET");

    // The claim step re-filters on consumedAt inside the update, which is what
    // makes redemption atomic. Sequential reuse is caught by the initial
    // lookup, so only a concurrent race reaches this guard — without it, every
    // one of these calls would succeed and a forwarded link could be redeemed
    // repeatedly.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeToken(raw, "PASSWORD_RESET")),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(19);
  });

  it("rejects an expired token", async () => {
    const user = await owner();
    const raw = await issueToken(user.id, "PASSWORD_RESET");
    await prisma.token.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await consumeToken(raw, "PASSWORD_RESET")).toBeNull();
  });

  it("rejects a token used for the wrong purpose", async () => {
    // If purpose were dropped from the lookup, a 7-day verification token
    // would silently become a password-reset token.
    const user = await owner();
    const verify = await issueToken(user.id, "EMAIL_VERIFICATION");
    expect(await consumeToken(verify, "PASSWORD_RESET")).toBeNull();

    const reset = await issueToken(user.id, "PASSWORD_RESET");
    expect(await consumeToken(reset, "EMAIL_VERIFICATION")).toBeNull();
  });

  it("rejects a garbage token without throwing", async () => {
    expect(await consumeToken("not-a-real-token", "PASSWORD_RESET")).toBeNull();
  });
});

describe("isWithinCooldown", () => {
  it("is false when no token was ever issued", async () => {
    const user = await owner();
    expect(await isWithinCooldown(user.id, "PASSWORD_RESET")).toBe(false);
  });

  it("is true immediately after issuing", async () => {
    const user = await owner();
    await issueToken(user.id, "PASSWORD_RESET");
    expect(await isWithinCooldown(user.id, "PASSWORD_RESET")).toBe(true);
  });

  it("is false once the cooldown has passed", async () => {
    const user = await owner();
    await issueToken(user.id, "PASSWORD_RESET");
    await prisma.token.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    expect(await isWithinCooldown(user.id, "PASSWORD_RESET")).toBe(false);
  });

  it("is scoped per purpose, so one purpose's cooldown does not throttle another", async () => {
    const user = await owner();
    await issueToken(user.id, "PASSWORD_RESET");
    expect(await isWithinCooldown(user.id, "EMAIL_CHANGE")).toBe(false);
  });
});
