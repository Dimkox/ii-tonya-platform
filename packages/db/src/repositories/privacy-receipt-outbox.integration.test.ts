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
it("commits opaque pending revocation together with withdrawal on gateway failure", async () => {
  const user = await f.createUser(),
    token = "a".repeat(64);
  await seedClientConsent(f.db, user, "client_messaging");
  const repository = new PostgresPrivacyRepository(f.db, {
    privacyMutationCapability: { enabled: true },
    beforePrivacyReceiptDisclosure: async (tx) => {
      await tx.execute(
        sql`insert into receipt_revocation_outbox(subject_id,contact_id,token,key_version) values(${user}::uuid,${randomUUID()}::uuid,${token},'v1')`,
      );
      return new Error("gateway offline");
    },
  });
  await expect(
    repository.withdrawConsentAtomically({
      targetUserId: user,
      purpose: "client_messaging",
      policyVersion: "policy-v1",
      correlationId: randomUUID(),
    }),
  ).rejects.toThrow("receipt_disclosure_cancellation_uncertain");
  const states = await f.db.execute<{ decision: string }>(
    sql`select decision from consent_states where user_id=${user}::uuid and purpose='client_messaging'`,
  );
  expect(states.rows[0]?.decision).toBe("revoked");
  const pending = await f.db.execute(
    sql`select token from receipt_revocation_outbox where token=${token} and acknowledged_at is null`,
  );
  expect(pending.rows).toHaveLength(1);
}, 120000);
