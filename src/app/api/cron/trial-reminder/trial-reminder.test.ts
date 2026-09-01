import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCrewUser } from "@/test/factories";

const mail = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; html: string }>,
  succeed: true,
}));

vi.mock("@/lib/email/client", () => ({
  sendEmail: async (input: { to: string; subject: string; html: string }) => {
    if (!mail.succeed) return false;
    mail.sent.push(input);
    return true;
  },
}));

// The route builds its link with appUrl from @/lib/url, not from the email
// client that re-exports it. Pinning the origin here keeps the assertion about
// the link independent of whatever APP_URL happens to be in the local .env.
vi.mock("@/lib/url", () => ({
  appUrl: (path: string) => `https://app.example.com${path}`,
  requireAppUrl: () => "https://app.example.com",
}));

const { GET } = await import("@/app/api/cron/trial-reminder/route");

const SECRET = "cron-secret-value";

beforeEach(() => {
  mail.sent = [];
  mail.succeed = true;
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

function request(secret: string | null = SECRET) {
  return new Request("https://app.example.com/api/cron/trial-reminder", {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  });
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function makeTrialingOrg(trialEndsInDays: number, email?: string) {
  const org = await makeOrg();
  await prisma.org.update({
    where: { id: org.id },
    data: {
      subscriptionStatus: "trialing",
      trialEndsAt: daysFromNow(trialEndsInDays),
    },
  });
  await makeOwner(org.id, email ?? `owner-${org.id}@example.com`);
  return org;
}

describe("authorisation", () => {
  it("404s without a secret, and sends nothing", async () => {
    await makeTrialingOrg(7);

    const res = await GET(request(null));

    // 404 rather than 401: a 401 confirms the route exists to whoever is
    // probing for it.
    expect(res.status).toBe(404);
    expect(mail.sent).toEqual([]);
  });

  it("404s on the wrong secret", async () => {
    await makeTrialingOrg(7);

    const res = await GET(request("not-the-secret"));

    expect(res.status).toBe(404);
    expect(mail.sent).toEqual([]);
  });

  it("404s on a secret that is merely a prefix of the real one", async () => {
    await makeTrialingOrg(7);

    const res = await GET(request(SECRET.slice(0, 5)));

    expect(res.status).toBe(404);
    expect(mail.sent).toEqual([]);
  });

  it("fails closed when CRON_SECRET is not configured at all", async () => {
    delete process.env.CRON_SECRET;
    await makeTrialingOrg(7);

    const res = await GET(request());

    // The dangerous reading of an unset secret is "no auth required", which
    // would leave this open to anyone who guesses the path precisely when the
    // environment is misconfigured.
    expect(res.status).toBe(404);
    expect(mail.sent).toEqual([]);
  });
});

describe("who gets reminded", () => {
  it("emails an owner whose trial ends inside the window", async () => {
    await makeTrialingOrg(7, "owner@example.com");

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("owner@example.com");
  });

  it("names the charge date, the amount and how to cancel", async () => {
    // All three are required content: Terms section 3 promises a reminder
    // "telling you the date the charge will occur, the amount, and how to
    // cancel". Dropping any one breaks a published promise.
    await makeTrialingOrg(7);

    await GET(request());

    const { subject, html } = mail.sent[0];
    expect(subject).toMatch(/trial/i);
    expect(html).toMatch(/\$49/);
    expect(html).toMatch(/cancel/i);
    expect(html).toMatch(/https:\/\/app\.example\.com\/billing/);
  });

  it("ignores a trial that is further out than the window", async () => {
    await makeTrialingOrg(20);

    await GET(request());

    expect(mail.sent).toEqual([]);
  });

  it("ignores a trial that has already ended", async () => {
    await makeTrialingOrg(-1);

    await GET(request());

    expect(mail.sent).toEqual([]);
  });

  it("ignores companies that are not on a trial", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: "active", trialEndsAt: daysFromNow(7) },
    });
    await makeOwner(org.id);

    await GET(request());

    expect(mail.sent).toEqual([]);
  });

  it("never mails crew, who have no email address by design", async () => {
    const org = await makeOrg();
    await prisma.org.update({
      where: { id: org.id },
      data: {
        subscriptionStatus: "trialing",
        trialEndsAt: daysFromNow(7),
      },
    });
    const crew = await makeCrew(org.id);
    await makeCrewUser(org.id, crew.id);

    await GET(request());

    expect(mail.sent).toEqual([]);
  });
});

describe("idempotence", () => {
  it("sends once across two consecutive runs", async () => {
    await makeTrialingOrg(7);

    await GET(request());
    await GET(request());

    // Cron can double-fire, overlap a deploy, or be retried. None of those may
    // mail the same owner twice.
    expect(mail.sent).toHaveLength(1);
  });

  it("records the send on the org row", async () => {
    const org = await makeTrialingOrg(7);

    await GET(request());

    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.trialReminderSentAt).not.toBeNull();
  });

  it("leaves the row unmarked when the provider fails, so tomorrow retries", async () => {
    const org = await makeTrialingOrg(7);
    mail.succeed = false;

    const res = await GET(request());

    // sendEmail never throws — it returns false, and an unset RESEND_API_KEY
    // looks exactly like a real outage. Marking the row anyway would silently
    // consume the single reminder this company gets.
    expect(res.status).toBe(200);
    const after = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.trialReminderSentAt).toBeNull();

    mail.succeed = true;
    await GET(request());
    expect(mail.sent).toHaveLength(1);
  });
});
