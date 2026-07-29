import Link from "next/link";
import { findValidToken } from "@/lib/auth/token";
import ResetPasswordForm from "./ResetPasswordForm";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Checked without consuming, so rendering the form does not burn the token.
  // Unknown, expired and already-used all render the same page, so this cannot
  // be used to probe which tokens are real.
  const valid = await findValidToken(token, "PASSWORD_RESET");

  if (!valid) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="mb-1 text-xl font-semibold">This link has expired</h1>
        <p className="mb-6 text-sm text-black/60 dark:text-white/60">
          Reset links work once and last an hour.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block rounded-lg bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-xl font-semibold">Choose a new password</h1>
      <ResetPasswordForm token={token} />
    </div>
  );
}
