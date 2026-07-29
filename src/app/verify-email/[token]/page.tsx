import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { consumeToken } from "@/lib/auth/token";

export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claimed = await consumeToken(token, "EMAIL_VERIFICATION");

  if (claimed) {
    await prisma.user.update({
      where: { id: claimed.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">
        {claimed ? "Email confirmed" : "This link has expired"}
      </h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        {claimed
          ? "You can now recover your account by email if you forget your password."
          : "Confirmation links work once and last seven days. Send a new one from your account page."}
      </p>
      <Link
        href={claimed ? "/dashboard" : "/account"}
        className="inline-block rounded-lg bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
      >
        {claimed ? "Go to dashboard" : "Go to account"}
      </Link>
    </div>
  );
}
