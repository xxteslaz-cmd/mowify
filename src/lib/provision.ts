import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { uniqueSlug } from "@/lib/auth/slug";
import { p2002Fields } from "@/lib/prisma-errors";

// uniqueSlug checks availability and the insert happens in two separate steps,
// so two companies with the same name arriving at once can both see a slug as
// free. Only one insert can win; the other hits Org.slug's unique constraint.
// Rather than weaken that constraint — it is the real backstop against
// duplicate slugs — retry with a freshly computed slug, which by then accounts
// for the row the other request just inserted.
const MAX_ATTEMPTS = 3;

export type ProvisionResult =
  | { ok: true; orgId: string; userId: string }
  | { ok: false; reason: "email-taken" | "slug-exhausted" };

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Creates a company and its owner together, or neither.
 *
 * Lives here rather than in the signup action because the Stripe webhook is
 * now what calls it — signup itself no longer creates an account.
 *
 * Accepts an optional transaction client so the webhook can run this
 * atomically alongside writing the org's billing fields and consuming the
 * PendingSignup row (see handle-event.ts). Without one, provisioning
 * committing before those follow-up writes is exactly how a retry can see
 * "email already taken" for an account it created itself moments earlier,
 * and cancel that account's own live subscription. When a transaction client
 * is supplied, each attempt writes directly through it instead of opening a
 * nested transaction — Postgres has no notion of a transaction inside a
 * transaction short of savepoints, and a failed nested attempt would leave
 * the caller's whole transaction unusable anyway. The slug-retry loop still
 * exists for that case: if a collision does occur inside an already-open
 * transaction, the retry itself fails against the now-aborted transaction,
 * the error propagates, and the caller's entire transaction rolls back
 * cleanly — safe, if less graceful than the standalone retry.
 */
export async function createOrgWithOwner(
  input: {
    companyName: string;
    name: string;
    email: string;
    passwordHash: string;
  },
  db: Db = prisma,
): Promise<ProvisionResult> {
  const ownsItsTransaction = db === prisma;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const slug = await uniqueSlug(input.companyName, async (candidate) => {
      return (await db.org.count({ where: { slug: candidate } })) > 0;
    });

    const create = async (tx: Db) => {
      const org = await tx.org.create({
        data: { name: input.companyName, slug },
      });
      return tx.user.create({
        data: {
          orgId: org.id,
          role: "OWNER",
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
        },
      });
    };

    try {
      const user = ownsItsTransaction
        ? await prisma.$transaction((tx) => create(tx))
        : await create(db);
      return { ok: true, orgId: user.orgId, userId: user.id };
    } catch (err) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== "P2002"
      ) {
        throw err;
      }

      const fields = p2002Fields(err);

      if (fields.includes("email")) {
        // Somebody else claimed this address between the caller's check and
        // this insert. The org half rolls back, so no orphaned company is left.
        return { ok: false, reason: "email-taken" };
      }

      if (!fields.includes("slug")) throw err;
    }
  }

  return { ok: false, reason: "slug-exhausted" };
}
