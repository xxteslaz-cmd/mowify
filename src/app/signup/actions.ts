"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { uniqueSlug } from "@/lib/auth/slug";
import { p2002Fields } from "@/lib/prisma-errors";

export type SignupFormState =
  | { errors?: Record<string, string>; error?: string }
  | undefined;

const SignupSchema = z.object({
  // trim() must run before min(1): otherwise an all-whitespace value passes
  // the length check on the untrimmed string, then gets trimmed down to "".
  name: z.string().trim().min(1, "Enter your name"),
  companyName: z.string().trim().min(1, "Enter your company name"),
  email: z.string().email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(8, "Use at least 8 characters"),
});

// uniqueSlug checks availability and signup inserts in two separate steps, so
// two people signing up with the same company name at the same moment can
// both see a slug as free and both try to claim it. Only one insert can win;
// the other hits Org.slug's unique constraint. Rather than weaken that
// constraint (it is the real backstop against duplicate slugs), retry with a
// freshly computed slug, which by then accounts for the row the other request
// just inserted. Three attempts is far more than this should ever need.
const MAX_SIGNUP_ATTEMPTS = 3;

export async function signup(
  _state: SignupFormState,
  formData: FormData,
): Promise<SignupFormState> {
  const parsed = SignupSchema.safeParse({
    name: formData.get("name"),
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      errors[key] ??= issue.message;
    }
    return { errors };
  }

  const { name, companyName, email, password } = parsed.data;

  const taken = await prisma.user.findUnique({ where: { email } });
  if (taken) {
    return { errors: { email: "That email is already registered." } };
  }

  // Hashed once outside the retry loop: the password does not change between
  // attempts, and argon2 is deliberately expensive, so redoing it per retry
  // would be pure waste.
  const passwordHash = await hashSecret(password);

  // The company and its owner are meaningless without each other, so they are
  // created together or not at all.
  let user: Awaited<ReturnType<typeof prisma.user.create>> | undefined;

  for (let attempt = 1; attempt <= MAX_SIGNUP_ATTEMPTS; attempt++) {
    const slug = await uniqueSlug(companyName, async (candidate) => {
      return (await prisma.org.count({ where: { slug: candidate } })) > 0;
    });

    try {
      user = await prisma.$transaction(async (tx) => {
        const org = await tx.org.create({ data: { name: companyName, slug } });
        return tx.user.create({
          data: {
            orgId: org.id,
            role: "OWNER",
            name,
            email,
            passwordHash,
          },
        });
      });
      break;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
        throw err;
      }

      const fields = p2002Fields(err);

      if (fields.includes("email")) {
        // A second signup for the same email landed between our lookup above
        // and this insert. The org half of the transaction rolls back, so no
        // orphaned company is left behind.
        return { errors: { email: "That email is already registered." } };
      }

      if (!fields.includes("slug")) {
        throw err;
      }

      if (attempt === MAX_SIGNUP_ATTEMPTS) {
        // Exhausted every retry and still losing the slug race — an
        // extremely unlikely pile-up of concurrent signups for the same
        // company name. Break out to the friendly fallback below instead of
        // rethrowing a raw database error with no error.tsx to catch it.
        break;
      }

      // Slug lost the race — loop again and recompute against the row that
      // just won it.
    }
  }

  if (!user) {
    // Reached only when every retry attempt lost the slug race (see the
    // `break` above) — genuinely rare, but a real path, not dead code.
    return { error: "Something went wrong. Please try again." };
  }

  // No verification email is sent here, on purpose. Signup is unauthenticated,
  // so mailing from it let anyone script an arbitrary recipient list and burn
  // the sending domain's reputation. Verification is now started from /account
  // instead, which requires a session and is rate limited. The reminder banner
  // is what prompts a new owner to do it.
  await createSession(user.id, "OWNER");
  redirect("/dashboard");
}
