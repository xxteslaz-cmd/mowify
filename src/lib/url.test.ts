import { describe, it, expect, afterEach } from "vitest";
import { appUrl, requireAppUrl } from "@/lib/url";

const original = process.env.APP_URL;
afterEach(() => {
  process.env.APP_URL = original;
});

describe("appUrl", () => {
  it("joins a path onto the configured origin", () => {
    process.env.APP_URL = "https://app.example.com";
    expect(appUrl("/billing/return")).toBe("https://app.example.com/billing/return");
  });

  it("tolerates a trailing slash on the origin", () => {
    process.env.APP_URL = "https://app.example.com/";
    expect(appUrl("/billing")).toBe("https://app.example.com/billing");
  });
});

describe("requireAppUrl", () => {
  it("returns the origin when set", () => {
    process.env.APP_URL = "https://app.example.com";
    expect(requireAppUrl()).toBe("https://app.example.com");
  });

  it("throws when APP_URL is missing", () => {
    delete process.env.APP_URL;
    expect(() => requireAppUrl()).toThrow(/APP_URL/);
  });
});
