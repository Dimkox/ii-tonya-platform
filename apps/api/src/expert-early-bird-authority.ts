import { createHash } from "node:crypto";
import {
  PostgresEarlyBirdPaidStatus,
  PostgresEarlyBirdChoiceRepository,
  PostgresEarlyBirdLegacyRouting,
  PostgresExpertSeparatedSalesRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import type { ExpertApplicantConfig } from "@ii-tonya/config";
import type { EarlyBirdSalesAuthority } from "./expert-early-bird-service.js";
import {
  afterEarlyBirdChoice,
  type EarlyBirdPrepareAuthority,
} from "./expert-early-bird-prepare-hook.js";

/** Never promise a discount when the configured price floor absorbs it. */
export function hasEarlyBirdSavings(snapshot: {
  standardOnly: boolean;
  baseMonthlyMinor: string;
  monthlyPriceMinor: string | null;
}): boolean {
  if (
    snapshot.standardOnly ||
    !snapshot.monthlyPriceMinor ||
    !/^(?:0|[1-9]\d{0,11})$/u.test(snapshot.baseMonthlyMinor) ||
    !/^(?:0|[1-9]\d{0,11})$/u.test(snapshot.monthlyPriceMinor)
  )
    return false;
  return BigInt(snapshot.monthlyPriceMinor) < BigInt(snapshot.baseMonthlyMinor);
}
/** Only records verified wave decisions; no invoice exists until a payment authority is wired. */
export function createPostgresEarlyBirdAuthority(
  db: DrizzleDb,
  policy: ExpertApplicantConfig,
  clientStartMs: number,
  enrollmentStartMs: number,
  prepareAuthority?: EarlyBirdPrepareAuthority,
  receiptAuthority?: Pick<EarlyBirdSalesAuthority, "captureReceipt">,
  deferredAuthority?: EarlyBirdPrepareAuthority &
    Required<Pick<EarlyBirdSalesAuthority, "current" | "captureReceipt">> &
    Pick<EarlyBirdSalesAuthority, "choose">,
): EarlyBirdSalesAuthority {
  if (
    clientStartMs !== Date.parse("2027-01-11T00:00:00+03:00") ||
    enrollmentStartMs !== Date.parse("2026-11-01T00:00:00+03:00")
  )
    throw new Error("early_bird_invalid_start");
  const paid = new PostgresEarlyBirdPaidStatus(db, policy);
  const sales = new PostgresExpertSeparatedSalesRepository(db, policy);
  const choices = new PostgresEarlyBirdChoiceRepository(db, policy);
  const legacy = new PostgresEarlyBirdLegacyRouting(db, policy);
  return {
    ...(receiptAuthority?.captureReceipt || deferredAuthority
      ? {
          async captureReceipt(input, email) {
            if (deferredAuthority) {
              const deferred = await deferredAuthority.captureReceipt(
                input,
                email,
              );
              if (deferred) return deferred;
            }
            return (
              (await receiptAuthority?.captureReceipt?.(input, email)) ?? false
            );
          },
        }
      : {}),
    async current(input) {
      const settled =
        (await paid.find(input)) ?? (await deferredAuthority?.current(input));
      if (settled) return settled;
      const selected = await choices.currentPayment(input);
      return selected
        ? {
            ...selected,
            status: selected.qualified
              ? ("APPROVED_UNPAID" as const)
              : ("AWAITING_APPROVAL" as const),
          }
        : null;
    },
    async continuePayment(input) {
      if (
        !Number.isSafeInteger(input.updateId) ||
        input.updateId < 0 ||
        (await paid.find(input)) ||
        (await deferredAuthority?.current(input))
      )
        return null;
      const selected = await choices.currentPayment(input);
      if (!selected?.qualified) return null;
      const command = {
        ...input,
        offerId: selected.id,
        revision: selected.revision,
        choice: selected.choice,
        choiceId: selected.choiceId,
      };
      if (selected.choice === "now") {
        const result = await prepareAuthority?.prepare(command);
        return {
          choice: selected.choice,
          outcome:
            result?.kind === "invoice" ? result : { kind: "pending" as const },
        };
      }
      if (!deferredAuthority?.choose) return null;
      const prepared = await deferredAuthority.prepare(command);
      if (prepared.kind === "unavailable") return null;
      const result = await deferredAuthority.choose(command);
      return {
        choice: selected.choice,
        outcome:
          result?.kind === "invoice" ? result : { kind: "pending" as const },
      };
    },
    async quote(input) {
      const digest = createHash("sha256")
        .update(
          JSON.stringify({
            text: input.text,
            callback: input.callbackData,
            media: input.media,
          }),
        )
        .digest("hex");
      const snapshot = await sales.transition({
        ...input,
        requestKey: `${input.botId}:${input.updateId}`,
        requestDigest: digest,
        tariffVersionId: input.tariffVersionId,
        waveStartAtMs: clientStartMs,
        waveEnrollmentStartMs: enrollmentStartMs,
      });
      if (!snapshot || snapshot.state !== "base") return null;
      return {
        id: snapshot.id,
        revision: snapshot.revision,
        monthlyMinor:
          snapshot.waveTestPrice?.subscriptionMinor ??
          snapshot.baseMonthlyMinor,
        onboardingMinor: snapshot.waveTestPrice?.onboardingMinor ?? "300000",
        grantId: snapshot.waveTestPrice?.grantId ?? null,
      };
    },
    async present(input) {
      const digest = createHash("sha256")
        .update(
          JSON.stringify({
            text: input.text,
            callback: input.callbackData,
            media: input.media,
          }),
        )
        .digest("hex");
      const snapshot = await sales.transition({
        ...input,
        requestKey: `${input.botId}:${input.updateId}`,
        requestDigest: digest,
        baseId: input.offerId,
        revision: input.revision,
        action: "positive",
        waveStartAtMs: clientStartMs,
        waveEnrollmentStartMs: enrollmentStartMs,
        waveExpectedGrantId: input.expectedGrantId,
      });
      if (
        !snapshot ||
        snapshot.state !== "promotion" ||
        snapshot.id !== input.offerId ||
        snapshot.revision !== input.revision + 1
      )
        return null;
      return {
        id: snapshot.id,
        revision: snapshot.revision,
        name:
          input.firstName &&
          input.firstName.length <= 64 &&
          !/[\p{Cc}\p{Cf}]/u.test(input.firstName)
            ? input.firstName
            : "Резидент",
        clientStart: new Date(clientStartMs).toISOString(),
        discountEligible:
          !snapshot.waveTestPrice && hasEarlyBirdSavings(snapshot),
      };
    },
    async formEligible(input) {
      return choices.formEligible(input);
    },
    async formContinuationEligible(input) {
      return choices.formContinuationEligible(input);
    },
    async legacyEligible(input) {
      return legacy.eligible(input);
    },
    async choose(input) {
      if (input.choice === "subscription")
        return (await deferredAuthority?.choose(input)) ?? null;
      if (input.choice === "later" && deferredAuthority) {
        const existing = await deferredAuthority.choose(input);
        if (existing) return existing;
      }
      const choice = await choices.record({ ...input, choice: input.choice });
      if (!choice) return null;
      return afterEarlyBirdChoice(
        { ...input, choice: input.choice },
        choice.id,
        await choices.formEligible(input),
        prepareAuthority,
        deferredAuthority,
      );
    },
  };
}
