import Link from "next/link";
import { findValidToken } from "@/lib/auth/token";
import { prisma } from "@/lib/prisma";
import ConfirmForm from "./ConfirmForm";

export default async function ChangeEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Looked up without consuming, so a mail scanner fetching this URL cannot
  // burn the link before its owner clicks it. Redemption happens in the
  // action. Unknown, expired and already-used all render the same page, so
  // this cannot be used to probe which tokens are real.
  const valid = await findValidToken(token, "EMAIL_CHANGE");

  if (!valid) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="mb-1 text-xl font-semibold">This link has expired</h1>
        <p className="mb-6 text-sm text-muted">
          Confirmation links work once and last an hour. Request a new one
          from your account page.
        </p>
        <Link href="/account" className="btn btn-primary">
          Go to account
        </Link>
      </div>
    );
  }

  // Read-only, same as the lookup above: shown only so the person confirms
  // the address they expect before submitting, never used to decide validity.
  const user = await prisma.user.findUnique({
    where: { id: valid.userId },
    select: { pendingEmail: true },
  });

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">Confirm your new email</h1>
      <p className="mb-6 text-sm text-muted">
        {user?.pendingEmail
          ? `Move this GroundsRoute account to ${user.pendingEmail}?`
          : "Confirm this email address change."}
      </p>
      <ConfirmForm token={token} />
    </div>
  );
}
