import type { Metadata } from "next";
import LandingPage from "./LandingPage";

// The landing page is the one result most searches will show, so its title says
// what the product is rather than just its name. absolute skips the layout's
// "%s · GroundsRoute" template, which would repeat the name.
export const metadata: Metadata = {
  title: {
    absolute: "GroundsRoute — Crew scheduling for landscaping companies",
  },
  alternates: { canonical: "/" },
};

/**
 * Prerendered, and served only to requests with no session cookie. Anyone
 * with one is rewritten by src/proxy.ts to ./home/page.tsx, which reads the
 * session and sends owners and crews on to where they belong. Reading the
 * session here instead would make this page render on every request.
 */
export default function Home() {
  return <LandingPage />;
}
