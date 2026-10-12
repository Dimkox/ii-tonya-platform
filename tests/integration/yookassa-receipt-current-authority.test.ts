import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { DrizzleDb } from "../../packages/db/src/client.js";
import { PostgresYooKassaReceiptContactAuthority } from "../../packages/db/src/repositories/yookassa-receipt-contact-repository.js";
import { PostgresExpertCampaignQuoteRepository } from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import { PostgresExpertCampaignOrderRepository } from "../../packages/db/src/repositories/expert-campaign-order-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { ConsentBoundYooKassaReceiptContactSource } from "../../packages/integrations/src/yookassa/receipt-contact-source.js";

// Synthetic purpose/policy fixtures, never activation configuration.
const purpose = "receipt_test";
const policy = "fixture-v1";
const time = (second: number) =>
  `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
let database: ExpertReferralTestDatabase;
let tariffVersionId: string;
beforeAll(async () => {
  if (!process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL)
    throw new Error("isolated_pg17_required");
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
  await database.enableExpertReferralCommands();
  tariffVersionId = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "Про",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
});
afterAll(async () => {
  await database?.stop();
});

async function fixture(campaign = false) {
  const owner = await database.createExpertIdentity();
  const key = randomUUID();
  const order = campaign
    ? await new PostgresExpertCampaignOrderRepository(
        database.db,
      ).createCheckoutOrder({
        userId: owner.userId,
        expertId: owner.expertId,
        idempotencyKey: key,
        quoteId: (
          await new PostgresExpertCampaignQuoteRepository(
            database.db,
          ).createQuote({
            userId: owner.userId,
            tariffVersionId,
            termMonths: 1,
            idempotencyKey: key,
          })
        ).id,
      })
    : await new PostgresExpertResidencyRepository(
        database.db,
      ).createCheckoutOrder({
        expertId: owner.expertId,
        tariffVersionId,
        providerDeadline: new Date(Date.now() + 3600000),
        idempotencyKey: key,
      });
  return { ...owner, orderId: order.id };
}
async function consent(
  userId: string,
  decision = "granted",
  second = 1,
  version = policy,
  consentPurpose = purpose,
) {
  const id = randomUUID();
  await database.db
    .execute(sql`insert into consents(id,user_id,consent_type,decision,policy_version,created_at)
    values(${id}::uuid,${userId}::uuid,${consentPurpose},${decision},${version},${time(second)}::timestamptz)`);
  return id;
}
async function contact(
  userId: string,
  consentId: string,
  options: {
    decision?: string;
    version?: string;
    purpose?: string;
    revoked?: boolean;
    second?: number;
  } = {},
) {
  const id = randomUUID();
  const decision = options.decision ?? "granted";
  await database.db.execute(sql`insert into expert_residency_receipt_contacts
    (id,user_id,contact_kind,ciphertext,key_reference,consent_id,consent_decision,consent_purpose,policy_version,verified_at,revoked_at,created_at)
    values(${id}::uuid,${userId}::uuid,'email','synthetic-ciphertext','fixture:receipt',${consentId}::uuid,${decision},${options.purpose ?? purpose},${options.version ?? policy},
      ${decision === "granted" ? time(1) : null}::timestamptz,${options.revoked ? time(2) : null}::timestamptz,${time(options.second ?? 3)}::timestamptz)`);
  return id;
}
const reader = (db: Pick<DrizzleDb, "execute"> = database.db) =>
  new PostgresYooKassaReceiptContactAuthority(db);
async function denied(
  orderId: string,
  db: Pick<DrizzleDb, "execute"> = database.db,
) {
  // Real reader + real source: a forbidden disclosure must stop before decryption.
  let decryptions = 0;
  const authority = reader(db);
  const source = new ConsentBoundYooKassaReceiptContactSource({
    authority,
    consentPurpose: purpose,
    policyVersion: policy,
    decryptor: {
      async decrypt() {
        decryptions++;
        throw new Error("unauthorized_decryption");
      },
    },
  });
  const encrypted = await authority.latestForOrder(orderId, purpose, policy);
  await expect(source.receiptContactForOrder(orderId)).resolves.toBeNull();
  expect(decryptions).toBe(0);
  expect(encrypted).toBeNull();
}

it("returns only encrypted current evidence in a read-only transaction for a historical order", async () => {
  const f = await fixture();
  const id = await contact(f.userId, await consent(f.userId));
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    expect(await reader(tx).latestForOrder(f.orderId, purpose, policy)).toEqual(
      {
        contactId: id,
        contactKind: "email",
        ciphertext: "synthetic-ciphertext",
        keyReference: "fixture:receipt",
        consentDecision: "granted",
        consentPurpose: purpose,
        policyVersion: policy,
        verifiedAt: time(1),
        revokedAt: null,
      },
    );
  });
});
it.each(["denied", "revoked"])(
  "a later %s decision denies both reader and source",
  async (decision) => {
    const f = await fixture();
    await contact(f.userId, await consent(f.userId));
    await consent(f.userId, decision, 4);
    await denied(f.orderId);
  },
);
it.each(["denied", "revoked", "policy"])(
  "latest timestamp tie containing %s fails closed",
  async (kind) => {
    const f = await fixture();
    await contact(f.userId, await consent(f.userId));
    await consent(
      f.userId,
      kind === "policy" ? "granted" : kind,
      1,
      kind === "policy" ? "fixture-v2" : policy,
    );
    await denied(f.orderId);
  },
);
it("a newer policy supersedes the old contact", async () => {
  const f = await fixture();
  await contact(f.userId, await consent(f.userId));
  await consent(f.userId, "granted", 4, "fixture-v2");
  await denied(f.orderId);
});
it("regrant requires fresh contact linked to the current consent", async () => {
  const f = await fixture();
  await contact(f.userId, await consent(f.userId));
  await consent(f.userId, "revoked", 4);
  const latest = await consent(f.userId, "granted", 5);
  await denied(f.orderId);
  const id = await contact(f.userId, latest, { second: 6 });
  expect(
    (await reader().latestForOrder(f.orderId, purpose, policy))?.contactId,
  ).toBe(id);
});
it("an unrelated purpose does not revoke this purpose", async () => {
  const f = await fixture();
  const id = await contact(f.userId, await consent(f.userId));
  await consent(f.userId, "revoked", 4, policy, "unrelated_test");
  expect(
    (await reader().latestForOrder(f.orderId, purpose, policy))?.contactId,
  ).toBe(id);
});
it("same-time grants under the same policy remain eligible", async () => {
  const f = await fixture();
  const id = await contact(f.userId, await consent(f.userId));
  await consent(f.userId);
  expect(
    (await reader().latestForOrder(f.orderId, purpose, policy))?.contactId,
  ).toBe(id);
});
it("the receipt source admits eligible encrypted evidence to its decryption boundary", async () => {
  const f = await fixture();
  await contact(f.userId, await consent(f.userId));
  const boundary = new Error("synthetic_decryption_boundary");
  let reached = false;
  const source = new ConsentBoundYooKassaReceiptContactSource({
    authority: reader(),
    consentPurpose: purpose,
    policyVersion: policy,
    decryptor: {
      async decrypt(input) {
        expect(input).toEqual({
          ciphertext: "synthetic-ciphertext",
          keyReference: "fixture:receipt",
        });
        reached = true;
        throw boundary;
      },
    },
  });
  await expect(source.receiptContactForOrder(f.orderId)).rejects.toBe(boundary);
  expect(reached).toBe(true);
});
it("legacy_residency_v1 retains the historical owner happy path", async () => {
  const owner = await database.createExpertIdentity();
  const legacyTariff = await database.createResidencyTariff({
    tariffKey: "receipt-legacy",
    displayName: "Synthetic legacy",
    priceMinor: 999000,
    durationSeconds: 2592000,
    commercialPolicyVersion: "legacy_residency_v1",
  });
  const order = await new PostgresExpertResidencyRepository(
    database.db,
  ).createCheckoutOrder({
    expertId: owner.expertId,
    tariffVersionId: legacyTariff,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  const id = await contact(owner.userId, await consent(owner.userId));
  expect(
    (await reader().latestForOrder(order.id, purpose, policy))?.contactId,
  ).toBe(id);
});
it.each(["subject", "purpose", "policy", "decision"])(
  "rejects mismatched original %s evidence without falling back",
  async (binding) => {
    const f = await fixture();
    const grant = await consent(f.userId);
    await contact(f.userId, grant);
    const other = await database.createUser();
    const mismatch = await consent(
      binding === "subject" ? other : f.userId,
      binding === "decision" ? "denied" : "granted",
      1,
      binding === "policy" ? "fixture-v2" : policy,
      binding === "purpose" ? "unrelated_test" : purpose,
    );
    await contact(f.userId, mismatch, { second: 4 });
    await denied(f.orderId);
  },
);
it("no grant or contact grants no disclosure", async () => {
  const f = await fixture();
  await denied(f.orderId);
  await contact(f.userId, await consent(f.userId, "denied"), {
    decision: "denied",
  });
  await denied(f.orderId);
});
it.each(["inactive", "revoked_contact", "denied_contact"])(
  "rejects %s without returning older contact",
  async (kind) => {
    const f = await fixture();
    const grant = await consent(f.userId);
    await contact(f.userId, grant);
    if (kind === "inactive")
      await database.db.execute(
        sql`update users set active=false where id=${f.userId}::uuid`,
      );
    else
      await contact(f.userId, grant, {
        second: 4,
        revoked: kind === "revoked_contact",
        decision: kind === "denied_contact" ? "denied" : "granted",
      });
    await denied(f.orderId);
  },
);
it.each(["eligible", "withdrawn", "inactive"])(
  "campaign ownership reassignment preserves original payer authority: %s",
  async (state) => {
    const f = await fixture(true);
    const original = await contact(f.userId, await consent(f.userId));
    const replacement = await database.createUser();
    await contact(replacement, await consent(replacement));
    const snapshots = async () =>
      (
        await database.db.execute(
          sql`select to_jsonb(o) as order_snapshot,to_jsonb(q) as quote_snapshot from expert_residency_orders o join expert_campaign_quotes q on q.id=o.campaign_quote_id where o.id=${f.orderId}::uuid`,
        )
      ).rows;
    const before = await snapshots();
    await database.db.execute(
      sql`update experts set user_id=${replacement}::uuid where id=${f.expertId}::uuid`,
    );
    if (state === "withdrawn") await consent(f.userId, "revoked", 4);
    if (state === "inactive")
      await database.db.execute(
        sql`update users set active=false where id=${f.userId}::uuid`,
      );
    if (state === "eligible")
      expect(
        (await reader().latestForOrder(f.orderId, purpose, policy))?.contactId,
      ).toBe(original);
    else await denied(f.orderId);
    expect(await snapshots()).toEqual(before);
  },
);
it.each(["missing", "mismatched"])(
  "campaign %s quote fails closed without owner fallback",
  async (kind) => {
    const f = await fixture(true);
    await contact(f.userId, await consent(f.userId));
    // Corruption probes are confined to a rolled-back transaction in the random test DB.
    // Ordinary writes cannot create these states because migration 0048 guards them.
    const rollback = new Error("rollback_corruption_probe");
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(
          sql`alter table expert_residency_orders disable trigger expert_campaign_order_snapshot_immutable`,
        );
        if (kind === "missing") {
          await tx.execute(
            sql`alter table expert_residency_orders drop constraint expert_campaign_order_binding`,
          );
          await tx.execute(
            sql`update expert_residency_orders set campaign_quote_id=null where id=${f.orderId}::uuid`,
          );
        } else {
          await tx.execute(
            sql`update expert_residency_orders set snapshot_display_name='mismatch' where id=${f.orderId}::uuid`,
          );
        }
        await denied(f.orderId, tx);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);
it("malformed identifiers or configuration return null before any SQL", async () => {
  let queries = 0;
  const authority = reader({
    execute: (() => {
      queries++;
      throw new Error("unexpected_query");
    }) as DrizzleDb["execute"],
  });
  for (const args of [
    ["not-uuid", purpose, policy],
    [randomUUID(), "", policy],
    [randomUUID(), purpose, ""],
    [randomUUID(), "bad purpose", policy],
    [randomUUID(), purpose, "x".repeat(129)],
  ] as const) {
    expect(
      await authority.latestForOrder(args[0], args[1], args[2]),
    ).toBeNull();
  }
  const valid = [randomUUID(), purpose, policy] as const;
  for (const position of [0, 1, 2] as const) {
    for (const malformed of [
      `${valid[position]}\n`,
      `${valid[position]}\r\n`,
      null,
      undefined,
      123,
      true,
      Symbol("malformed"),
      [valid[position]],
      { toString: () => valid[position] },
    ]) {
      const args: [unknown, unknown, unknown] = [...valid];
      args[position] = malformed;
      // Exercise runtime callers that bypass the TypeScript string interface.
      expect(
        await authority.latestForOrder(
          args[0] as string,
          args[1] as string,
          args[2] as string,
        ),
      ).toBeNull();
    }
  }
  expect(queries).toBe(0);
});
