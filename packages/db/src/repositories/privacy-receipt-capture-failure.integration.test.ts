import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { seedClientConsent } from "../testkit/client-consent.js";
import { PostgresPrivacyRepository } from "./privacy-repository.js";
let f: ExpertReferralTestDatabase;
beforeAll(async () => {
  f = await startExpertReferralTestDatabase();
  await applyEarlyBirdDraftIfNeeded(
    f.db,
    "docs/superpowers/implementation-artifacts/drafts/receipt_revocation_outbox.sql",
  );
}, 120000);
afterAll(async () => {
  await f?.stop();
}, 120000);
it("rolls back privacy mutation when durable cancellation ticket cannot be written", async () => {
  const user = await f.createUser();
  await seedClientConsent(f.db, user, "client_messaging");
  const repository = new PostgresPrivacyRepository(f.db, {
    privacyMutationCapability: { enabled: true },
    beforePrivacyReceiptDisclosure: async (tx) => {
      await tx.execute(sql`select * from nonexistent_receipt_outbox`);
    },
  });
  await expect(
    repository.withdrawConsentAtomically({
      targetUserId: user,
      purpose: "client_messaging",
      policyVersion: "policy-v1",
      correlationId: randomUUID(),
    }),
  ).rejects.toThrow();
  const rows = await f.db.execute<{ decision: string }>(
    sql`select decision from consent_states where user_id=${user}::uuid and purpose='client_messaging'`,
  );
  expect(rows.rows[0]?.decision).toBe("granted");
}, 120000);
it("rolls back erasure and a partially inserted revocation ticket on SQL failure", async () => {
  const user = await f.createUser(),
    token = "c".repeat(64),
    processors = [
      "object_store",
      "selarti",
      "planerka",
      "make_projection",
    ] as const;
  const repository = new PostgresPrivacyRepository(f.db, {
    privacyMutationCapability: {
      enabled: true,
      captureManifests: async () =>
        processors.map((processor) => ({
          processor,
          ciphertext: "cipher",
          keyReference: "kms://test",
          algorithm: "test-envelope",
          version: "v1",
          subjectDeletionKeyHash: "d".repeat(64),
        })),
      verifyEnvelope: () => true,
    },
    beforePrivacyReceiptDisclosure: async (tx) => {
      await tx.execute(
        sql`insert into receipt_revocation_outbox(subject_id,contact_id,token,key_version) values(${user}::uuid,${randomUUID()}::uuid,${token},'v1')`,
      );
      await tx.execute(sql`select * from nonexistent_receipt_outbox`);
    },
  });
  await expect(
    repository.startErasureAtomically({
      targetUserId: user,
      correlationId: "privacy-start",
      idempotencyKey: "privacy-start",
      pseudonym: `hmac:${"a".repeat(64)}`,
    }),
  ).rejects.toThrow();
  expect(
    (
      await f.db.execute(
        sql`select id from privacy_deletion_jobs where user_id=${user}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await f.db.execute(
        sql`select token from receipt_revocation_outbox where token=${token}`,
      )
    ).rows,
  ).toHaveLength(0);
}, 120000);
