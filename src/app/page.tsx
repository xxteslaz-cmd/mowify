import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CREW" && user.crewId) {
    redirect(`/crew/${user.crewId}/today`);
  }
  redirect("/dashboard");
}
