import { Prisma } from "@prisma/client";

// Reads the column list off a unique-constraint violation. With the query
// engine Prisma normally ships, that list lives at error.meta.target. This
// project's client is built on the @prisma/adapter-pg driver adapter (see
// src/lib/prisma.ts), and under that adapter Prisma 7.9.0 does not populate
// meta.target at all — the raw Postgres error (with its column list) is
// nested instead at meta.driverAdapterError.cause.constraint.fields.
// Confirmed empirically against this project's own database: a forced
// unique violation on Org.slug produced meta = { modelName, driverAdapterError:
// { cause: { originalCode: "23505", constraint: { fields: ["slug"] } } } },
// with no target key present. Checking target first keeps this correct if a
// future Prisma version (or a non-adapter setup) restores it.
export function p2002Fields(err: Prisma.PrismaClientKnownRequestError): string[] {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target as string[];
  if (typeof target === "string") return [target];

  const meta = err.meta as
    | { driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } }
    | undefined;
  const driverFields = meta?.driverAdapterError?.cause?.constraint?.fields;
  return Array.isArray(driverFields) ? (driverFields as string[]) : [];
}
