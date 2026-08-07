"use server";

import { randomBytes } from "crypto";
import { z } from "zod";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/session";
import { CLAIM_COOKIE, CLAIM_TTL_MS, SWEEP_GRACE_MS } from "@/lib/auth/claim-cookie";
import { getStripe } from "@/lib/stripe/client";
import { stripeConfig } from "@/lib/stripe/config";
import { requireAppUrl } from "@/lib/url";

export type SignupFormState =
  | { errors?: Record<string, string>; error?: string }
  | undefined;

const SignupSchema = z.object({
  // trim() must run before min(1): otherwise an all-whitespace value passes
  // the length check on the untrimmed string, then gets trimmed down to "".
  name: z.string().trim().min(1, "Enter your name"),
  companyName: z.string().trim().min(1, "Enter your company name"),
  email: z.string().email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(8, "Use at least 8 characters"),
});

export async function signup(
  _state: SignupFormState,
  formData: FormData,
): Promise<SignupFormState> {
  const parsed = SignupSchema.safeParse({
    name: formData.get("name"),
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      errors[key] ??= issue.message;
    }
    return { errors };
  }

  const { name, companyName, email, password } = parsed.data;

  const taken = await prisma.user.findUnique({ where: { email } });
  if (taken) {
    return { errors: { email: "That email is already registered." } };
  }

  // Sweeping here rather than on a schedule keeps abandoned signups from
  // accumulating without adding cron infrastructure this project does not have.
  //
  // The threshold is expiry plus Stripe's webhook retry window, not expiry
  // alone. Checkout's twenty-four-hour session lifetime is the wrong thing to
  // measure against: what decides whether a payment can still arrive for a row
  // is how long Stripe keeps retrying delivery, and that clock starts when the
  // customer completes checkout. Deleting a row mid-retry leaves someone with a
  // live subscription and no account.
  await prisma.pendingSignup.deleteMany({
    where: {
      consumedAt: null,
      expiresAt: { lt: new Date(Date.now() - SWEEP_GRACE_MS) },
    },
  });

  const passwordHash = await hashSecret(password);
  const claim = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);

  // Create, never upsert. A row is owned by the browser that started it and is
  // never rewritten by a later request: reusing a row keyed on email let an
  // unauthenticated caller overwrite the passwordHash and claimHash of a signup
  // that was mid-payment, because the "already registered" guard above cannot
  // fire while the User still does not exist. A retry simply makes its own row.
  //
  // Two rows for one email is fine. Whichever checkout completes first wins,
  // and the second is rejected at provisioning time by createOrgWithOwner's
  // "email-taken" result, which the webhook turns into a cancelled
  // subscription. That is the only place the uniqueness actually matters.
  let pending;
  try {
    pending = await prisma.pendingSignup.create({
      data: {
        email,
        name,
        companyName,
        passwordHash,
        claimHash: hashToken(claim),
        expiresAt,
      },
    });
  } catch (err) {
    console.error(
      "Pending signup not recorded:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: "Something went wrong. Please try again." };
  }

  let checkoutUrl: string | null;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: stripeConfig().priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 30 },
      // A card is required before the trial starts. Without this Stripe skips
      // payment collection for a fully discounted first period.
      payment_method_collection: "always",
      customer_email: email,
      client_reference_id: pending.id,
      success_url: `${requireAppUrl()}/billing/return`,
      cancel_url: `${requireAppUrl()}/signup?canceled=1`,
    });
    checkoutUrl = session.url;

    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: { checkoutSessionId: session.id },
    });
  } catch (err) {
    // Returned, not thrown: production React redacts a thrown Server Action
    // message and shows boilerplate instead.
    console.error(
      "Checkout session not created:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: "We could not start checkout. Please try again." };
  }

  if (!checkoutUrl) {
    return { error: "We could not start checkout. Please try again." };
  }

  const cookieStore = await cookies();
  cookieStore.set(CLAIM_COOKIE, claim, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax rather than Strict: the visitor arrives back at /billing/return via
    // a top-level navigation from Stripe, and a Strict cookie is withheld on
    // exactly that kind of cross-site redirect.
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  redirect(checkoutUrl);
}
