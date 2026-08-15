import type { MetadataRoute } from "next";
import { requireAppUrl } from "@/lib/url";

// Everything a signed-in user sees is per-tenant and behind a session, so
// there is nothing for a crawler to find down these paths and no reason for
// them to appear in a search result. They are listed explicitly rather than
// relying on the redirect to /login, because a crawler that follows a
// redirect still spends the request and still indexes the destination.
//
// The token routes matter for a second reason: corporate mail scanners and
// crawlers fetching a link out of an inbox is a failure this project has
// already had once (see the peek/consume split in AGENTS.md). Keeping
// well-behaved crawlers off them entirely is a cheap second layer.
//
// /c/ is the crew login page, one per company at /c/<company-slug>. Indexing
// those would publish a directory of every customer's company slug.
const DISALLOW = [
  "/api/",
  "/account",
  "/billing",
  "/c/",
  "/crew/",
  "/customers",
  "/dashboard",
  "/forgot-password",
  "/reset-password/",
  "/team",
  "/verify-email/",
];

export default function robots(): MetadataRoute.Robots {
  // requireAppUrl rather than appUrl: a robots.txt advertising a
  // localhost sitemap is the silent-success failure mode APP_URL has caused
  // here before. Failing the build is the louder, better outcome.
  const base = requireAppUrl();

  return {
    rules: { userAgent: "*", allow: "/", disallow: DISALLOW },
    sitemap: `${base}/sitemap.xml`,
  };
}
