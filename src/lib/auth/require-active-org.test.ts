import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCrewUser } from "@/test/factories";

const cookieValue = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValue.value ? { name, value: cookieValue.value } : undefined,
    set: () => {},
    delete: () => {},
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect: ${path}`);
  }),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  // getSessionUser is wrapped in React's cache(). Outside a real request there
  // is no per-request scope to bound that memoisation, so one test's user
  // could leak into the next. Passing cache() through as the identity function
  // keeps every call a fresh read.
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { requireActiveOrg } = await import("@/lib/auth/dal");
const { hashToken } = await import("@/lib/auth/session");

async function signIn(userId: string) {
  const raw = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      tokenHash: hashToken(raw),
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  cookieValue.value = raw;
}

beforeEach(() => {
  cookieValue.value = null;
});

describe("requireActiveOrg", () => {
  it("lets a trialing owner through", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: "trialing" },
    });
    const owner = await makeOwner(org.id);
    await signIn(owner.id);

    const user = await requireActiveOrg();
    expect(user.userId).toBe(owner.id);
    expect(user.orgId).toBe(org.id);
  });

  it("lets an active owner through", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: "active" },
    });
    const owner = await makeOwner(org.id);
    await signIn(owner.id);

    await expect(requireActiveOrg()).resolves.toMatchObject({ orgId: org.id });
  });

  it("sends a past_due owner to /billing", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: "past_due" },
    });
    const owner = await makeOwner(org.id);
    await signIn(owner.id);

    await expect(requireActiveOrg()).rejects.toThrow("redirect: /billing");
  });

  it("sends an org with no subscription at all to /billing", async () => {
    const org = await makeOrg();
    const owner = await makeOwner(org.id);
    await signIn(owner.id);

    await expect(requireActiveOrg()).rejects.toThrow("redirect: /billing");
  });

  it("sends a crew member to /login rather than /billing", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: "active" },
    });
    const crew = await makeCrew(org.id);
    const crewUser = await makeCrewUser(org.id, crew.id);
    await signIn(crewUser.id);

    await expect(requireActiveOrg()).rejects.toThrow("redirect: /login");
  });

  it("sends a signed-out visitor to /login", async () => {
    await expect(requireActiveOrg()).rejects.toThrow("redirect: /login");
  });
});
