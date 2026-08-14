import type { YooKassaReceiptContact, YooKassaReceiptContactPort } from "./operation-port.js";

export type YooKassaReceiptContactKind = "email" | "phone";

export interface EncryptedYooKassaReceiptContact {
  readonly contactId: string;
  readonly contactKind: YooKassaReceiptContactKind;
  readonly ciphertext: string;
  readonly keyReference: string;
  readonly consentDecision: "granted" | "denied";
  readonly consentPurpose: string;
  readonly policyVersion: string;
  readonly verifiedAt: string | null;
  readonly revokedAt: string | null;
}

export interface YooKassaReceiptContactAuthority {
  /** The implementation owns order -> expert -> user traversal and returns at most one latest row. */
  latestForOrder(orderId: string, consentPurpose: string, policyVersion: string): Promise<EncryptedYooKassaReceiptContact | null>;
}

export interface YooKassaReceiptContactDecryptor {
  /** Resolves keyReference outside application config; plaintext must never be persisted or logged. */
  decrypt(input: Pick<EncryptedYooKassaReceiptContact, "ciphertext" | "keyReference">): Promise<{
    readonly kind: YooKassaReceiptContactKind;
    readonly value: string;
  }>;
}

export interface ConsentBoundYooKassaReceiptContactSourceDeps {
  readonly authority: YooKassaReceiptContactAuthority;
  readonly decryptor: YooKassaReceiptContactDecryptor;
  readonly consentPurpose: string;
  readonly policyVersion: string;
}

const CONFIG_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const KEY_REFERENCE = /^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9._/-]{1,192}$/u;

export class ConsentBoundYooKassaReceiptContactSource implements YooKassaReceiptContactPort {
  constructor(private readonly deps: ConsentBoundYooKassaReceiptContactSourceDeps) {}

  async receiptContactForOrder(orderId: string): Promise<YooKassaReceiptContact | null> {
    if (
      !CONFIG_VALUE.test(this.deps.consentPurpose) ||
      !CONFIG_VALUE.test(this.deps.policyVersion)
    ) return null;
    const contact = await this.deps.authority.latestForOrder(
      orderId,
      this.deps.consentPurpose,
      this.deps.policyVersion,
    );
    if (
      contact === null ||
      contact.consentDecision !== "granted" ||
      contact.consentPurpose !== this.deps.consentPurpose ||
      contact.policyVersion !== this.deps.policyVersion ||
      contact.verifiedAt === null ||
      contact.revokedAt !== null ||
      !OPAQUE_ID.test(contact.contactId) ||
      !KEY_REFERENCE.test(contact.keyReference)
    ) return null;
    const plaintext = await this.deps.decryptor.decrypt({
      ciphertext: contact.ciphertext,
      keyReference: contact.keyReference,
    });
    if (plaintext.kind !== contact.contactKind || plaintext.value.length === 0) return null;
    const authorityReference = `receipt_contact:${contact.contactId}`;
    return plaintext.kind === "email"
      ? { email: plaintext.value, authorityReference }
      : { phone: plaintext.value, authorityReference };
  }
}
