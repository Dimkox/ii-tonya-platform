import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresConsentEvidenceRepository } from "../../packages/db/src/repositories/consent-evidence-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  await db.migrate();
}, 180_000);
beforeEach(async () => {
  await db.reset();
  await db.db.execute(sql`truncate consent_document_versions cascade`);
});
afterAll(async () => db?.stop(), 60_000);
const repo = () =>
  new PostgresConsentEvidenceRepository(db.db, {
    consentMutationCapability: { enabled: true },
  });
const doc = () =>
  repo().approveDocumentVersion({
    documentKey: "consent.client_profile",
    title: "Exact title",
    body: "Exact <body>\nSecond line",
    approvedBy: "synthetic-reviewer",
  });
const present = (userId: string) =>
  repo().issuePresentation({
    userId,
    purpose: "client_profile",
    channel: "web",
    documentKey: "consent.client_profile",
  });
const decide = (
  userId: string,
  token: string,
  policyVersion = "profile-v1",
  decision: "granted" | "denied" = "granted",
) =>
  repo().recordDecision({
    userId,
    token,
    purpose: "client_profile",
    policyVersion,
    decision,
    correlationId: "synthetic",
  });

it("returns the exact immutable approved document without granting", async () => {
  const userId = await db.createUser();
  const document = await doc();
  const presentation = await present(userId);
  expect(presentation).toMatchObject({
    document: {
      id: document.id,
      title: "Exact title",
      body: "Exact <body>\nSecond line",
      version: 1,
      textSha256: document.textSha256,
    },
    policyVersion: "profile-v1",
  });
  expect(
    await repo().currentState({ userId, purpose: "client_profile" }),
  ).toBeNull();
});

it("rejects a caller policy version and stale approved presentations", async () => {
  const userId = await db.createUser();
  await doc();
  const presentation = await present(userId);
  await expect(
    decide(userId, presentation.token, "attacker-v9"),
  ).rejects.toMatchObject({ code: "consent_presentation_invalid" });
  await doc();
  await expect(decide(userId, presentation.token)).rejects.toMatchObject({
    code: "consent_presentation_invalid",
  });
  expect(
    await repo().currentState({ userId, purpose: "client_profile" }),
  ).toBeNull();
});

it("cannot present another purpose's document or a future or retired document", async () => {
  const userId = await db.createUser();
  await expect(
    repo().issuePresentation({
      userId,
      purpose: "follow_up",
      channel: "web",
      documentKey: "consent.client_profile",
    }),
  ).rejects.toBeDefined();
  await db.db.execute(
    sql`insert into consent_document_versions(document_key,version,title,body,text_sha256,status,effective_at,approved_at,approved_by) values ('consent.client_profile',1,'Future','Future',encode(digest('Future','sha256'),'hex'),'approved',now()+interval '1 day',now(),'synthetic')`,
  );
  await expect(present(userId)).rejects.toBeDefined();
});

it("denial cannot replace an active grant; wrong subject and replay fail", async () => {
  const userId = await db.createUser();
  const other = await db.createUser();
  await doc();
  const presentation = await present(userId);
  await expect(decide(other, presentation.token)).rejects.toBeDefined();
  await decide(userId, presentation.token);
  await expect(decide(userId, presentation.token)).rejects.toBeDefined();
  const next = await present(userId);
  await expect(
    decide(userId, next.token, "profile-v1", "denied"),
  ).rejects.toMatchObject({ code: "consent_withdrawal_required" });
  expect(
    await repo().currentState({ userId, purpose: "client_profile" }),
  ).toMatchObject({ decision: "granted" });
});
