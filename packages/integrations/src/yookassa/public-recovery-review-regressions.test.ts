import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { recoverExactYooKassaOperation } from "./exact-body-recovery.js";
import {
  assertPublicExpertFreshObservation,
  PublicExpertRecovery,
} from "./public-expert-recovery.js";
import type { PublicExpertPaymentSnapshot } from "./public-expert-gateway-contracts.js";
import type { YooKassaPayment } from "./contracts.js";

const claim = {
  operationId: randomUUID(),
  operationKind: "create_payment" as const,
  encryptedBody: "opaque-ciphertext",
  bodyVersion: 1,
  keyReference: "kms:replay-v1",
  idempotencyKey: randomUUID(),
  requestDigest: `sha256:${"a".repeat(64)}`,
  leaseToken: randomUUID(),
  status: "unknown_outcome" as const,
  providerObjectId: null,
};

it("rechecks the database lease after decryption and sends zero POSTs when admission expired", async () => {
  const events: string[] = [];
  let releaseDecrypt!: (value: { body: string; bodyVersion: number }) => void;
  let notifyDecryptStarted!: () => void;
  const decryptStarted = new Promise<void>((resolve) => {
    notifyDecryptStarted = resolve;
  });
  let leaseCurrent = true;
  const postExact = vi.fn(async () => {
    events.push("post");
    return { providerObjectId: "payment_1" };
  });
  const recoveryPromise = recoverExactYooKassaOperation({
    enabled: true,
    claim,
    decryptor: {
      decrypt: async () => {
        events.push("decrypt");
        notifyDecryptStarted();
        return new Promise((resolve) => {
          releaseDecrypt = resolve;
        });
      },
    },
    admission: {
      admit: async (operationId, leaseToken) => {
        events.push("admit");
        expect(operationId).toBe(claim.operationId);
        expect(leaseToken).toBe(claim.leaseToken);
        return leaseCurrent;
      },
    },
    transport: { postExact },
    completion: {
      bind: vi.fn(),
      manualReview: vi.fn(),
      reschedule: vi.fn(),
    },
  });
  await decryptStarted;
  leaseCurrent = false; // The lease expires while asynchronous decryption is pending.
  releaseDecrypt({ body: "{}", bodyVersion: 1 });
  const result = await recoveryPromise;

  expect(result).toEqual({ kind: "ineligible" });
  expect(events).toEqual(["decrypt", "admit"]);
  expect(postExact).not.toHaveBeenCalled();
});

it("admits the retained claim immediately before the exact POST", async () => {
  const events: string[] = [];
  const result = await recoverExactYooKassaOperation({
    enabled: true,
    claim,
    decryptor: {
      decrypt: async () => {
        events.push("decrypt");
        return { body: "{}", bodyVersion: 1 };
      },
    },
    admission: {
      admit: async () => {
        events.push("admit");
        return true;
      },
    },
    transport: {
      postExact: async () => {
        events.push("post");
        return { providerObjectId: "payment_1" };
      },
    },
    completion: {
      bind: async () => {
        events.push("bind");
      },
      manualReview: vi.fn(),
      reschedule: vi.fn(),
    },
  });

  expect(result).toEqual({ kind: "bound", providerObjectId: "payment_1" });
  expect(events).toEqual(["decrypt", "admit", "post", "bind"]);
});

it("keeps the WeakSet-branded GET fact and nested identity immutable after return", async () => {
  const requestId = randomUUID();
  const snapshot: PublicExpertPaymentSnapshot = {
    version: 1,
    requestId,
    userId: randomUUID(),
    product: "onboarding",
    kind: "onboarding_create",
    legacySourceId: randomUUID(),
    legacyOperationId: randomUUID(),
    mode: "test",
    amountMinor: "300000",
    currency: "RUB",
    idempotencyKey: randomUUID(),
    contactId: randomUUID(),
    parentPaymentId: null,
    requestDigest: `sha256:${"b".repeat(64)}`,
    bodyVersion: 1,
    bodyExpiresAt: "2027-01-11T13:00:00.000Z",
    paymentDeadline: "2027-01-11T14:00:00.000Z",
    providerDeadline: "2027-01-11T14:00:00.000Z",
    createdAt: "2027-01-11T12:00:00.000Z",
    state: "uncertain",
    providerObjectId: null,
    envelope: null,
  };
  const payment: YooKassaPayment = {
    id: "public-payment",
    status: "pending",
    paid: false,
    test: true,
    amount: { value: "3000.00", currency: "RUB" },
    createdAt: "2027-01-11T12:00:01.000Z",
    metadata: {
      purpose: "onboarding",
      operation_id: snapshot.legacyOperationId,
      order_id: snapshot.legacySourceId,
      user_id: snapshot.userId,
    },
    refundable: false,
  };
  let persisted: object | undefined;
  const recovery = new PublicExpertRecovery({
    binder: {
      candidate: async () => snapshot,
      bind: async () => ({ ...snapshot, providerObjectId: payment.id }),
    },
    observations: {
      observe: async (observation) => {
        persisted = observation;
        return randomUUID();
      },
    },
    transport: {
      listPayments: async () => ({ complete: true, items: [payment] }),
      getPayment: async () => payment,
      listRefunds: async () => ({ complete: true, items: [] }),
      getRefund: async () => {
        throw new Error("unexpected refund");
      },
    },
    now: () => "2027-01-11T12:00:10.000Z",
  });

  const result = await recovery.recover(requestId);
  expect(result.kind).toBe("observed");
  if (result.kind !== "observed") throw new Error("fresh observation expected");
  const fact = result.observation;
  const digest = fact.evidenceDigest;
  assertPublicExpertFreshObservation(fact);
  expect(Object.isFrozen(fact)).toBe(true);
  expect(Object.isFrozen(fact.identity)).toBe(true);
  expect(Reflect.set(fact, "status", "succeeded")).toBe(false);
  expect(Reflect.set(fact, "paid", true)).toBe(false);
  expect(Reflect.set(fact.identity, "userId", randomUUID())).toBe(false);
  expect(fact.status).toBe("pending");
  expect(fact.paid).toBe(false);
  expect(fact.identity.userId).toBe(snapshot.userId);
  expect(fact.evidenceDigest).toBe(digest);
  expect(persisted).toBe(fact);
  assertPublicExpertFreshObservation(fact);
});
