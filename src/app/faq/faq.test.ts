import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner } from "@/test/factories";

// The DAL is mocked as in src/app/actions.isolation.test.ts. requireSiteAdmin
// itself is real: it is what these tests are about.
const currentUser = vi.hoisted(() => ({
  value: null as null | {
    userId: string;
    orgId: string;
    role: "OWNER" | "CREW";
    crewId: string | null;
    name: string;
  },
}));

vi.mock("@/lib/auth/dal", () => ({
  getSessionUser: async () => currentUser.value,
  verifySession: async () => {
    if (!currentUser.value) throw new Error("redirect: /login");
    return currentUser.value;
  },
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  }),
}));

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const sendEmail = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/email/client", () => ({
  sendEmail,
  appUrl: (path: string) => `https://example.test${path}`,
}));

import { askQuestion } from "@/app/faq/actions";
import { deleteQuestion, saveQuestion } from "@/app/(app)/admin/questions/actions";
import { getPublishedQuestions, QUESTIONS_PER_HOUR } from "@/lib/faq";
import { LEGAL } from "@/lib/legal";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ask = (fields: Record<string, string>) =>
  askQuestion(undefined, form({ website: "", email: "", ...fields }));

const ADMIN_EMAIL = "admin@example.com";

async function signInAs(email: string, { verified = true } = {}) {
  const org = await makeOrg();
  const owner = await makeOwner(org.id, email);
  if (verified) {
    await prisma.user.update({
      where: { id: owner.id },
      data: { emailVerifiedAt: new Date() },
    });
  }
  currentUser.value = {
    userId: owner.id,
    orgId: org.id,
    role: "OWNER",
    crewId: null,
    name: owner.name,
  };
}

