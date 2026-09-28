import { describe, expect, it } from "vitest";
import { isAdminEmail } from "@/lib/auth/admin";

describe("isAdminEmail", () => {
  it("admits an address on the list, ignoring case and spacing", () => {
    expect(isAdminEmail("Owner@Example.com", "a@x.com, owner@example.com")).toBe(true);
  });

  it("refuses an address not on the list", () => {
    expect(isAdminEmail("someone@example.com", "owner@example.com")).toBe(false);
  });

  it.each([[undefined], [""], [" , "]])(
    "admits nobody when the list is %j — unset must never mean unchecked",
    (list) => {
      expect(isAdminEmail("owner@example.com", list)).toBe(false);
    },
  );

  it("refuses an account with no email, even against a list with blanks", () => {
    expect(isAdminEmail(null, "owner@example.com,")).toBe(false);
    expect(isAdminEmail("", "owner@example.com,")).toBe(false);
  });

  it("does not match on a substring", () => {
    expect(isAdminEmail("owner@example.co", "owner@example.com")).toBe(false);
  });
});
