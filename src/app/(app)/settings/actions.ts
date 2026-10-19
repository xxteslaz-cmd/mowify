"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { lookupZip } from "@/lib/weather";

export type SettingsResult = { ok: true } | { error: string };

// A Server Action's parameter type is erased at runtime, so the value that
// reaches Prisma must be checked against the enum rather than trusted.
const ModeSchema = z.enum(["CREW", "EMPLOYEE"]);

/**
 * requireOwner and not requireActiveOrg: this is a display preference, not
 * company administration, and locking a lapsed company out of its own
 * settings serves nobody. Creating people and logins stays gated.
 */
export async function updateAssigneeMode(
  mode: unknown,
): Promise<SettingsResult> {
  const { orgId } = await requireOwner();

  const parsed = ModeSchema.safeParse(mode);
  if (!parsed.success) return { error: "Pick a valid option." };

  await prisma.org.update({
    where: { id: orgId },
    data: { assigneeMode: parsed.data },
  });

  // Every screen that names the assignee re-renders with the new wording.
  revalidatePath("/", "layout");

  return { ok: true };
}

/**
 * Saves where rain forecasts come from. An empty value turns the banner off.
 * Coordinates are looked up here, once, so the dashboard never has to.
 */
export async function updateWeatherZip(
  zip: unknown,
): Promise<{ ok: true; place: string | null } | { error: string }> {
  const { orgId } = await requireOwner();
  if (typeof zip !== "string") return { error: "Enter a 5-digit ZIP code." };
  const trimmed = zip.trim();

  if (trimmed === "") {
    await prisma.org.update({
      where: { id: orgId },
      data: { weatherZip: null, weatherLat: null, weatherLon: null, weatherPlace: null },
    });
    revalidatePath("/dashboard");
    return { ok: true, place: null };
  }

  if (!/^\d{5}$/.test(trimmed)) return { error: "Enter a 5-digit ZIP code." };
  const found = await lookupZip(trimmed);
  if (!found) return { error: "We couldn't find that ZIP code." };

  await prisma.org.update({
    where: { id: orgId },
    data: { weatherZip: trimmed, weatherLat: found.lat, weatherLon: found.lon, weatherPlace: found.place },
  });
  revalidatePath("/dashboard");
  return { ok: true, place: found.place };
}