beforeEach(() => {
  currentUser.value = null;
  sendEmail.mockClear();
  revalidatePath.mockClear();
  vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("askQuestion", () => {
  it("saves the question and the optional email", async () => {
    expect(await ask({ question: "Do crews need smartphones?", email: "Pat@Example.com" }))
      .toEqual({ ok: true });
    const rows = await prisma.faqQuestion.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      question: "Do crews need smartphones?",
      email: "pat@example.com",
      published: false,
      answer: null,
    });
  });

  it("stores a blank email as no email, not as an error", async () => {
    expect(await ask({ question: "Is there a setup fee?" })).toEqual({ ok: true });
    expect((await prisma.faqQuestion.findFirstOrThrow()).email).toBeNull();
  });

  it("notifies our own address only, with none of the visitor's text", async () => {
    // Mailing the address a stranger typed is how signup once let anyone
    // drive arbitrary recipients from our sending domain.
    await ask({ question: "Hello <b>there</b> friend", email: "victim@example.com" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = (sendEmail.mock.calls[0] as unknown as [{ to: string; html: string }])[0];
    expect(sent.to).toBe(LEGAL.contactEmail);
    expect(sent.html).not.toContain("victim@example.com");
    expect(sent.html).not.toContain("there");
  });

  it("reports success to a bot that fills the honeypot, and saves nothing", async () => {
    expect(await ask({ question: "Buy cheap watches now", website: "http://spam" }))
      .toEqual({ ok: true });
    expect(await prisma.faqQuestion.count()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    [{ question: "hey" }, "too short"],
    [{ question: "x".repeat(1001) }, "too long"],
    [{ question: "A real question here", email: "not-an-email" }, "bad email"],
  ])("rejects %j (%s)", async (fields, reason) => {
    const result = await ask(fields as Record<string, string>);
    expect(result, reason).toHaveProperty("error");
    expect(await prisma.faqQuestion.count()).toBe(0);
  });

  it("ignores extra fields, so a crafted POST cannot publish itself", async () => {
    // The action reads only the fields it names, so anything else in the
    // POST never reaches Prisma.
    const fd = form({
      question: "Can I publish myself?",
      email: "",
      website: "",
      published: "true",
      answer: "Yes you can",
    });
    const result = await askQuestion(undefined, fd);
    expect(result).toEqual({ ok: true });
    const row = await prisma.faqQuestion.findFirstOrThrow();
    expect(row.published).toBe(false);
    expect(row.answer).toBeNull();
  });

  it("stops taking questions once the hourly limit is reached", async () => {
    await prisma.faqQuestion.createMany({
      data: Array.from({ length: QUESTIONS_PER_HOUR }, (_, i) => ({
        question: `Question number ${i}`,
      })),
    });
    const result = await ask({ question: "One more question?" });
    expect(result).toHaveProperty("error");
    expect(await prisma.faqQuestion.count()).toBe(QUESTIONS_PER_HOUR);
  });
});

describe("admin question actions", () => {
  async function aQuestion() {
    return prisma.faqQuestion.create({
      data: { question: "Can I export my data?", email: "pat@example.com" },
    });
  }

  const save = (fields: Record<string, string>) => saveQuestion(undefined, form(fields));

  it("lets the admin answer and publish, and refreshes /faq", async () => {
    const q = await aQuestion();
    await signInAs(ADMIN_EMAIL);

    expect(await save({ id: q.id, question: q.question, answer: "Yes, from Settings.", publish: "on" }))
      .toEqual({ ok: "Saved and published." });

    expect(await getPublishedQuestions()).toEqual([
      { question: "Can I export my data?", answer: "Yes, from Settings." },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/faq");
  });

  it("never exposes the asker's email on the public list", async () => {
    const q = await aQuestion();
    await prisma.faqQuestion.update({
      where: { id: q.id },
      data: { answer: "Yes.", published: true, answeredAt: new Date() },
    });
    expect(JSON.stringify(await getPublishedQuestions())).not.toContain("pat@example.com");
  });

  it("keeps an unpublished answer off the public list", async () => {
    const q = await aQuestion();
    await signInAs(ADMIN_EMAIL);
    await save({ id: q.id, question: q.question, answer: "Draft answer" });
    expect(await getPublishedQuestions()).toEqual([]);
  });

  it("refuses to publish a question with no answer", async () => {
    const q = await aQuestion();
    await signInAs(ADMIN_EMAIL);
    expect(await save({ id: q.id, question: q.question, answer: "", publish: "on" }))
      .toHaveProperty("error");
    expect((await prisma.faqQuestion.findUniqueOrThrow({ where: { id: q.id } })).published)
      .toBe(false);
  });

  it.each([
    ["a signed-in owner not on ADMIN_EMAILS", "someone@example.com", true],
    ["the admin's address before it is verified", ADMIN_EMAIL, false],
  ])("refuses %s", async (_label, email, verified) => {
    const q = await aQuestion();
    await signInAs(email, { verified });

    await expect(save({ id: q.id, question: q.question, answer: "Hijacked", publish: "on" }))
      .rejects.toThrow("notFound");
    await expect(deleteQuestion(form({ id: q.id }))).rejects.toThrow("notFound");

    const after = await prisma.faqQuestion.findUniqueOrThrow({ where: { id: q.id } });
    expect(after.answer).toBeNull();
    expect(after.published).toBe(false);
  });

  it("refuses everyone when ADMIN_EMAILS is unset", async () => {
    const q = await aQuestion();
    await signInAs(ADMIN_EMAIL);
    vi.stubEnv("ADMIN_EMAILS", "");
    await expect(deleteQuestion(form({ id: q.id }))).rejects.toThrow("notFound");
    expect(await prisma.faqQuestion.count()).toBe(1);
  });

  it("refuses a signed-out caller", async () => {
    const q = await aQuestion();
    await expect(deleteQuestion(form({ id: q.id }))).rejects.toThrow("redirect: /login");
    expect(await prisma.faqQuestion.count()).toBe(1);
  });

  it("lets the admin delete a question", async () => {
    const q = await aQuestion();
    await signInAs(ADMIN_EMAIL);
    await deleteQuestion(form({ id: q.id }));
    expect(await prisma.faqQuestion.count()).toBe(0);
  });
});
