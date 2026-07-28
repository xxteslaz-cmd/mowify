/**
 * Turns a company name into the slug that appears in its crew login URL.
 * Kept free of database access so it can be unit-tested and reused by both
 * signup and the backfill script.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // Apostrophes should disappear rather than become a separator, so
    // "Bob's" reads as "bobs", not "bob-s".
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A name of pure punctuation would otherwise produce an empty URL segment.
  return slug || "company";
}

export async function uniqueSlug(
  name: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(name);
  if (!(await exists(base))) return base;

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
}
