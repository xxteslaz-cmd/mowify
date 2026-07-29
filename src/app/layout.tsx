import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { getSessionUser } from "@/lib/auth/dal";
import MainNav from "@/components/MainNav";
import UserMenu from "@/components/UserMenu";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-black/10 dark:border-white/10">
          {/* Fixed height so nothing shifts once the nav resolves. */}
          <Suspense fallback={<div className="h-[49px]" />}>
            <Nav />
          </Suspense>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
