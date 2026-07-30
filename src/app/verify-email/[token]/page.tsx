import Link from "next/link";
import { findValidToken } from "@/lib/auth/token";
import ConfirmForm from "./ConfirmForm";

export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Looked up without consuming, so a mail scanner fetching this URL cannot
  // burn the link before its owner clicks it. Redemption happens in the action.
  // Unknown, expired and already-used all render the same page, so this cannot
  // be used to probe which tokens are real.
  const valid = await findValidToken(token, "EMAIL_VERIFICATION");

  if (!valid) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="mb-1 text-xl font-semibold">This link has expired</h1>
        <p className="mb-6 text-sm text-muted">
          Confirmation links work once and last seven days. Send a new one from
          your account page.
        </p>
        <Link href="/account" className="btn btn-primary">
          Go to account
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">Confirm your email</h1>
      <p className="mb-6 text-sm text-muted">
        This lets you recover your account by email if you ever forget your
        password.
      </p>
      <ConfirmForm token={token} />
    </div>
  );
}
