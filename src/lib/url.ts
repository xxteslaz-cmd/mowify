/**
 * Builds an absolute URL from the configured origin.
 *
 * Lives here rather than in the email client because ESLint restricts that
 * module to Server Actions, and the Stripe webhook route needs absolute URLs
 * too. The email client re-exports this so its existing callers are unchanged.
 */
export function appUrl(path: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/**
 * The strict form, for anywhere the localhost fallback would be a silent
 * failure rather than an inconvenience. A Stripe success_url pointing at
 * localhost sends a paying customer to their own machine and looks like
 * success from our side, which is exactly the failure APP_URL has already
 * caused once in this project.
 */
export function requireAppUrl(): string {
  const base = process.env.APP_URL;
  if (!base) {
    throw new Error(
      "APP_URL is not set. Stripe redirect URLs cannot be built without it.",
    );
  }
  return base.replace(/\/$/, "");
}
