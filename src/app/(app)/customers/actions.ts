"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/dal";

// A Server Action is a public HTTP endpoint, reachable with any request body
// a caller cares to send — not only from this file's own form. The `input`
// parameter's TypeScript type is erased at compile time and enforces nothing
// at runtime, so a POST here could just as easily carry an `orgId` field,
// which Prisma's generated update-many input type happily accepts. Parsing
// against an explicit allowlist, then passing only the PARSED object to
// Prisma, is what actually stops that: .strict() rejects any key outside
// this list (including `orgId`, or a nested `jobs: { connect: [...] }`)
// instead of silently dropping it, so a probing request fails loudly.
const CustomerInput = z
  .object({
    name: z.string().trim().min(1, "Enter a name"),
    address: z.string().trim().min(1, "Enter an address"),
    phone: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  })
  .strict();

export async function createCustomer(input: {
  name: string;
  address: string;
  phone?: string;
  notes?: string;
}) {
  const { orgId } = await requireOwner();
  const parsed = CustomerInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const customer = await prisma.customer.create({ data: { ...parsed.data, orgId } });
  revalidatePath("/customers");
  return customer;
}

export async function updateCustomer(
  id: string,
  input: { name: string; address: string; phone?: string; notes?: string },
) {
  const { orgId } = await requireOwner();
  const parsed = CustomerInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  // updateMany rather than update: it takes a non-unique where clause, so a
  // customer id from another company matches zero rows instead of updating it.
  await prisma.customer.updateMany({ where: { id, orgId }, data: parsed.data });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}
