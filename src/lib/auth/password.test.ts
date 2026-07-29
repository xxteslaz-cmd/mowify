import { describe, it, expect } from "vitest";
import { hashSecret, verifySecret } from "./password";

describe("password hashing", () => {
  it("verifies a correct secret", async () => {
    const hash = await hashSecret("correct-horse-battery");
    expect(await verifySecret(hash, "correct-horse-battery")).toBe(true);
  });

  it("rejects an incorrect secret", async () => {
    const hash = await hashSecret("correct-horse-battery");
    expect(await verifySecret(hash, "wrong-password")).toBe(false);
  });

  it("verifies a numeric PIN", async () => {
    const hash = await hashSecret("481920");
    expect(await verifySecret(hash, "481920")).toBe(true);
    expect(await verifySecret(hash, "481921")).toBe(false);
  });

  it("produces a different hash for the same input each time", async () => {
    // Distinct salts mean two crew members who pick the same PIN do not share
    // a hash, so cracking one does not reveal the other.
    const a = await hashSecret("481920");
    const b = await hashSecret("481920");
    expect(a).not.toBe(b);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    expect(await verifySecret("not-a-real-hash", "anything")).toBe(false);
  });
});
