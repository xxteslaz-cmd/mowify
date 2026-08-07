import { describe, it, expect, afterEach } from "vitest";
import { stripeConfig } from "@/lib/stripe/config";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

function setAll() {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  process.env.STRIPE_PRICE_ID = "price_x";
  process.env.APP_URL = "https://app.example.com";
  delete process.env.STRIPE_PORTAL_RETURN_URL;
}

describe("stripeConfig", () => {
  it("reads every value", () => {
    setAll();
    const config = stripeConfig();
    expect(config.secretKey).toBe("sk_test_x");
    expect(config.webhookSecret).toBe("whsec_x");
    expect(config.priceId).toBe("price_x");
  });

  it("derives the portal return URL from APP_URL when unset", () => {
    setAll();
    expect(stripeConfig().portalReturnUrl).toBe("https://app.example.com/billing");
  });

  it("prefers an explicit portal return URL", () => {
    setAll();
    process.env.STRIPE_PORTAL_RETURN_URL = "https://other.example.com/done";
    expect(stripeConfig().portalReturnUrl).toBe("https://other.example.com/done");
  });

  it.each([
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_ID",
  ])("throws loudly when %s is missing", (key) => {
    setAll();
    delete process.env[key];
    expect(() => stripeConfig()).toThrow(new RegExp(key));
  });

  it("throws when APP_URL is missing, rather than mailing people to localhost", () => {
    setAll();
    delete process.env.APP_URL;
    expect(() => stripeConfig()).toThrow(/APP_URL/);
  });
});
