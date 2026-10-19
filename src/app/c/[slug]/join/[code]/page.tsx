import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import JoinForm from "./JoinForm";

export const metadata: Metadata = { title: "Join your crew" };

export default async function JoinCrewPage({
  params,
}: {
  params: Promise<{ slug: string; code: string }>;
}) {
  const { slug, code } = await params;
  const crew = await prisma.crew.findFirst({
    where: { joinCode: code, active: true, org: { slug } },
    select: { name: true, org: { select: { name: true } } },
  });
  if (!crew) notFound();

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="mb-1 text-xl font-semibold">{crew.org.name}</h1>
      <p className="mb-6 text-base">
        Join <span className="font-semibold">{crew.name}</span>. Pick a username and a 6-digit PIN you&apos;ll
        remember. Your manager approves you, then you sign in.
      </p>
      <JoinForm code={code} loginPath={`/c/${slug}`} />
    </div>
  );
}
