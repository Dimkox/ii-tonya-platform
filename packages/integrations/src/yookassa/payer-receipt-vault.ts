import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const keyId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/u)
  .refine((s) => !/\s/u.test(s));
const instant = z.iso.datetime({ precision: 3 });
const metadata = z
  .strictObject({
    id: z.uuid(),
    quoteId: z.uuid(),
    userId: z.uuid(),
    kind: z.literal("email"),
    basis: z.literal("fiscal_payment_dec_plt_004_v1"),
    capturedAt: instant,
    expiresAt: instant,
  })
  .refine((v) => Date.parse(v.expiresAt) > Date.parse(v.capturedAt));
export type PayerReceiptBinding = z.infer<typeof metadata>;
export interface PayerReceiptEnvelope {
  keyId: string;
  ciphertext: string;
}
export interface PayerReceiptVault {
  seal(email: string, binding: PayerReceiptBinding): PayerReceiptEnvelope;
  open(envelope: PayerReceiptEnvelope, binding: PayerReceiptBinding): string;
}
const invalid = () => new Error("payer_receipt_vault_invalid");
const configurationInvalid = () =>
  new Error("payer_receipt_configuration_invalid");

/** Dedicated flat keyring: reject duplicate decoded names before JSON loses them. */
export function resolvePayerReceiptKeys(
  raw: string,
): ReadonlyMap<string, Uint8Array> {
  try {
    if (raw.length > 4096) throw configurationInvalid();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw configurationInvalid();
    const names = [...raw.matchAll(/("(?:\\.|[^"\\])*")\s*:/gu)].map(
      (m) => JSON.parse(m[1]!) as string,
    );
    const entries = Object.entries(parsed);
    if (
      entries.length < 1 ||
      entries.length > 8 ||
      names.length !== entries.length ||
      new Set(names).size !== names.length
    )
      throw configurationInvalid();
    const keys = new Map<string, Uint8Array>();
    for (const [id, encoded] of entries) {
      if (
        !keyId.safeParse(id).success ||
        typeof encoded !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/u.test(encoded)
      )
        throw configurationInvalid();
      const bytes = Buffer.from(encoded, "base64url");
      if (bytes.length !== 32 || bytes.toString("base64url") !== encoded)
        throw configurationInvalid();
      keys.set(id, bytes);
    }
    return keys;
  } catch {
    throw configurationInvalid();
  }
}
export function createPayerReceiptVault(options: {
  activeKeyId: string;
  keys: ReadonlyMap<string, Uint8Array>;
}): PayerReceiptVault {
  if (
    !keyId.safeParse(options.activeKeyId).success ||
    options.keys.size < 1 ||
    options.keys.size > 8
  )
    throw configurationInvalid();
  const keys = new Map<string, Buffer>();
  for (const [id, bytes] of options.keys) {
    if (
      !keyId.safeParse(id).success ||
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength !== 32
    )
      throw configurationInvalid();
    keys.set(id, Buffer.from(bytes));
  }
  if (!keys.has(options.activeKeyId)) throw configurationInvalid();
  const aad = (id: string, binding: PayerReceiptBinding) => {
    const b = metadata.parse(binding);
    return Buffer.from(
      JSON.stringify([
        "ii-tonya:payer-receipt:v1",
        id,
        b.id,
        b.quoteId,
        b.userId,
        b.kind,
        b.basis,
        b.capturedAt,
        b.expiresAt,
      ]),
    );
  };
  const emailSchema = z.email().max(254);
  return {
    seal(email, binding) {
      try {
        emailSchema.parse(email);
        const nonce = randomBytes(12),
          cipher = createCipheriv(
            "aes-256-gcm",
            keys.get(options.activeKeyId)!,
            nonce,
            { authTagLength: 16 },
          );
        cipher.setAAD(aad(options.activeKeyId, binding));
        const encrypted = Buffer.concat([
          cipher.update(email, "utf8"),
          cipher.final(),
        ]);
        return {
          keyId: options.activeKeyId,
          ciphertext: `prc1.${Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString("base64url")}`,
        };
      } catch {
        throw invalid();
      }
    },
    open(envelope, binding) {
      try {
        if (
          Object.keys(envelope).length !== 2 ||
          !keyId.safeParse(envelope.keyId).success ||
          !/^prc1\.[A-Za-z0-9_-]{40,400}$/u.test(envelope.ciphertext)
        )
          throw invalid();
        const key = keys.get(envelope.keyId);
        if (!key) throw invalid();
        const encoded = envelope.ciphertext.slice(5),
          raw = Buffer.from(encoded, "base64url");
        if (
          raw.length < 31 ||
          raw.length > 282 ||
          raw.toString("base64url") !== encoded
        )
          throw invalid();
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          raw.subarray(0, 12),
          { authTagLength: 16 },
        );
        decipher.setAAD(aad(envelope.keyId, binding));
        decipher.setAuthTag(raw.subarray(-16));
        const plaintext = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat([
            decipher.update(raw.subarray(12, -16)),
            decipher.final(),
          ]),
        );
        return emailSchema.parse(plaintext);
      } catch {
        throw invalid();
      }
    },
  };
}
