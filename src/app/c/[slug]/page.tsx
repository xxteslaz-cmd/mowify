import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/dal";
import CrewLoginForm from "./CrewLoginForm";

// Shared by generateMetadata and the page so an unknown slug costs one query.
const findOrg = cache((slug: string) =>
  prisma.org.findUnique({
    where: { slug },
    select: { id: true, name: true },
  }),
);

// A metadata export on not-found.tsx is ignored for a nested notFound(), so
// without this an unknown slug renders the 404 under a "Crew sign in" tab.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: (await findOrg(slug)) ? "Crew sign in" : "Page not found" };
}

export default async function CrewLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const user = await getSessionUser();
  if (user) redirect("/");

  const org = await findOrg(slug);
  if (!org) notFound();

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="mb-1 text-xl font-semibold">{org.name}</h1>
      <p className="mb-6 text-sm text-muted">
        Sign in to see today&apos;s stops.
      </p>

      <CrewLoginForm orgId={org.id} />
    </div>
  );
}
