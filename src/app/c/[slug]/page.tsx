import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/dal";
import CrewLoginForm from "./CrewLoginForm";

export default async function CrewLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const user = await getSessionUser();
  if (user) redirect("/");

  const org = await prisma.org.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!org) notFound();

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="mb-1 text-xl font-semibold">{org.name}</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        Sign in to see today&apos;s stops.
      </p>

      <CrewLoginForm orgId={org.id} />
    </div>
  );
}
