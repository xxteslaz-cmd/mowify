import { describe, it, expect } from "vitest";
import { hashToken, sessionDuration } from "./session";

describe("session tokens", () => {
  it("hashes a token deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("does not return the token itself", () => {
    // The stored value must not be reversible to the cookie value.
    expect(hashToken("abc")).not.toContain("abc");
  });

  it("gives crew a longer session than owners", () => {
    // Crew should not have to re-enter a PIN in a truck every Monday.
    expect(sessionDuration("CREW")).toBeGreaterThan(sessionDuration("OWNER"));
    expect(sessionDuration("OWNER")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(sessionDuration("CREW")).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
