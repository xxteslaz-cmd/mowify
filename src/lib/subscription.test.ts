import { describe, it, expect } from "vitest";
import { isOrgActive } from "@/lib/subscription";

describe("isOrgActive", () => {
  it("allows the two paying states", () => {
    expect(isOrgActive("trialing")).toBe(true);
    expect(isOrgActive("active")).toBe(true);
  });

  it("blocks every lapsed state", () => {
    for (const status of ["past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      expect(isOrgActive(status)).toBe(false);
    }
  });

  it("blocks an org with no subscription at all", () => {
    expect(isOrgActive(null)).toBe(false);
    expect(isOrgActive(undefined)).toBe(false);
    expect(isOrgActive("")).toBe(false);
  });
});
