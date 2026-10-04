import { describe, expect, it } from "vitest";
import { scrubAnalyticsUrl } from "./analytics";

describe("scrubAnalyticsUrl", () => {
  it("drops every route that carries a token", () => {
    for (const path of [
      "/reset-password/abc123",
      "/verify-email/abc123",
      "/account/change-email/abc123",
    ]) {
      expect(scrubAnalyticsUrl(`https://groundsroute.com${path}`)).toBeNull();
    }
  });

  it("keeps utm tags and strips every other query parameter", () => {
    expect(
      scrubAnalyticsUrl(
        "https://groundsroute.com/billing/return?session_id=cs_secret&utm_source=reddit#x",
      ),
    ).toBe("https://groundsroute.com/billing/return?utm_source=reddit");
  });

  it("leaves an ordinary page alone", () => {
    expect(scrubAnalyticsUrl("https://groundsroute.com/pricing")).toBe(
      "https://groundsroute.com/pricing",
    );
  });
});
