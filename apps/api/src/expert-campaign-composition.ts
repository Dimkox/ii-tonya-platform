import {
  createPayerReceiptRequiredCampaignService,
  createExpertReferralService,
  type ResidencyCheckoutProvider,
} from "@ii-tonya/application";
import {
  PostgresExpertCampaignQuoteRepository,
  PostgresExpertCampaignOrderRepository,
  PostgresExpertCampaignReadRepository,
  PostgresExpertReferralRepository,
  PostgresExpertResidencyRepository,
  type DrizzleDb,
  type ExpertReferralCodeCrypto,
} from "@ii-tonya/db";
import type { ExpertPrincipalResolver } from "./expert-principal-resolver.js";
import type { ExpertReferralApiDependencies } from "./routes/expert-referral.js";
import type { createPayerReceiptComposition } from "./payer-receipt-composition.js";

export function createExpertCampaignComposition(deps: {
  db: DrizzleDb;
  botKey: string;
  principals: ExpertPrincipalResolver;
  codeCrypto: ExpertReferralCodeCrypto;
  referralEnabled: boolean;
  billingEnabled: boolean;
  checkoutProvider?: ResidencyCheckoutProvider;
  payerReceipt?: ReturnType<typeof createPayerReceiptComposition>;
}): ExpertReferralApiDependencies {
  const reads = new PostgresExpertCampaignReadRepository(deps.db, deps.botKey);
  const residency = new PostgresExpertResidencyRepository(deps.db);
  const quotes = new PostgresExpertCampaignQuoteRepository(deps.db);
  const orders = new PostgresExpertCampaignOrderRepository(
    deps.db,
    deps.payerReceipt?.vault,
  );
  const referrals = new PostgresExpertReferralRepository(
    deps.db,
    deps.codeCrypto,
  );
  return {
    ...(deps.payerReceipt ? { receiptCapture: deps.payerReceipt.service } : {}),
    principals: deps.principals,
    residency: createPayerReceiptRequiredCampaignService({
      environmentEnabled: deps.billingEnabled,
      ownerUserId: (id) => reads.ownerUserId(id),
      listActiveTariffs: (input) => reads.listActiveTariffs(input),
      createQuote: (input) => quotes.createQuote(input),
      createCheckoutOrderWithReceipt: (input) =>
        orders.createCheckoutOrderWithReceipt(input),
      ...(deps.checkoutProvider
        ? { checkoutProvider: deps.checkoutProvider }
        : {}),
    }),
    referrals: createExpertReferralService({
      environmentEnabled: deps.referralEnabled,
      queries: {
        ownerUserId: (id) => reads.ownerUserId(id),
        async summary(id) {
          const b = await residency.balance(id);
          return {
            availableMinor: b.availableCreditMinor,
            reservedMinor: b.reservedCreditMinor,
            debtMinor: b.debtMinor,
            nearestExpiry: b.nearestExpiryAt,
          };
        },
      },
      commands: {
        async redeem({ principal, code }) {
          const externalId = await reads.referralIdentity(principal.userId);
          if (!externalId) return { kind: "forbidden" };
          const binding = await referrals.redeemCode({
            userId: principal.userId,
            provider: "telegram",
            externalId,
            plaintext: code,
          });
          return { kind: "redeemed", referralId: binding.referralId };
        },
      },
    }),
  };
}
