import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import { deleteAllSessionsForUser } from "@/lib/auth/session";
import LandingPage from "../LandingPage";

/**
 * The signed-in half of "/". src/proxy.ts rewrites "/" here whenever a session
 * cookie is present, so the browser still shows "/" while this renders per
 * request; everyone else gets the prerendered landing page in ../page.tsx.
 *
 * The cookie is presence only, so it can be stale. That visitor is signed out
 * as far as the DAL is concerned and gets the landing page, rendered here.
 */
export const metadata: Metadata = {
  title: {
    absolute: "GroundsRoute | Crew scheduling for landscaping companies",
  },
  alternates: { canonical: "/" },
};

export default async function SignedInHome() {
  const user = await getSessionUser();
  // Signed out is the only case that no longer redirects: everyone else
  // still follows the exact path they always did, below.
  if (!user) return <LandingPage />;
  if (user.role === "CREW" && user.crewId) {
    redirect(`/crew/${user.crewId}/today`);
  }
  if (user.role === "CREW") {
    // crewId can go null if an owner deletes the crew this login pointed at
    // (deleteCrew now blocks that while logins remain, but a row created
    // before that guard existed could still be in this state). Falling
    // through to /dashboard would hit requireOwner's redirect to /login,
    // which itself redirects a signed-in user straight back here — an
    // infinite loop. Invalidate the session row (a database write, not a
    // cookie write, so it's fine to do from a Server Component render — see
    // the same pattern in getSessionUser's expiry check) so the next hop to
    // /login sees no session and actually renders instead of bouncing again.
    await deleteAllSessionsForUser(user.userId);
    redirect("/login");
  }
  redirect("/dashboard");
}
