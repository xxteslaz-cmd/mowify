import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import ForgotPasswordForm from "./ForgotPasswordForm";

export default async function ForgotPasswordPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">Reset your password</h1>
      <p className="mb-6 text-sm text-muted">
        We&apos;ll email you a link to choose a new one.
      </p>

      <ForgotPasswordForm />

      <p className="mt-6 text-sm text-muted">
        <Link href="/login" className="underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
