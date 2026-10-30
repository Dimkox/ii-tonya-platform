import { expect, it, vi } from "vitest";
import { createEarlyBirdOwnerPrepareAuthority } from "./early-bird-owner-prepare-authority.js";
const ids = {
  userId: "2526c71d-803f-4c3d-9b57-74e902170001",
  baseId: "2526c71d-803f-4c3d-9b57-74e902170002",
  choiceId: "2526c71d-803f-4c3d-9b57-74e902170003",
  grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170005",
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170006",
  idempotencyKey: "2526c71d-803f-4c3d-9b57-74e902170007",
};
const scope = {
  botId: "1",
  botKey: "fixture",
  telegramUserId: "1",
  chatId: "1",
  offerId: ids.baseId,
  choiceId: ids.choiceId,
};
const fiscal = {
  vatCode: 1,
  paymentSubject: "service",
  paymentMode: "full_payment",
};
it("resolves the owner and authorized contact before creating a sealed intent", async () => {
  const source = { resolve: vi.fn(async () => ids) },
    contacts = {
      read: vi.fn(async () => ({
        id: ids.operationId,
        email: "fixture@example.invalid",
        expiresAt: "2026-11-02T01:00:00.000Z",
      })),
    };
  const prepare = vi.fn(async () => ({ kind: "prepared" as const }));
  const authority = createEarlyBirdOwnerPrepareAuthority({
    source,
    contacts,
    store: { prepare },
    key: Buffer.alloc(32),
    keyReference: "vault:fixture",
    returnUrl: "https://example.invalid/return",
    onboardingFiscal: fiscal,
    subscriptionFiscal: fiscal,
  });
  expect(await authority.prepare(scope)).toEqual({ kind: "prepared" });
  expect(prepare).toHaveBeenCalledWith(
    expect.objectContaining({
      ...ids,
      requestExpiresAt: "2026-11-02T01:00:00.000Z",
    }),
    expect.any(Function),
  );
});
it("does not prepare without a trusted wave contact", async () => {
  const prepare = vi.fn();
  const authority = createEarlyBirdOwnerPrepareAuthority({
    source: { resolve: async () => ids },
    contacts: { read: async () => null },
    store: { prepare },
    key: Buffer.alloc(32),
    keyReference: "vault:fixture",
    returnUrl: "https://example.invalid/return",
    onboardingFiscal: fiscal,
    subscriptionFiscal: fiscal,
  });
  expect(await authority.prepare(scope)).toEqual({ kind: "unavailable" });
  expect(prepare).not.toHaveBeenCalled();
});
