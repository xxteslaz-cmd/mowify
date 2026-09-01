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
    {
      url: `${base}/pricing`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    // Low priority rather than omitted: nobody searches for these, but a
    // published policy that search engines can confirm exists is part of what
    // makes a paid product look legitimate to someone deciding whether to
    // enter a card.
    {
      url: `${base}/terms`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/privacy`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
