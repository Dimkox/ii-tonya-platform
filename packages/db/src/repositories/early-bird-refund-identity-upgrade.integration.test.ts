import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  YooKassaEarlyBirdCandidateVerifier,
  YooKassaEarlyBirdVerifier,
  YooKassaEarlyBirdRefundVerifier,
  YooKassaDeferredVerifier,
  YooKassaDeferredRefundVerifier,
  parseEarlyBirdRefundBinding,
  type EarlyBirdCandidateIntent,
  type EarlyBirdPaymentBinding,
  type EarlyBirdRefundBinding,
  type DeferredSnapshot,
  type YooKassaPayment,
  type YooKassaRefund,
} from "@ii-tonya/integrations";
import { startPublicExpertFuturePostgres } from "../../../../tests/support/public-expert-gateway-provider.mjs";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { createEarlyBirdOwnerJourney } from "../testkit/early-bird-owner-journey.js";
import { PostgresEarlyBirdIntentTransitions } from "./early-bird-intent-transitions.js";

// This is an actual 0083 -> 0084 upgrade, including historical canonical refunds.
// Synthetic provider GETs pass the real verifiers before financial SQL is called.
// Fixture-owner execution does not claim restricted runtime-role provisioning.
let clock: Awaited<ReturnType<typeof startPublicExpertFuturePostgres>>;
let folders: string;
const databases: ExpertReferralTestDatabase[] = [];
const money = (minor: number | string) => {
  const amount = BigInt(minor);
  return {
    value: `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`,
    currency: "RUB" as const,
  };
};

