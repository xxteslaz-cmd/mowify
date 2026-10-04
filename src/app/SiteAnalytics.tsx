"use client";

import { Analytics } from "@vercel/analytics/next";
import { scrubAnalyticsUrl } from "@/lib/analytics";

// A client component only because beforeSend is a function, which the root
// layout (a server component) cannot pass down as a prop.
export default function SiteAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        const url = scrubAnalyticsUrl(event.url);
        return url ? { ...event, url } : null;
      }}
    />
  );
}
