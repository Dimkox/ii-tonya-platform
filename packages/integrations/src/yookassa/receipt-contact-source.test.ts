import { describe, expect, it, vi } from "vitest";
import { ConsentBoundYooKassaReceiptContactSource } from "./receipt-contact-source.js";

const row = {
  contactId: "contact-1",
  contactKind: "email" as const,
  ciphertext: "cipher:v1:opaque",
  keyReference: "kms:yookassa-receipt-v1",
  consentDecision: "granted" as const,
  consentPurpose: "fiscal_receipt",
  policyVersion: "policy-v1",
  verifiedAt: "2026-08-14T10:00:00.000Z",
  revokedAt: null,
};

describe("consent-bound YooKassa receipt contacts", () => {
  it.each([
    ["missing", null],
    ["revoked", { ...row, revokedAt: "2026-08-14T11:00:00.000Z" }],
    ["denied", { ...row, consentDecision: "denied" as const }],
    ["purpose mismatch", { ...row, consentPurpose: "marketing" }],
    ["policy mismatch", { ...row, policyVersion: "policy-v0" }],
  ])("fails closed for %s authority", async (_name, candidate) => {
    const decrypt = vi.fn();
    const source = new ConsentBoundYooKassaReceiptContactSource({
      authority: { latestForOrder: vi.fn().mockResolvedValue(candidate) },
      decryptor: { decrypt },
      consentPurpose: "fiscal_receipt",
      policyVersion: "policy-v1",
    });
    await expect(source.receiptContactForOrder("order-1")).resolves.toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("decrypts one verified contact and returns only an opaque authority reference", async () => {
    const source = new ConsentBoundYooKassaReceiptContactSource({
      authority: { latestForOrder: vi.fn().mockResolvedValue(row) },
      decryptor: {
        decrypt: vi
          .fn()
          .mockResolvedValue({ kind: "email", value: "buyer@example.test" }),
      },
      consentPurpose: "fiscal_receipt",
      policyVersion: "policy-v1",
    });
    const contact = await source.receiptContactForOrder("order-1");
    expect(contact).toEqual({
      email: "buyer@example.test",
      authorityReference: "receipt_contact:contact-1",
    });
    expect(JSON.stringify(contact)).not.toContain("cipher:v1:opaque");
    expect(JSON.stringify(contact)).not.toContain("kms:yookassa-receipt-v1");
  });

  it("fails closed when decrypted material does not match the stored kind", async () => {
    const source = new ConsentBoundYooKassaReceiptContactSource({
      authority: { latestForOrder: vi.fn().mockResolvedValue(row) },
      decryptor: {
        decrypt: vi
          .fn()
          .mockResolvedValue({ kind: "phone", value: "+70000000000" }),
      },
      consentPurpose: "fiscal_receipt",
      policyVersion: "policy-v1",
    });
    await expect(source.receiptContactForOrder("order-1")).resolves.toBeNull();
  });
});
