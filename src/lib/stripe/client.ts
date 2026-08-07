import "server-only";
import Stripe from "stripe";
import { stripeConfig } from "./config";

let cached: Stripe | undefined;

/**
 * One Stripe instance per process. Built lazily so importing this module never
 * throws on a missing key — only actually using Stripe does.
 */
export function getStripe(): Stripe {
  if (!cached) cached = new Stripe(stripeConfig().secretKey);
  return cached;
}
