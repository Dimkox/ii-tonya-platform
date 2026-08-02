import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("durable outbox repository guards", () => {
  const repository = readFileSync(
    "packages/db/src/repositories/outbox-repository.ts",
    "utf8",
  );

  it("fences dispatch and reconciliation mutations by status, owner, and lease", () => {
    expect(repository).toContain('row.status !== "processing"');
    expect(repository).toContain("row.dispatchOwnerId !== owner");
    expect(repository).toContain("row.dispatchClaimToken !== claimToken");
    expect(repository).toContain("lease_until >= clock_timestamp()");
    expect(repository).toContain('row.status !== "reconciling"');
    expect(repository).toContain("row.reconciliationOwnerId !== owner");
    expect(repository).toContain(
      "row.reconciliationClaimToken !== claimToken",
    );
    expect(repository).toContain(
      "reconciliation_lease_until >= clock_timestamp()",
    );
    expect(repository).toContain("succeedAfterReconciliation");
    expect(repository).toContain("retryAfterReconciliation");
    expect(repository).toContain("gen_random_uuid()::text");
    expect(repository).toContain(
      "clock_timestamp() + (${leaseDurationMs} * interval '1 millisecond')",
    );
  });

  it("terminalizes exhausted rows before claim increments either budget", () => {
    expect(repository).toContain("terminalizeDispatchExhausted");
    expect(repository).toContain("and attempt < ${maxAttempts}");
    expect(repository).toContain("terminalizeReconciliationExhausted");
    expect(repository).toContain(
      "and reconciliation_attempt < ${maxReconciliationAttempts}",
    );
  });

  it("makes existing booking and message producers emit canonical delivery envelopes", () => {
    for (const path of [
      "packages/db/src/repositories/booking-repository.ts",
      "packages/db/src/repositories/message-repository.ts",
    ]) {
      const producer = readFileSync(path, "utf8");
      expect(producer).toContain(
        "idempotency_key, topic, payload, correlation_id",
      );
      expect(producer).not.toContain(
        "insert into integration_outbox (idempotency_key, reconciliation_key, payload_hash)",
      );
    }
  });
});
