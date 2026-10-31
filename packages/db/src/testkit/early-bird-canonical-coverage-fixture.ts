import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  YooKassaEarlyBirdCandidateVerifier,
  YooKassaEarlyBirdVerifier,
  YooKassaEarlyBirdRefundVerifier,
  parseEarlyBirdRefundBinding,
  type EarlyBirdPaymentBinding,
  type EarlyBirdRefundBinding,
  type YooKassaPayment,
  type YooKassaRefund,
} from "@ii-tonya/integrations";
import { startPublicExpertFuturePostgres } from "../../../../tests/support/public-expert-gateway-provider.mjs";
import { startExpertReferralTestDatabase } from "./expert-referral.js";
import { createEarlyBirdOwnerJourney } from "./early-bird-owner-journey.js";
import { PostgresEarlyBirdIntentTransitions } from "../repositories/early-bird-intent-transitions.js";

/** Full journal and actual guarded source preparation. Provider GETs below are
 * explicit synthetic facts, verified by the real verifiers before canonical SQL.
 * Trusted fixture-owner SQL is not evidence of runtime role provisioning. */
export async function createEarlyBirdCanonicalCoverageFixture() {
  const clock = await startPublicExpertFuturePostgres();
  let db:
    Awaited<ReturnType<typeof startExpertReferralTestDatabase>> | undefined;
  try {
    // The immutable wave admission window must be live on the actual PG clock.
    await clock.advance(
      (Date.parse("2026-11-02T12:00:00Z") -
        Date.parse("2027-01-11T12:00:00Z")) /
        1000,
    );
    const NativeDate = Date;
    vi.stubGlobal(
      "Date",
      new Proxy(NativeDate, {
        construct(target, args) {
          return Reflect.construct(
            target,
            args.length
              ? args
              : [NativeDate.now() + clock.offsetSeconds * 1000],
          );
        },
        get(target, property) {
          return property === "now"
            ? () => NativeDate.now() + clock.offsetSeconds * 1000
            : Reflect.get(target, property);
        },
      }),
    );
    const previous = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = clock.connectionString;
    try {
      db = await startExpertReferralTestDatabase();
    } finally {
      if (previous === undefined)
        delete process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
      else process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = previous;
    }
    const database = db;
    await database.enableExpertReferralCommands();
    const owner = await createEarlyBirdOwnerJourney({ database });
    const query = database.db.$client.query.bind(database.db.$client);
    let expertId = (
      await query("select id from experts where user_id=$1", [owner.user])
    ).rows[0]?.id as string | undefined;
    if (!expertId)
      expertId = (
        await query(
          "insert into experts(user_id,active,verified) values($1,true,true) returning id",
          [owner.user],
        )
      ).rows[0]!.id as string;
    const intentId = owner.identity.operationId;
    if (
      !(await new PostgresEarlyBirdIntentTransitions(database.db).markUnknown({
        userId: owner.user,
        intentId,
      }))
    )
      throw Error("canonical_coverage_dispatch_denied");
    const findIntent = async (id: string) =>
      (
        await query(
          "select early_bird_private.find_candidate_intent($1) value",
          [id],
        )
      ).rows[0]!.value;
    const source = (await findIntent(intentId)) as EarlyBirdPaymentBinding;
    const capturedAt = (
      await query("select clock_timestamp() n")
    ).rows[0]!.n.toISOString() as string;
    const amount = BigInt(source.totalMinor);
    const payment: YooKassaPayment = {
      id: "canonical_" + randomUUID(),
      status: "succeeded",
      paid: true,
      test: source.mode === "test",
      refundable: true,
      amount: {
        value: `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`,
        currency: "RUB",
      },
      createdAt: source.baseOfferShownAt,
      capturedAt,
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
        if (id !== payment.id) throw Error("canonical_coverage_wrong_payment");
        return structuredClone(payment);
      },
    };
    const candidateVerifier = new YooKassaEarlyBirdCandidateVerifier(provider, {
      findIntent,
    });
    const candidateProof = await candidateVerifier.verify(intentId, payment.id);
    const bindingSnapshot = {
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
        payment.id,
        candidateProof.evidenceDigest,
        JSON.stringify(bindingSnapshot),
      ],
    );
    const readPaymentBinding = async (invoice: string) =>
      (
        await query(
          "select early_bird_private.find_verified_payment('invoice',$1) value",
          [invoice],
        )
      ).rows[0]!.value as EarlyBirdPaymentBinding | null;
    const verifier = new YooKassaEarlyBirdVerifier(provider, {
      findEarlyBirdBinding: readPaymentBinding,
    });
    const paymentProof = await verifier.verify(source.invoiceId);
    if (!paymentProof || paymentProof.disposition !== "eligible")
      throw Error("canonical_coverage_payment_unverified");
    const paymentSnapshot = await readPaymentBinding(source.invoiceId);
    if (!paymentSnapshot) throw Error("canonical_coverage_payment_missing");
    return {
      db: database,
      owner,
      expert: { userId: owner.user, expertId },
      intentId,
      payment,
      candidateProof,
      bindingSnapshot,
      paymentProof,
      paymentSnapshot,
      async advanceClock(seconds: number) {
        await clock.advance(seconds);
      },
      async recordWaveSuccess() {
        await database.db.transaction(
          async (tx) => {
            await tx.execute(
              sql`select early_bird_commit_verified_payment(${JSON.stringify(paymentSnapshot)}::jsonb,${paymentProof.evidenceDigest},${paymentProof.capturedAt}::timestamptz)`,
            );
          },
          { isolationLevel: "serializable" },
        );
      },
      async recordFullRefund() {
        const refund: YooKassaRefund = {
          id: "refund_" + randomUUID(),
          paymentId: payment.id,
          status: "succeeded",
          amount: payment.amount,
          createdAt: (
            await query("select clock_timestamp() n")
          ).rows[0]!.n.toISOString() as string,
        };
        const refundSnapshot = parseEarlyBirdRefundBinding({
          invoiceId: source.invoiceId,
          userId: source.userId,
          operationId: source.operationId,
          refundOperationId: randomUUID(),
          paymentId: payment.id,
          refundId: refund.id,
          pricingPolicy: source.pricingPolicy,
          priceKind: source.priceKind,
          mode: source.mode,
          grantId: owner.grant,
          totalMinor: source.totalMinor,
        });
        const refundProvider = {
          ...provider,
          getRefund: async (id: string) => {
            if (id !== refund.id)
              throw Error("canonical_coverage_wrong_refund");
            return structuredClone(refund);
          },
        };
        const candidate = new YooKassaEarlyBirdRefundVerifier(refundProvider, {
          findRefundBinding: async () => refundSnapshot,
        });
        if (!(await candidate.verify(refund.id)))
          throw Error("canonical_coverage_refund_unverified");
        await query("select early_bird_bind_verified_refund($1::jsonb)", [
          JSON.stringify(refundSnapshot),
        ]);
        const refundVerifier = new YooKassaEarlyBirdRefundVerifier(
          refundProvider,
          {
            findRefundBinding: async (id) =>
              (
                await query(
                  "select early_bird_read_verified_refund($1) value",
                  [id],
                )
              ).rows[0]!.value as EarlyBirdRefundBinding | null,
          },
        );
        const proof = await refundVerifier.verify(refund.id);
        if (!proof || proof.disposition !== "full_refund")
          throw Error("canonical_coverage_refund_binding_missing");
        await database.db.transaction(
          async (tx) => {
            await tx.execute(
              sql`select early_bird_commit_verified_refund(${JSON.stringify(refundSnapshot)}::jsonb,${proof.amountMinor}::bigint,${proof.evidenceDigest},${proof.providerCreatedAt}::timestamptz)`,
            );
          },
          { isolationLevel: "serializable" },
        );
      },
      async stop() {
        try {
          await database.stop();
        } finally {
          try {
            await clock.stop();
          } finally {
            vi.unstubAllGlobals();
          }
        }
      },
    };
  } catch (error) {
    const failures: unknown[] = [error];
    try {
      await db?.stop();
    } catch (cleanup) {
      failures.push(cleanup);
    }
    try {
      await clock.stop();
    } catch (cleanup) {
      failures.push(cleanup);
    } finally {
      vi.unstubAllGlobals();
    }
    if (failures.length > 1)
      throw new AggregateError(failures, "canonical_coverage_setup_failed");
    throw error;
  }
}
