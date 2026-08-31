import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync(
  "packages/db/src/repositories/expert-referral-worker-repository.ts",
  "utf8",
);
const providerRepository = readFileSync(
  "packages/db/src/repositories/expert-residency-provider-inbox-repository.ts",
  "utf8",
);
const refund = providerRepository.slice(
  providerRepository.indexOf("async reverse("),
);

describe("A2.1 canonical lock and lease guards", () => {
  it("uses sequential order/payment/marker/maturity locks and a live lease token", () => {
    const fragments = [
      "from expert_residency_orders where id=${row.orderId}::uuid for update",
      "from expert_residency_payment_attempts where id=${row.paymentAttemptId}::uuid for update",
      "from expert_first_residency_settlements where id=${row.firstSettlementId}::uuid for update",
      "lease_token=${candidate.leaseToken}::uuid and status='pending'",
      "lease_until >= transaction_timestamp() for update",
    ];
    let cursor = -1;
    for (const fragment of fragments) {
      const next = worker.indexOf(fragment);
      expect(next, fragment).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(worker).not.toContain("for update of o,p,s");
  });

  it("locks refund order/payment/marker before re-querying maturity", () => {
    const fragments = [
      "expert_residency_orders where id=${input.orderId}::uuid for update",
      "expert_residency_payment_attempts where order_id=${order.id}::uuid",
      "expert_first_residency_settlements where qualifying_order_id=${order.id}::uuid for update",
      "expert_referral_reward_maturities where qualifying_order_id=${order.id}::uuid for update",
    ];
    let cursor = -1;
    for (const fragment of fragments) {
      const next = refund.indexOf(fragment, cursor + 1);
      expect(next, fragment).toBeGreaterThan(cursor);
      cursor = next;
    }
  });
});
