import type { Metadata } from "next";
import { requireAppUrl } from "@/lib/url";
import { PRICE, TRIAL_DAYS } from "@/lib/pricing";
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
// Structured data, so a search result can show what GroundsRoute is and what
// it costs. The price and trial come from pricing.ts, like every other place
// the price appears: a search snippet quoting a stale price is the same
// contradiction that file exists to prevent.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "GroundsRoute",
  url: requireAppUrl(),
  description:
    "Crew scheduling for small landscaping companies. Build the day once on " +
    "one board, and every crew opens their phone to just their stops.",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: (PRICE.amountCents / 100).toFixed(2),
    priceCurrency: PRICE.currency,
    description: `${TRIAL_DAYS}-day free trial, then billed every ${PRICE.interval}.`,
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        // Escaping "<" stops any value from closing the script tag early. All
        // of these are constants today, but that is not a property this
        // line should depend on.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c"),
        }}
      />
      <LandingPage />
    </>
  );
}
