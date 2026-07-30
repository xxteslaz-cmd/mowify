import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  // Someone already signed in has no use for this page.
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">Sign in to Mowify</h1>
      <p className="mb-6 text-sm text-muted">
        For owners and office staff.
      </p>

      <LoginForm />

      <p className="mt-4 text-sm text-muted">
        <Link href="/forgot-password" className="underline underline-offset-4">
          Forgot your password?
        </Link>
      </p>

      <p className="mt-6 text-sm text-muted">
        No account yet?{" "}
        <Link href="/signup" className="underline underline-offset-4">
          Create your company
        </Link>
      </p>
    </div>
  );
}
