import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { requireAppUrl } from "@/lib/url";
import "./globals.css";

// Plus Jakarta Sans over Geist: it keeps the geometric clarity a dense
// scheduling board needs, but its slightly humanist shapes stop the app
// reading like a developer tool.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const DESCRIPTION = "Crew scheduling for small landscaping companies";

export const metadata: Metadata = {
  // requireAppUrl rather than appUrl, for the same reason robots.ts uses it:
  // without metadataBase Next resolves the Open Graph image against localhost
  // and says so only in a build log, so every shared link would carry a
  // preview image nobody outside this machine can load. That is the
  // silent-success failure APP_URL has already caused here once.
  metadataBase: new URL(requireAppUrl()),
  title: {
    default: "GroundsRoute",
    // Pages that set their own title get the product name appended, so a
    // browser tab or a bookmark still says what the app is.
    template: "%s · GroundsRoute",
  },
  description: DESCRIPTION,
  applicationName: "GroundsRoute",
  openGraph: {
    type: "website",
    siteName: "GroundsRoute",
    title: "GroundsRoute",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    // summary_large_image rather than summary: the shared card is a picture of
    // the board, which is the actual pitch, and the small variant crops it to
    // a thumbnail where nothing is legible.
    card: "summary_large_image",
    title: "GroundsRoute",
    description: DESCRIPTION,
  },
};

// The authenticated shell (sidebar nav, verify banner) lives in
// src/app/(app)/layout.tsx, not here — signed-out routes like the landing
// page, /login and /signup have no session and so no nav to show, and this
// layout wrapping them in the sidebar's flex row used to reserve its width
// as an empty column. Keeping this layout to just the html/body/font shell
// means public routes render with nothing else on the page.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
