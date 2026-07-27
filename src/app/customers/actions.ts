"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function createCustomer(input: {
  name: string;
  address: string;
  phone?: string;
  notes?: string;
}) {
  const customer = await prisma.customer.create({ data: input });
  revalidatePath("/customers");
  return customer;
}

export async function updateCustomer(
  id: string,
  input: { name: string; address: string; phone?: string; notes?: string },
) {
  await prisma.customer.update({ where: { id }, data: input });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}
