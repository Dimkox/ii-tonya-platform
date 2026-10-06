import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresConsentEvidenceRepository } from "../../packages/db/src/repositories/consent-evidence-repository.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  expect((await db.db.execute(sql`show server_version_num`)).rows[0]).toEqual({
    server_version_num: "170005",
  });
  await db.migrate();
}, 180_000);
afterAll(async () => db?.stop(), 60_000);

it("exports the owner's original document after replacement and withdrawal, never another owner's document", async () => {
  const owner = await db.createUser();
  const other = await db.createUser();
  const evidence = new PostgresConsentEvidenceRepository(db.db, {
    consentMutationCapability: { enabled: true },
  });
  const privacy = new PostgresPrivacyRepository(db.db, {
    privacyMutationCapability: { enabled: true },
  });
  const original = await evidence.approveDocumentVersion({
    documentKey: "consent.client_profile",
    title: "Original",
    body: "Original exact body\nSecond line",
    approvedBy: "synthetic",
  });
  const presentation = await evidence.issuePresentation({
    userId: owner,
    purpose: "client_profile",
    channel: "web",
    documentKey: "consent.client_profile",
  });
  await evidence.recordDecision({
    userId: owner,
    token: presentation.token,
    purpose: "client_profile",
    policyVersion: presentation.policyVersion,
    decision: "granted",
    correlationId: "original-export",
  });
  await evidence.approveDocumentVersion({
    documentKey: "consent.client_profile",
    title: "Replacement",
    body: "Other user's accepted version",
    approvedBy: "synthetic",
  });
  const later = await evidence.issuePresentation({
    userId: other,
    purpose: "client_profile",
    channel: "web",
    documentKey: "consent.client_profile",
  });
  await evidence.recordDecision({
    userId: other,
    token: later.token,
    purpose: "client_profile",
    policyVersion: later.policyVersion,
    decision: "granted",
    correlationId: "other-export",
  });
  await privacy.withdrawConsentAtomically({
    targetUserId: owner,
    purpose: "client_profile",
    policyVersion: presentation.policyVersion,
    correlationId: "withdraw-export",
  });
  const result = await privacy.exportOwnedSubject(owner);
  expect(result.consents).toHaveLength(2);
  expect(result.consents.find((c) => c.decision === "granted")).toMatchObject({
    document: original,
  });
  expect(JSON.stringify(result)).not.toContain("Other user's accepted version");
  expect(result.consents.some((c) => c.decision === "revoked")).toBe(true);
  expect(result.consents.find((c) => c.decision === "revoked")).toMatchObject({
    purpose: "client_profile",
    policyVersion: presentation.policyVersion,
    document: null,
  });
});

it("does not invent a document for a legacy decision", async () => {
  const userId = await db.createUser();
  await db.db.execute(
    sql`insert into consents(user_id,consent_type,decision,policy_version) values (${userId}::uuid,'client_profile','granted','legacy-v1')`,
  );
  const result = await new PostgresPrivacyRepository(db.db).exportOwnedSubject(
    userId,
  );
  expect(result.consents).toHaveLength(1);
  expect(result.consents[0]).toMatchObject({
    policyVersion: "legacy-v1",
    document: null,
  });
});
