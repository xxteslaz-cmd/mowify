import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner } from "@/test/factories";
import { hashToken, deleteOtherSessionsForUser } from "./session";

describe("deleteOtherSessionsForUser", () => {
  it("keeps the acting session and drops the rest", async () => {
    const org = await makeOrg();
    const user = await makeOwner(org.id);
    const keep = "keep-this-token";
    const drop = "drop-this-token";
    const expiresAt = new Date(Date.now() + 60_000);

    await prisma.session.createMany({
      data: [
        { tokenHash: hashToken(keep), userId: user.id, expiresAt },
        { tokenHash: hashToken(drop), userId: user.id, expiresAt },
      ],
    });

    await deleteOtherSessionsForUser(user.id, keep);

    const rows = await prisma.session.findMany({ where: { userId: user.id } });
    // Changing your password should sign you out everywhere except the tab
    // you are currently using.
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(keep));
  });

  it("leaves other users' sessions alone", async () => {
    const org = await makeOrg();
    const a = await makeOwner(org.id);
    const b = await makeOwner(org.id);
    const expiresAt = new Date(Date.now() + 60_000);

    await prisma.session.createMany({
      data: [
        { tokenHash: hashToken("a-1"), userId: a.id, expiresAt },
        { tokenHash: hashToken("b-1"), userId: b.id, expiresAt },
      ],
    });

    await deleteOtherSessionsForUser(a.id, "a-1");

    expect(await prisma.session.count({ where: { userId: b.id } })).toBe(1);
  });
});
