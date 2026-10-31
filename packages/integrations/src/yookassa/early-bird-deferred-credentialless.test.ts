import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { EarlyBirdDeferredCheckoutSender } from "./early-bird-deferred-checkout-sender.js";

it("sends no merchant credential and binds the gateway token to the contact and operation", async () => {
  const userId = crypto.randomUUID(),
    contactId = crypto.randomUUID(),
    invoiceId = crypto.randomUUID(),
    key = crypto.randomUUID(),
    body = "{}";
  const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const dispatch = vi.fn().mockResolvedValue({ kind: "unknown" });
  const sender = new EarlyBirdDeferredCheckoutSender({
    enabled: true,
    admission: {
      admit: async () => ({
        kind: "initial_send_admitted",
        userId,
        receiptContactId: contactId,
        invoiceId,
        operationId: invoiceId,
        idempotencyKey: key,
        digest,
        body,
        amountMinor: "1000",
        stage: "onboarding",
      }),
    },
    gateway: { dispatch },
    verifier: {} as never,
    binding: {} as never,
    client: {} as never,
  });
  expect(
    await sender.createOrRecover({
      userId,
      invoiceId,
      receiptContactId: contactId,
    }),
  ).toEqual({ kind: "reconcile", invoiceId });
  const [contact, attempt, bytes, context] = dispatch.mock.calls[0]!;
  expect(contact).toBe(contactId);
  expect(attempt).toBe(
    createHash("sha256")
      .update(Buffer.from(key.replaceAll("-", ""), "hex"))
      .digest("hex"),
  );
  expect(Buffer.from(bytes).toString("utf8")).not.toMatch(/authorization:/iu);
  expect(context).toEqual({
    userId,
    intentId: invoiceId,
    contactId,
    idempotencyKey: key,
  });
});
