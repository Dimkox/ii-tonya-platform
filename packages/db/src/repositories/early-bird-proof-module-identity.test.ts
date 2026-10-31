import { expect, it, vi } from "vitest";
import {
  PostgresEarlyBirdVerifiedBindingRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import { YooKassaEarlyBirdCandidateVerifier } from "@ii-tonya/integrations";

it("preserves issuer identity across public integration and database package imports", async () => {
  const intent = {
    invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
    userId: "2526c71d-803f-4c3d-9b57-74e902170002",
    operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
    grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
    pricingPolicy: "owner_test_10_20_v1",
    priceKind: "fixed_test",
    onboardingMinor: "1000",
    subscriptionMinor: "2000",
    totalMinor: "3000",
    mode: "live",
    baseOfferShownAt: "2026-11-01T00:00:00.000Z",
    expiresAt: "2026-11-11T00:00:00.000Z",
    launchAt: "2027-01-10T21:00:00.000Z",
  } as const;
  const verifier = () =>
    new YooKassaEarlyBirdCandidateVerifier(
      {
        getPayment: async () => ({
          id: "payment1",
          status: "pending",
          paid: false,
          refundable: false,
          amount: { value: "30.00", currency: "RUB" },
          test: false,
          createdAt: "2026-11-01T01:00:00.000Z",
          metadata: {
            order_id: intent.invoiceId,
            user_id: intent.userId,
            operation_id: intent.operationId,
            purpose: "combined_early_bird",
            pricing_policy: intent.pricingPolicy,
            price_kind: intent.priceKind,
            pricing_grant_id: intent.grantId,
          },
        }),
      },
      { findIntent: async () => intent },
    );
  const issuer = verifier();
  type Transaction = Pick<DrizzleDb, "execute">;
  const execute = vi.fn().mockResolvedValue({ rows: [{ safe: true }] });
  const db = {
    transaction: async <T>(work: (tx: Transaction) => Promise<T>) =>
      work({ execute } as unknown as Transaction),
  } as unknown as DrizzleDb;
  const repository = new PostgresEarlyBirdVerifiedBindingRepository(
    db,
    issuer,
    "binding_login",
  );
  await expect(
    repository.bind(await issuer.verify(intent.operationId, "payment1")),
  ).resolves.toBeUndefined();
  expect(execute).toHaveBeenCalledTimes(2);
  await expect(
    repository.bind(await verifier().verify(intent.operationId, "payment1")),
  ).rejects.toThrow("early_bird_candidate_proof_required");
  expect(execute).toHaveBeenCalledTimes(2);
});
