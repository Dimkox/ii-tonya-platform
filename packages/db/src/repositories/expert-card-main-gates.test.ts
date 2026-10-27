import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  createYooKassaClient,
  YooKassaPaymentVerifier,
  type YooKassaOperation,
} from "@ii-tonya/integrations";
import { prepareMainCardSettlement } from "./expert-card-main-gates.js";
import type { ExpertCardTransaction } from "./expert-card-repository.js";
const orderId = "00000000-0000-4000-8000-000000000111";
const expertId = "00000000-0000-4000-8000-000000000112";
async function proof() {
  const operation: YooKassaOperation = {
    id: "00000000-0000-4000-8000-000000000113",
    orderId,
    paymentAttemptId: "00000000-0000-4000-8000-000000000114",
    kind: "create_payment",
    mode: "test",
    providerObjectId: "synthetic-main-verified",
    amountMinor: "50000",
    currency: "RUB",
    requestDigest: `sha256:${"a".repeat(64)}`,
    idempotencyKey: "00000000-0000-4000-8000-000000000115",
    status: "pending",
  };
  const client = createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-fixture-only" },
    async () =>
      new Response(
        JSON.stringify({
          id: operation.providerObjectId,
          status: "succeeded",
          paid: true,
          amount: { value: "500.00", currency: "RUB" },
          test: true,
          created_at: "2026-10-23T10:00:00.000Z",
          captured_at: "2026-10-23T10:01:00.000Z",
          metadata: { order_id: orderId },
          refundable: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  const event = await new YooKassaPaymentVerifier(client, {
    resolve: async () => {},
  }).verifyPayment(operation);
  if (!event) throw new Error("fixture_verification_failed");
  return event;
}
describe("main-card canonical settlement admission", () => {
  it("rejects a copied GET proof before reading storage", async () => {
    const event = await proof();
    const execute = vi.fn();
    await expect(
      prepareMainCardSettlement(
        { execute } as unknown as ExpertCardTransaction,
        { ...event },
        { id: orderId, expertId },
      ),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects a genuinely verified payment for another stored order before any await", async () => {
    const event = await proof();
    const execute = vi.fn();
    await expect(
      prepareMainCardSettlement(
        { execute } as unknown as ExpertCardTransaction,
        event,
        { id: "00000000-0000-4000-8000-000000000199", expertId },
      ),
    ).rejects.toThrow("card_main_payment_binding_mismatch");
    expect(execute).not.toHaveBeenCalled();
  });
  it("requires the exact processing canonical inbox before activation even for genuine GET proof", async () => {
    const event = await proof();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ userId: "00000000-0000-4000-8000-000000000116" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            userId: "00000000-0000-4000-8000-000000000116",
            applicationId: null,
            reviewId: null,
            revision: 1,
            publicDigest: `sha256:${"b".repeat(64)}`,
            mode: "test",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      prepareMainCardSettlement(
        { execute } as unknown as ExpertCardTransaction,
        event,
        { id: orderId, expertId },
      ),
    ).rejects.toThrow("card_main_payment_binding_mismatch");
    expect(execute).toHaveBeenCalledTimes(5);
    const dialect = new PgDialect();
    const statements = execute.mock.calls.map(
      ([query]) => dialect.sqlToQuery(query).sql,
    );
    expect(statements[0]).not.toContain("for update");
    expect(statements[1]).toContain("lock table consent_document_versions");
    expect(statements[2]).toContain("pg_advisory_xact_lock");
    expect(statements[3]).toContain("for update");
  });
});
