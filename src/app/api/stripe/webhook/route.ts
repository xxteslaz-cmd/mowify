import { getStripe } from "@/lib/stripe/client";
import { stripeConfig } from "@/lib/stripe/config";
import { handleStripeEvent } from "@/lib/stripe/handle-event";

/**
 * The only route that creates companies or writes subscription state.
 *
 * Signature verification is not a formality here. This endpoint provisions a
 * tenant, so an unverified body is not merely a free subscription — it is
 * anyone granting themselves a company on this server.
 */
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  // The raw text, never a parsed body: the signature covers the exact bytes
  // Stripe sent, and re-serialising JSON changes them.
  const body = await request.text();

  // Resolved before the verification try block, so a missing STRIPE_* variable
  // cannot be reported as "Stripe sent us a bad signature". That 400 pointed
  // an operator at Stripe's dashboard instead of their own environment, and
  // Stripe only retries for about three days — every signup misdiagnosed
  // inside that window is lost for good. A 500 says what this actually is:
  // a fixable condition on our side.
  let stripe;
  let webhookSecret;
  try {
    stripe = getStripe();
    webhookSecret = stripeConfig().webhookSecret;
  } catch (err) {
    console.error(
      "Stripe webhook not configured:",
      err instanceof Error ? err.message : String(err),
    );
    return new Response("Billing not configured", { status: 500 });
  }

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error(
      "Stripe webhook rejected:",
      err instanceof Error ? err.message : String(err),
    );
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    // A 500 makes Stripe retry, which is what we want for a transient database
    // problem. Anything permanent has already been handled and returned above.
    console.error(
      "Stripe webhook failed:",
      event.type,
      err instanceof Error ? err.message : String(err),
    );
    return new Response("Handler error", { status: 500 });
  }

  return new Response(null, { status: 200 });
}
