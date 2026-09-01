import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import { trialDisclosure, formatConversionDate } from "@/lib/consent";
import { pricePerInterval, TRIAL_DAYS } from "@/lib/pricing";
import SignupForm from "./SignupForm";

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-xl font-semibold">Create your company</h1>
      <p className="mb-1 text-sm text-muted">
        {TRIAL_DAYS} days free, then {pricePerInterval()}. Cancel any time. You
        will be asked for a card on the next step.
      </p>
      <p className="mb-6 text-sm text-muted">
        You can add logins for your crew once you are in.
      </p>

      {/* Computed here rather than in the form: the conversion date depends on
          today, and a client component would render whatever date the visitor's
          own clock says. The disclosure text is passed down from the same
          function that writes it onto the consent record, so the words shown
          and the words stored cannot drift. */}
      <SignupForm
        disclosure={trialDisclosure()}
        convertsOn={formatConversionDate()}
        price={pricePerInterval()}
      />

      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
