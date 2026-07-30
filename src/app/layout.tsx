import type { Metadata } from "next";
import { Suspense } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getSessionUser } from "@/lib/auth/dal";
import MainNav from "@/components/MainNav";
import UserMenu from "@/components/UserMenu";
import VerifyBanner from "@/components/VerifyBanner";
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
  title: "Mowify",
  description: "Crew scheduling for small landscaping companies",
};

// The session read lives here, not at the top of RootLayout, so awaiting it
// only delays this nested subtree — {children} keeps streaming immediately.
async function Nav() {
  const user = await getSessionUser();
  return (
    <MainNav role={user?.role ?? null}>
      <UserMenu />
    </MainNav>
  );
}

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
      <body className="min-h-full flex flex-col">
        <header className="border-b border-black/10 dark:border-white/10">
          {/* Fixed height so nothing shifts once the nav resolves. */}
          <Suspense fallback={<div className="h-[49px]" />}>
            <Nav />
          </Suspense>
        </header>
        {/* Own Suspense boundary so awaiting the verification status never
            delays the nav above it or {children} below it. */}
        <Suspense fallback={null}>
          <VerifyBanner />
        </Suspense>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