async function migrationFolder(through: number) {
  const folder = join(folders, String(through));
  await mkdir(join(folder, "meta"), { recursive: true });
  const journal = JSON.parse(
    await readFile("packages/db/migrations/meta/_journal.json", "utf8"),
  ) as {
    entries: { idx: number; tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.idx <= through);
  expect(journal.entries.at(-1)?.idx).toBe(through);
  for (const entry of journal.entries)
    await copyFile(
      `packages/db/migrations/${entry.tag}.sql`,
      join(folder, `${entry.tag}.sql`),
    );
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  return folder;
}

beforeAll(async () => {
  folders = await mkdtemp(join(tmpdir(), "refund-identity-upgrade-"));
  clock = await startPublicExpertFuturePostgres();
  await clock.advance(
    (Date.parse("2026-11-02T12:00:00Z") - Date.parse("2027-01-11T12:00:00Z")) /
      1000,
  );
  const NativeDate = Date;
  vi.stubGlobal(
    "Date",
    new Proxy(NativeDate, {
      construct(target, args) {
        return Reflect.construct(
          target,
          args.length ? args : [NativeDate.now() + clock.offsetSeconds * 1000],
        );
      },
      get(target, property) {
        return property === "now"
          ? () => NativeDate.now() + clock.offsetSeconds * 1000
          : Reflect.get(target, property);
      },
    }),
  );
}, 120_000);

afterAll(async () => {
  try {
    for (const database of databases) await database.stop();
  } finally {
    try {
      await clock?.stop();
    } finally {
      vi.unstubAllGlobals();
      if (folders) await rm(folders, { recursive: true, force: true });
    }
  }
}, 120_000);

async function paidSource(product: "composite" | "deferred", prefix: string) {
  const previous = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = clock.connectionString;
  let database: ExpertReferralTestDatabase;
  try {
    database = await startExpertReferralTestDatabase((db) =>
      migrate(db, { migrationsFolder: prefix }),
    );
    databases.push(database);
  } finally {
    if (previous === undefined)
      delete process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    else process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = previous;
  }
  await database.enableExpertReferralCommands();
  const owner = await createEarlyBirdOwnerJourney({ database });
  const query = database.db.$client.query.bind(database.db.$client);
  const now = async () =>
    (
      await query("select clock_timestamp() n")
    ).rows[0]!.n.toISOString() as string;
  const paymentId = "payment_" + randomUUID();
  let sourceId: string;
  let refund: (id: string, amount: number) => Promise<() => Promise<unknown>>;
  if (product === "composite") {
    const intentId = owner.identity.operationId;
    expect(
      await new PostgresEarlyBirdIntentTransitions(database.db).markUnknown({
        userId: owner.user,
        intentId,
      }),
    ).toBe(true);
    const findIntent = async (id: string) =>
      (
        await query(
          "select early_bird_private.find_candidate_intent($1) value",
          [id],
        )
      ).rows[0]!.value as EarlyBirdCandidateIntent;
    const source = await findIntent(intentId);
    const payment: YooKassaPayment = {
      id: paymentId,
      status: "succeeded",
      paid: true,
      test: source.mode === "test",
      refundable: true,
      amount: money(source.totalMinor),
      createdAt: source.baseOfferShownAt,
      capturedAt: await now(),
      metadata: {
        order_id: source.invoiceId,
        user_id: source.userId,
        operation_id: source.operationId,
        purpose: "combined_early_bird",
        pricing_policy: source.pricingPolicy,
        price_kind: source.priceKind,
        ...(source.pricingPolicy === "owner_test_10_20_v1"
          ? { pricing_grant_id: source.grantId }
          : {}),
      },
    };
    const provider = {
      getPayment: async (id: string) => {
        expect(id).toBe(paymentId);
        return structuredClone(payment);
      },
    };
    const candidate = await new YooKassaEarlyBirdCandidateVerifier(provider, {
      findIntent,
    }).verify(intentId, paymentId);
    const binding = {
      ...source,
      baseMonthlyMinor: null,
      ruleVersion: null,
      participantKind: null,
      promotionEligible: null,
      quotedAt: null,
    };
    await query(
      "select early_bird_private.bind_verified($1,$2,$3,$4,$5::jsonb)",
      [
        intentId,
        owner.user,
        paymentId,
        candidate.evidenceDigest,
        JSON.stringify(binding),
      ],
    );
    const findEarlyBirdBinding = async (invoice: string) =>
      (
        await query(
          "select early_bird_private.find_verified_payment('invoice',$1) value",
          [invoice],
        )
      ).rows[0]!.value as EarlyBirdPaymentBinding | null;
    const proof = await new YooKassaEarlyBirdVerifier(provider, {
      findEarlyBirdBinding,
    }).verify(source.invoiceId);
    if (!proof || proof.disposition !== "eligible")
      throw Error("upgrade_payment_unverified");
    await database.db.transaction(
      async (tx) => {
        await tx.execute(
          sql`select early_bird_commit_verified_payment(${JSON.stringify(await findEarlyBirdBinding(source.invoiceId))}::jsonb,${proof.evidenceDigest},${proof.capturedAt}::timestamptz)`,
        );
      },
      { isolationLevel: "serializable" },
    );
    sourceId = intentId;
    refund = async (id, amount) => {
      const snapshot = parseEarlyBirdRefundBinding({
        invoiceId: source.invoiceId,
        userId: source.userId,
        operationId: source.operationId,
        refundOperationId: randomUUID(),
        paymentId,
        refundId: id,
        pricingPolicy: source.pricingPolicy,
        priceKind: source.priceKind,
        mode: source.mode,
        grantId: owner.grant,
        totalMinor: source.totalMinor,
      });
      const fact: YooKassaRefund = {
        id,
        paymentId,
        status: "succeeded",
        amount: money(amount),
        createdAt: await now(),
      };
      const refundProvider = {
        ...provider,
        getRefund: async (requested: string) => {
          expect(requested).toBe(id);
          return structuredClone(fact);
        },
      };
      expect(
        await new YooKassaEarlyBirdRefundVerifier(refundProvider, {
          findRefundBinding: async () => snapshot,
        }).verify(id),
      ).toBeTruthy();
      await query("select early_bird_bind_verified_refund($1::jsonb)", [
        JSON.stringify(snapshot),
      ]);
      const verified = await new YooKassaEarlyBirdRefundVerifier(
        refundProvider,
        {
          findRefundBinding: async (requested) =>
            (
              await query("select early_bird_read_verified_refund($1) value", [
                requested,
              ])
            ).rows[0]!.value as EarlyBirdRefundBinding | null,
        },
      ).verify(id);
      if (!verified || verified.disposition !== "reconcile")
        throw Error("upgrade_partial_refund_unverified");
      return () =>
        database.db.transaction(
          async (tx) => {
            await tx.execute(
              sql`select early_bird_commit_verified_refund(${JSON.stringify(snapshot)}::jsonb,${verified.amountMinor}::bigint,${verified.evidenceDigest},${verified.providerCreatedAt}::timestamptz)`,
            );
          },
          { isolationLevel: "serializable" },
        );
    };
  } else {
    await query(
      "update early_bird_composite_intents set status='abandoned' where id=$1",
      [owner.identity.operationId],
    );
    const choice = (
      await query(
        "insert into early_bird_choices(user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) select user_id,base_id,positive_choice_id,revision,'later','identity-upgrade-later',$2 from early_bird_choices where id=$1 returning id",
        [owner.choice, "b".repeat(64)],
      )
    ).rows[0]!.id as string;
    const account = randomUUID(),
      invoice = randomUUID();
    await query(
      "select early_bird_deferred_prepare($1,$2,$3,$4,(select config_id from early_bird_composite_intents where id=$5))",
      [account, owner.user, owner.base, choice, owner.identity.operationId],
    );
    await query(
      "select early_bird_deferred_invoice($1,$2,$3,$4,'onboarding')",
      [account, owner.user, invoice, randomUUID()],
    );
    await query(
      "update early_bird_deferred_invoices set dispatch_started_at=clock_timestamp() where id=$1",
      [invoice],
    );
    const findInvoice = async (id: string) =>
      (await query("select early_bird_deferred_read_invoice($1) value", [id]))
        .rows[0]!.value as DeferredSnapshot;
    const source = await findInvoice(invoice),
      capturedAt = await now();
    const payment: YooKassaPayment = {
      id: paymentId,
      status: "succeeded",
      paid: true,
      test: false,
      refundable: true,
      amount: money(source.amountMinor),
      createdAt: capturedAt,
      capturedAt,
      metadata: {
        order_id: invoice,
        operation_id: invoice,
        user_id: owner.user,
        purpose: "early_bird_deferred",
        stage: source.stage,
        pricing_policy: source.policy,
        pricing_grant_id: owner.grant,
      },
    };
    const provider = {
      getPayment: async (id: string) => {
        expect(id).toBe(paymentId);
        return structuredClone(payment);
      },
    };
    const proof = await new YooKassaDeferredVerifier(provider, {
      findInvoice,
    }).verify(invoice, paymentId);
    expect(proof.status).toBe("succeeded");
    await query("select early_bird_deferred_bind_verified($1,$2,$3,$4,$5)", [
      invoice,
      owner.user,
      paymentId,
      proof.amountMinor,
      proof.evidenceDigest,
    ]);
    await database.db.transaction(
      async (tx) => {
        await tx.execute(
          sql`select early_bird_deferred_commit_verified(${invoice}::uuid,${owner.user}::uuid,${paymentId},${proof.amountMinor}::bigint,${proof.evidenceDigest},${proof.capturedAt}::timestamptz)`,
        );
      },
      { isolationLevel: "serializable" },
    );
    sourceId = invoice;
    refund = async (id, amount) => {
      const fact: YooKassaRefund = {
        id,
        paymentId,
        status: "succeeded",
        amount: money(amount),
        createdAt: await now(),
      };
      const verified = await new YooKassaDeferredRefundVerifier(
        {
          ...provider,
          getRefund: async (requested) => {
            expect(requested).toBe(id);
            return structuredClone(fact);
          },
        },
        {
          findByProviderPayment: async (requested) =>
            (
              await query(
                "select early_bird_deferred_refund_payment($1) value",
                [requested],
              )
            ).rows[0]!.value as
              (DeferredSnapshot & { providerId: string }) | null,
        },
      ).verify(id);
      if (!verified || verified.status !== "succeeded")
        throw Error("upgrade_deferred_refund_unverified");
      await query("select early_bird_deferred_bind_refund($1,$2,$3,$4,$5,$6)", [
        invoice,
        owner.user,
        paymentId,
        id,
        verified.refundAmountMinor,
        verified.evidenceDigest,
      ]);
      return () =>
        database.db.transaction(
          async (tx) => {
            await tx.execute(
              sql`select early_bird_deferred_commit_refund(${invoice}::uuid,${owner.user}::uuid,${paymentId},${id},${verified.refundAmountMinor}::bigint,${verified.evidenceDigest})`,
            );
          },
          { isolationLevel: "serializable" },
        );
    };
  }
  return { database, query, sourceId, refund };
}

it("upgrades real composite/deferred refunds and keeps new refunds typed, immutable and idempotent", async () => {
  const prefix = await migrationFolder(83),
    current = await migrationFolder(84);
  for (const product of ["composite", "deferred"] as const) {
    const source = await paidSource(product, prefix);
    const historicalId = "historical_" + randomUUID(),
      currentId = "current_" + randomUUID();
    const historical = await source.refund(historicalId, 100);
    await historical();
    expect(
      (
        await source.query(
          "select to_regclass('public.public_expert_provider_identities') value",
        )
      ).rows[0]!.value,
    ).toBeNull();
    await migrate(source.database.db, { migrationsFolder: current });
    const ownership = async (id: string) =>
      (
        await source.query(
          "select source_kind,source_id from public_expert_provider_identities where object_kind='refund' and provider_object_id=$1",
          [id],
        )
      ).rows;
    const expected = [{ source_kind: product, source_id: source.sourceId }];
    expect(await ownership(historicalId)).toEqual(expected);
    await historical();
    const fresh = await source.refund(currentId, 200);
    await fresh();
    await fresh();
    expect(await ownership(currentId)).toEqual(expected);
    const totals = async () =>
      (
        await source.query(
          "select count(*)::integer count,sum(amount_minor)::text amount,bool_and((intent_id is not null)::integer+(deferred_invoice_id is not null)::integer=1) xor_valid from early_bird_refund_registry",
        )
      ).rows;
    expect(await totals()).toEqual([
      { count: 2, amount: "300", xor_valid: true },
    ]);
    await expect(
      source.query(
        "select early_bird_private.public_identity_claim('refund',$1,$2,$3)",
        [
          currentId,
          product === "composite" ? "deferred" : "composite",
          randomUUID(),
        ],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      source.query(
        "update public_expert_provider_identities set source_id=$2 where object_kind='refund' and provider_object_id=$1",
        [currentId, randomUUID()],
      ),
    ).rejects.toThrow("public_provider_identity_immutable");
    await expect(
      source.query(
        "delete from public_expert_provider_identities where object_kind='refund' and provider_object_id=$1",
        [currentId],
      ),
    ).rejects.toThrow("public_provider_identity_immutable");
    expect(await ownership(currentId)).toEqual(expected);
    expect(await totals()).toEqual([
      { count: 2, amount: "300", xor_valid: true },
    ]);
    expect(
      (
        await source.query(
          "select attnotnull from pg_attribute where attrelid='public_expert_provider_identities'::regclass and attname='source_id'",
        )
      ).rows[0]!.attnotnull,
    ).toBe(true);
    expect(
      (
        await source.query(
          "select count(*)::integer n from public_expert_provider_identities where source_id is null",
        )
      ).rows[0]!.n,
    ).toBe(0);
  }
}, 120_000);
