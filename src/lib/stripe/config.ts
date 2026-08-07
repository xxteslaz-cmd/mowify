import { requireAppUrl } from "@/lib/url";

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  portalReturnUrl: string;
};

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} is not set. Billing cannot run without it — see .env.example.`,
    );
  }
  return value;
}

/**
 * Read at call time rather than at module load so a missing key surfaces as a
 * handled error on the one request that needed it, instead of crashing the
 * whole server at boot and taking the signed-in app down with it.
 */
export function stripeConfig(): StripeConfig {
  return {
    secretKey: required("STRIPE_SECRET_KEY"),
    webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
    priceId: required("STRIPE_PRICE_ID"),
    portalReturnUrl:
      process.env.STRIPE_PORTAL_RETURN_URL ?? `${requireAppUrl()}/billing`,
  };
}
