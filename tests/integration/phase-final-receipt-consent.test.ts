import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach as vitestBeforeEach,
  expect,
  it as vitestIt,
} from "vitest";
import { createAsyncCaseDrainFence } from "../support/async-case-drain.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { PostgresYooKassaReceiptContactAuthority } from "../../packages/db/src/repositories/yookassa-receipt-contact-repository.js";
import { ConsentBoundYooKassaReceiptContactSource } from "../../packages/integrations/src/yookassa/receipt-contact-source.js";
const drain = createAsyncCaseDrainFence({ drainTimeoutMs: 2000 });
const it = (name: string, body: () => Promise<void>) =>
  vitestIt(name, () => drain.run(body));
const purpose = "receipt_boundary_fixture",
  policy = "fixture-v1";
const instant = (second: number) =>
  `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
let database: ExpertReferralTestDatabase;
let tariffVersionId: string;
let userId: string, orderId: string;
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
  await database.enableExpertReferralCommands();
  tariffVersionId = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "Synthetic receipt authority",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
}, 120_000);
vitestBeforeEach(() => {
  drain.assertReady();
  return drain.run(async () => {
    const owner = await database.createExpertIdentity();
    userId = owner.userId;
    // Real canonical checkout binding; no payment, contact decryption or provider I/O.
    orderId = (
      await new PostgresExpertResidencyRepository(
        database.db,
      ).createCheckoutOrder({
        expertId: owner.expertId,
        tariffVersionId,
        providerDeadline: new Date(Date.now() + 3600000),
        idempotencyKey: randomUUID(),
      })
    ).id;
  });
}, 30_000);
afterEach(async () => {
  await drain.drain();
});
afterAll(async () => {
  await drain.drain();
  await database?.stop();
}, 120_000);
async function decision(value: "granted" | "denied", second: number) {
  const id = randomUUID();
  await database.db.execute(
    sql`insert into consents(id,user_id,consent_type,decision,policy_version,created_at) values(${id}::uuid,${userId}::uuid,${purpose},${value},${policy},${instant(second)}::timestamptz)`,
  );
  return id;
}
async function contact(consentId: string, second: number, revoked = false) {
  const id = randomUUID();
  await database.db.execute(
    sql`insert into expert_residency_receipt_contacts(id,user_id,contact_kind,ciphertext,key_reference,consent_id,consent_decision,consent_purpose,policy_version,verified_at,revoked_at,created_at) values(${id}::uuid,${userId}::uuid,'email','synthetic-ciphertext','fixture:receipt',${consentId}::uuid,'granted',${purpose},${policy},${instant(second)}::timestamptz,${revoked ? instant(second) : null}::timestamptz,${instant(second)}::timestamptz)`,
  );
  return id;
}
async function assertDenied() {
  let decryptions = 0;
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const authority = new PostgresYooKassaReceiptContactAuthority(tx);
    const source = new ConsentBoundYooKassaReceiptContactSource({
      authority,
      consentPurpose: purpose,
      policyVersion: policy,
      decryptor: {
        async decrypt() {
          decryptions++;
          throw new Error("unexpected_contact_disclosure");
        },
      },
    });
    expect(await authority.latestForOrder(orderId, purpose, policy)).toBeNull();
    expect(await source.receiptContactForOrder(orderId)).toBeNull();
  });
  expect(decryptions).toBe(0);
}
it("returns only encrypted contact evidence bound to the current grant", async () => {
  const current = await decision("granted", 1);
  const id = await contact(current, 2);
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    expect(
      await new PostgresYooKassaReceiptContactAuthority(tx).latestForOrder(
        orderId,
        purpose,
        policy,
      ),
    ).toMatchObject({
      contactId: id,
      ciphertext: "synthetic-ciphertext",
      consentDecision: "granted",
      consentPurpose: purpose,
      policyVersion: policy,
    });
  });
});
it("denies a latest-moment grant and denial tie before decryption", async () => {
  const grant = await decision("granted", 1);
  await contact(grant, 2);
  await decision("denied", 1);
  await assertDenied();
});
it("does not revive an older contact after a newer grant until fresh evidence is bound", async () => {
  const old = await decision("granted", 1);
  await contact(old, 2);
  const current = await decision("granted", 3);
  await assertDenied();
  const id = await contact(current, 4);
  expect(
    await new PostgresYooKassaReceiptContactAuthority(
      database.db,
    ).latestForOrder(orderId, purpose, policy),
  ).toMatchObject({ contactId: id });
});
it("does not uncover an older eligible contact when the newest contact is revoked", async () => {
  const current = await decision("granted", 1);
  await contact(current, 2);
  await contact(current, 3, true);
  await assertDenied();
});
