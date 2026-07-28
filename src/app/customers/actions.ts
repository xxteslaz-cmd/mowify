"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/dal";

export async function createCustomer(input: {
  name: string;
  address: string;
  phone?: string;
  notes?: string;
}) {
  const { orgId } = await requireOwner();
  const customer = await prisma.customer.create({ data: { ...input, orgId } });
  revalidatePath("/customers");
  return customer;
}

export async function updateCustomer(
  id: string,
  input: { name: string; address: string; phone?: string; notes?: string },
) {
  const { orgId } = await requireOwner();
  // updateMany rather than update: it takes a non-unique where clause, so a
  // customer id from another company matches zero rows instead of updating it.
  await prisma.customer.updateMany({ where: { id, orgId }, data: input });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}
