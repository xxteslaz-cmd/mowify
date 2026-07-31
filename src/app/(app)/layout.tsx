import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/dal";
import MainNav from "@/components/MainNav";
import UserMenu from "@/components/UserMenu";
import VerifyBanner from "@/components/VerifyBanner";

// The session read lives here, not at the top of this layout, so awaiting it
// only delays this nested subtree — {children} keeps streaming immediately.
async function Nav() {
  const user = await getSessionUser();
  return (
    <MainNav role={user?.role ?? null}>
      <UserMenu />
    </MainNav>
  );
}

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      {/* Sized to match the resolved nav in both the top-bar and sidebar
          shapes, so nothing shifts once the session read finishes. */}
      <Suspense
        fallback={
          <>
            <div className="h-[49px] border-b border-border md:hidden" />
            <div className="hidden md:block md:h-screen md:w-60 md:shrink-0 md:border-r md:border-border md:bg-surface" />
          </>
        }
      >
        <Nav />
      </Suspense>
      {/* min-w-0 lets this column shrink below its content's intrinsic
          width instead of forcing the sidebar row onto a horizontal
          scrollbar. */}
      <div className="flex min-h-full min-w-0 flex-1 flex-col">
        {/* Own Suspense boundary so awaiting the verification status never
            delays the nav above it or {children} below it. */}
        <Suspense fallback={null}>
          <VerifyBanner />
        </Suspense>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
