import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
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
}, 120000);
afterAll(async () => {
  await f?.stop();
}, 120000);
it("commits the privacy withdrawal and reports uncertain gateway cancellation", async () => {
  const user = await f.createUser();
  await seedClientConsent(f.db, user, "client_messaging");
  const fence = vi.fn(async () => {
    return new Error("gateway offline");
  });
  const repository = new PostgresPrivacyRepository(f.db, {
    privacyMutationCapability: { enabled: true },
    beforePrivacyReceiptDisclosure: fence,
  });
  await expect(
    repository.withdrawConsentAtomically({
      targetUserId: user,
      purpose: "client_messaging",
      policyVersion: "policy-v1",
      correlationId: randomUUID(),
    }),
  ).rejects.toThrow("receipt_disclosure_cancellation_uncertain");
  expect(fence).toHaveBeenCalledOnce();
  const states = await f.db.execute<{ decision: string }>(
    sql`select decision from consent_states where user_id=${user}::uuid and purpose='client_messaging'`,
  );
  expect(states.rows[0]?.decision).toBe("revoked");
}, 120000);
it("commits erasure and surfaces uncertain cancellation after the locked callback", async () => {
  const user = await f.createUser(),
    fence = vi.fn(async () => {
      return new Error("gateway offline");
    });
  const processors = [
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
    beforePrivacyReceiptDisclosure: fence,
  });
  await expect(
    repository.startErasureAtomically({
      targetUserId: user,
      correlationId: "privacy-start",
      idempotencyKey: "privacy-start",
      pseudonym: `hmac:${"a".repeat(64)}`,
    }),
  ).rejects.toThrow("receipt_disclosure_cancellation_uncertain");
  expect(fence).toHaveBeenCalledOnce();
  const rows = await f.db.execute(
    sql`select id from privacy_deletion_jobs where user_id=${user}::uuid`,
  );
  expect(rows.rows).toHaveLength(1);
}, 120000);
it("holds the same subject advisory lock used by receipt capture while cancelling contacts", async () => {
  const user = await f.createUser();
  await seedClientConsent(f.db, user, "client_messaging");
  const other = await f.db.$client.connect();
  let acquired: boolean | undefined;
  try {
    const repository = new PostgresPrivacyRepository(f.db, {
      privacyMutationCapability: { enabled: true },
      beforePrivacyReceiptDisclosure: async () => {
        await other.query("begin");
        acquired = (
          await other.query<{ ok: boolean }>(
            "select pg_try_advisory_xact_lock(hashtextextended($1::uuid::text,0)) as ok",
            [user],
          )
        ).rows[0]?.ok;
        await other.query("rollback");
      },
    });
    await repository.withdrawConsentAtomically({
      targetUserId: user,
      purpose: "client_messaging",
      policyVersion: "policy-v1",
      correlationId: randomUUID(),
    });
    expect(acquired).toBe(false);
  } finally {
    await other.query("rollback");
    other.release();
  }
}, 120000);
