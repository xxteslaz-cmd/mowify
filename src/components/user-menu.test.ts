import { describe, it, expect, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/dal";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));

vi.mock("@/lib/auth/dal", () => ({
  getSessionUser: async () => session.user,
}));
vi.mock("@/app/logout/actions", () => ({ logout: async () => {} }));

const { default: UserMenu } = await import("@/components/UserMenu");

type Rendered = { props?: { href?: unknown; children?: unknown } };

/**
 * Collects every href in a rendered tree.
 *
 * There is no DOM test infrastructure in this project, but a server component
 * is only an async function returning plain objects, so walking what it
 * returned needs none.
 */
function hrefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) hrefs(child, out);
    return out;
  }
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as Rendered).props;
    if (typeof props?.href === "string") out.push(props.href);
    hrefs(props?.children, out);
  }
  return out;
}

function user(role: "OWNER" | "CREW"): SessionUser {
  return {
    userId: "u1",
    orgId: "o1",
    role,
    crewId: role === "CREW" ? "c1" : null,
    name: "Dana",
  };
}

describe("UserMenu", () => {
  it("gives an owner a way to reach billing", async () => {
    // The lapsed banner was the only link to /billing anywhere in the tree,
    // and it renders only once the subscription has already failed. A paying
    // customer in good standing could not update an expiring card, read an
    // invoice or cancel without guessing the URL.
    session.user = user("OWNER");

    expect(hrefs(await UserMenu())).toEqual(
      expect.arrayContaining(["/team", "/account", "/billing"]),
    );
  });

  it("does not offer billing to crew", async () => {
    session.user = user("CREW");

    expect(hrefs(await UserMenu())).not.toContain("/billing");
  });

  it("renders nothing when signed out", async () => {
    session.user = null;

    expect(await UserMenu()).toBeNull();
  });
});
