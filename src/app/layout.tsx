import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Plus Jakarta Sans over Geist: it keeps the geometric clarity a dense
// scheduling board needs, but its slightly humanist shapes stop the app
// reading like a developer tool.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GroundsRoute",
  description: "Crew scheduling for small landscaping companies",
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
