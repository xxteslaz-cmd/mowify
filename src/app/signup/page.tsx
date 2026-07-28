import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import SignupForm from "./SignupForm";

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">Create your company</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        You can add logins for your crew once you are in.
      </p>

      <SignupForm />

      <p className="mt-6 text-sm text-black/60 dark:text-white/60">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
