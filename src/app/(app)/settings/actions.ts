"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";

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
