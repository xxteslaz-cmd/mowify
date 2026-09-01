import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";

const created = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
}));
const cookieJar = vi.hoisted(() => ({ value: new Map<string, string>() }));
const redirected = vi.hoisted(() => ({ to: null as string | null }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirected.to = url;
    throw new Error(`redirect: ${url}`);
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string) => cookieJar.value.set(name, value),
    get: (name: string) => {
      const v = cookieJar.value.get(name);
      return v ? { name, value: v } : undefined;
    },
  }),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          created.sessions.push(params);
          return { id: "cs_test_1", url: "https://checkout.stripe.test/x" };
        },
      },
    },
  }),
}));

vi.mock("@/lib/stripe/config", () => ({
  stripeConfig: () => ({
    secretKey: "sk_test_x",
    webhookSecret: "whsec_x",
    priceId: "price_x",
    portalReturnUrl: "https://app.example.com/billing",
  }),
}));

const { signup } = await import("@/app/signup/actions");

function form(overrides: Record<string, string | null> = {}) {
  const data = new FormData();
  const base: Record<string, string> = {
    name: "Dana Owner",
    companyName: "Green Acres",
    email: "dana@example.com",
    password: "correct-horse",
    trialConsent: "on",
    termsConsent: "on",
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    // null means "the browser sent nothing for this key", which is exactly
    // what an unticked checkbox does — the key is absent, not false.
    if (v !== null) data.set(k, v);
  }
  return data;
}

beforeEach(() => {
  created.sessions = [];
  cookieJar.value = new Map();
  redirected.to = null;
  process.env.APP_URL = "https://app.example.com";
});

describe("consent is enforced on the server", () => {
  it("refuses a signup with the trial box unticked", async () => {
    const result = await signup(undefined, form({ trialConsent: null }));

    expect(result).toHaveProperty("errors");
    expect((result as { errors: Record<string, string> }).errors)
      .toHaveProperty("trialConsent");
    // Nothing was recorded and Stripe was never called: the visitor cannot
    // reach a card form without having consented.
    expect(await prisma.pendingSignup.count()).toBe(0);
    expect(created.sessions).toEqual([]);
  });

  it("refuses a signup with the terms box unticked", async () => {
    const result = await signup(undefined, form({ termsConsent: null }));

    expect(result).toHaveProperty("errors");
    expect((result as { errors: Record<string, string> }).errors)
      .toHaveProperty("termsConsent");
    expect(await prisma.pendingSignup.count()).toBe(0);
    expect(created.sessions).toEqual([]);
  });

  it("refuses a forged value that is not what a ticked box sends", async () => {
    // The `required` attribute on the input is a client-side convenience a
    // crafted POST ignores. This is the check that actually holds.
    const result = await signup(undefined, form({ trialConsent: "false" }));

    expect(result).toHaveProperty("errors");
    expect(await prisma.pendingSignup.count()).toBe(0);
  });

  it("requires both boxes, not either one", async () => {
    const result = await signup(
      undefined,
      form({ trialConsent: null, termsConsent: null }),
    );

    const errors = (result as { errors: Record<string, string> }).errors;
    expect(errors).toHaveProperty("trialConsent");
    expect(errors).toHaveProperty("termsConsent");
  });
});

describe("what consent records", () => {
  it("stores the disclosure text, not merely a flag", async () => {
    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);

    const pending = await prisma.pendingSignup.findFirstOrThrow();
    expect(pending.trialConsentAt).not.toBeNull();
    expect(pending.consentTermsVersion).toBeTruthy();
    // A version string proves nothing once the words it named have been
    // edited, so the words themselves are kept.
    expect(pending.consentDisclosure).toMatch(/\$49/);
    expect(pending.consentDisclosure).toMatch(/cancel/i);
    expect(pending.consentDisclosure).toMatch(/30 days/);
  });

  it("asks Stripe for the same trial length the disclosure promised", async () => {
    await expect(signup(undefined, form())).rejects.toThrow(/redirect:/);

    const params = created.sessions[0];
    expect(params.subscription_data).toMatchObject({ trial_period_days: 30 });
    const pending = await prisma.pendingSignup.findFirstOrThrow();
    expect(pending.consentDisclosure).toMatch(/30 days/);
  });
});
