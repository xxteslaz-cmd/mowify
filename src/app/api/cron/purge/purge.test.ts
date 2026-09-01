import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCustomer, makeJob } from "@/test/factories";
import { RETENTION } from "@/lib/legal";

const { GET } = await import("@/app/api/cron/purge/route");

const SECRET = "purge-secret-value";

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.PURGE_ENABLED = "yes";
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.PURGE_ENABLED;
});

function request(secret: string | null = SECRET) {
  return new Request("https://app.example.com/api/cron/purge", {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  });
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function makeLapsedOrg(lapsedDaysAgo: number, status = "canceled") {
  const org = await makeOrg();
  await prisma.org.update({
    where: { id: org.id },
    data: { subscriptionStatus: status, lapsedAt: daysAgo(lapsedDaysAgo) },
  });
  await makeOwner(org.id, `owner-${org.id}@example.com`);
  const crew = await makeCrew(org.id);
  const customer = await makeCustomer(org.id);
  await makeJob(org.id, crew.id, customer.id);
  return org;
}

describe("authorisation", () => {
  it("404s without the secret and deletes nothing", async () => {
    const org = await makeLapsedOrg(RETENTION.accountDays + 1);

    const res = await GET(request(null));

    expect(res.status).toBe(404);
    expect(await prisma.org.findUnique({ where: { id: org.id } })).not.toBeNull();
  });

  it("fails closed when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const org = await makeLapsedOrg(RETENTION.accountDays + 1);

    const res = await GET(request());

    expect(res.status).toBe(404);
    expect(await prisma.org.findUnique({ where: { id: org.id } })).not.toBeNull();
  });
});

describe("what gets deleted", () => {
  it("deletes a company past the retention window, and its records with it", async () => {
    const org = await makeLapsedOrg(RETENTION.accountDays + 1);

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(await prisma.org.findUnique({ where: { id: org.id } })).toBeNull();
    expect(await prisma.user.count({ where: { orgId: org.id } })).toBe(0);
    expect(await prisma.customer.count({ where: { orgId: org.id } })).toBe(0);
    expect(await prisma.job.count({ where: { orgId: org.id } })).toBe(0);
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(0);
  });

  it("leaves a company still inside the window alone", async () => {
    const org = await makeLapsedOrg(RETENTION.accountDays - 1);

    await GET(request());

    expect(await prisma.org.findUnique({ where: { id: org.id } })).not.toBeNull();
  });

  it("leaves a company that never lapsed alone", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: "active", lapsedAt: null },
    });

    await GET(request());

    expect(await prisma.org.findUnique({ where: { id: org.id } })).not.toBeNull();
  });

  it("refuses an ACTIVE company even with a stale lapsedAt", async () => {
    // The independent second condition. A bug that leaves lapsedAt set on a
    // paying company must not be enough on its own to delete their data.
    const org = await makeLapsedOrg(RETENTION.accountDays + 100, "active");

    await GET(request());

    expect(await prisma.org.findUnique({ where: { id: org.id } })).not.toBeNull();
  });

  it("refuses a TRIALING company even with a stale lapsedAt", async () => {
    const org = await makeLapsedOrg(RETENTION.accountDays + 100, "trialing");

    await GET(request());

    expect(await prisma.org.findUnique({ where: { id: org.id } })).not.toBeNull();
  });
});

describe("the kill switch and the cap", () => {
  it("deletes nothing when PURGE_ENABLED is unset, but still reports", async () => {
    delete process.env.PURGE_ENABLED;
    const org = await makeLapsedOrg(RETENTION.accountDays + 1);

    const res = await GET(request());
    const body = await res.json();

    // How this is meant to run in production until the numbers are trusted:
    // it says what it would do and does nothing.
    expect(body.enabled).toBe(false);
    expect(body.selected).toBe(1);
    expect(body.deleted).toBe(0);
    expect(await prisma.org.findUnique({ where: { id: org.id } })).not.toBeNull();
  });

  it("aborts the whole run rather than deleting above the cap", async () => {
    // 51 orgs is far more likely to be a broken query than a real wave of
    // cancellations, so the run refuses entirely rather than deleting 50.
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) {
      const org = await makeOrg(`Doomed ${i}-${Date.now()}`);
      await prisma.org.update({
        where: { id: org.id },
        data: {
          subscriptionStatus: "canceled",
          lapsedAt: daysAgo(RETENTION.accountDays + 5),
        },
      });
      ids.push(org.id);
    }

    const res = await GET(request());
    const body = await res.json();

    expect(body.aborted).toBe("cap-exceeded");
    expect(body.deleted).toBe(0);
    expect(await prisma.org.count({ where: { id: { in: ids } } })).toBe(51);
  });
});

describe("consent records are not account data", () => {
  it("survive the deletion of the company they name", async () => {
    const org = await makeLapsedOrg(RETENTION.accountDays + 1);
    await prisma.consentRecord.create({
      data: {
        orgId: org.id,
        email: "keeper@example.com",
        companyName: "Doomed Co",
        kind: "TRIAL_SUBSCRIPTION",
        termsVersion: "2026-08-31",
        disclosure: "Your free trial lasts 30 days.",
        agreedAt: new Date(),
        // Well inside its own three-year window.
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    await GET(request());

    expect(await prisma.org.findUnique({ where: { id: org.id } })).toBeNull();
    // The Privacy Policy promises both 30-day account deletion AND three-year
    // consent retention. This is where those two promises meet.
    expect(await prisma.consentRecord.count()).toBe(1);
  });

  it("are removed once past their own expiry, and not before", async () => {
    await prisma.consentRecord.create({
      data: {
        orgId: null,
        email: "expired@example.com",
        companyName: "Old Co",
        kind: "TRIAL_SUBSCRIPTION",
        termsVersion: "2020-01-01",
        disclosure: "old text",
        agreedAt: daysAgo(4000),
        expiresAt: daysAgo(1),
      },
    });
    await prisma.consentRecord.create({
      data: {
        orgId: null,
        email: "current@example.com",
        companyName: "New Co",
        kind: "TRIAL_SUBSCRIPTION",
        termsVersion: "2026-08-31",
        disclosure: "current text",
        agreedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      },
    });

    await GET(request());

    const left = await prisma.consentRecord.findMany();
    expect(left).toHaveLength(1);
    expect(left[0].email).toBe("current@example.com");
  });
});
