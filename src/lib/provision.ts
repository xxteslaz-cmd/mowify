import "server-only";
import { Prisma } from "@prisma/client";
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

/**
 * Creates a company and its owner together, or neither.
 *
 * Lives here rather than in the signup action because the Stripe webhook is
 * now what calls it — signup itself no longer creates an account.
 */
export async function createOrgWithOwner(input: {
  companyName: string;
  name: string;
  email: string;
  passwordHash: string;
}): Promise<ProvisionResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const slug = await uniqueSlug(input.companyName, async (candidate) => {
      return (await prisma.org.count({ where: { slug: candidate } })) > 0;
    });

    try {
      const user = await prisma.$transaction(async (tx) => {
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
      });
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
