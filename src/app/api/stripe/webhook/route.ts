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

  let event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      body,
      signature,
      stripeConfig().webhookSecret,
    );
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
