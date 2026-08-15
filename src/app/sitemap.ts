import type { MetadataRoute } from "next";
import { requireAppUrl } from "@/lib/url";

// Only the pages a stranger can reach and that we want found. Every other
// route is either behind a session, per-tenant, or single-use token URL —
// see the disallow list in robots.ts.
//
// /login is deliberately absent. It is public, but a sign-in form is not
// something anyone should arrive at from a search result, and listing it
// competes with the landing page for the same query.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = requireAppUrl();

  return [
    {
      url: base,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${base}/signup`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
