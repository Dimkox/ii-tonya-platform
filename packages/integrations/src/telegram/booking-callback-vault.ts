import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const keyIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const bindingSchema = z
  .object({
    deliveryId: z.uuid(),
    notificationId: z.uuid(),
    reservationId: z.uuid(),
    expertId: z.uuid(),
    botKey: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
    chatId: z
      .string()
      .regex(/^[1-9][0-9]{0,15}$/u)
      .refine((s) => Number.isSafeInteger(Number(s))),
    action: z.enum(["confirm", "cancel"]),
    version: z.number().int().positive().max(2147483647),
    expiresAtEpochSeconds: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const envelopeSchema = z
  .object({
    keyId: keyIdSchema,
    ciphertext: z.string().regex(/^bcn1\.[A-Za-z0-9_-]{102}$/u),
  })
  .strict();
const invalid = () => new Error("booking_callback_vault_invalid");
function requireToken(token: string): void {
  if (!/^ct2\.[A-Za-z0-9_-]{44}$/u.test(token)) throw invalid();
  const payload = Buffer.from(token.slice(4), "base64url");
  if (
    payload.byteLength !== 33 ||
    payload[0] !== 2 ||
    payload.toString("base64url") !== token.slice(4)
  )
    throw invalid();
}
function aad(keyId: string, input: BookingCallbackBinding): Buffer {
  const b = bindingSchema.parse(input);
  return Buffer.from(
    JSON.stringify([
      "ii-tonya:booking-callback:v1",
      keyId,
      b.deliveryId,
      b.notificationId,
      b.reservationId,
      b.expertId,
      b.botKey,
      b.chatId,
      b.action,
      b.version,
      b.expiresAtEpochSeconds,
    ]),
    "utf8",
  );
}

export interface BookingCallbackBinding {
  deliveryId: string;
  notificationId: string;
  reservationId: string;
  expertId: string;
  botKey: string;
  chatId: string;
  action: "confirm" | "cancel";
  version: number;
  expiresAtEpochSeconds: number;
}
export interface SealedBookingCallback {
  keyId: string;
  ciphertext: string;
}
/** Encryption only. Eligibility/HMAC/one-use consumption remain transactional authority. */
export function createBookingCallbackVault(options: {
  activeKeyId: string;
  keys: ReadonlyMap<string, Uint8Array>;
}) {
  const keys = new Map<string, Buffer>();
  const activeKeyId = options.activeKeyId;
  const configInvalid = () =>
    new Error("booking_callback_vault_configuration_invalid");
  if (
    !keyIdSchema.safeParse(activeKeyId).success ||
    options.keys.size < 1 ||
    options.keys.size > 8
  )
    throw configInvalid();
  for (const [id, bytes] of options.keys) {
    if (
      !keyIdSchema.safeParse(id).success ||
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength !== 32
    )
      throw configInvalid();
    keys.set(id, Buffer.from(bytes));
  }
  if (!keys.has(activeKeyId)) throw configInvalid();
  return {
    seal(
      token: string,
      binding: BookingCallbackBinding,
    ): SealedBookingCallback {
      try {
        requireToken(token);
        const associatedData = aad(activeKeyId, binding);
        const nonce = randomBytes(12);
        const cipher = createCipheriv(
          "aes-256-gcm",
          keys.get(activeKeyId)!,
          nonce,
          { authTagLength: 16 },
        );
        cipher.setAAD(associatedData);
        const ciphertext = Buffer.concat([
          cipher.update(token, "utf8"),
          cipher.final(),
        ]);
        return {
          keyId: activeKeyId,
          ciphertext: `bcn1.${Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString("base64url")}`,
        };
      } catch {
        throw invalid();
      }
    },
    open(
      envelope: SealedBookingCallback,
      binding: BookingCallbackBinding,
    ): string {
      try {
        const sealed = envelopeSchema.parse(envelope);
        const key = keys.get(sealed.keyId);
        if (!key) throw invalid();
        const raw = Buffer.from(sealed.ciphertext.slice(5), "base64url");
        if (
          raw.length !== 76 ||
          raw.toString("base64url") !== sealed.ciphertext.slice(5)
        )
          throw invalid();
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          raw.subarray(0, 12),
          { authTagLength: 16 },
        );
        decipher.setAAD(aad(sealed.keyId, binding));
        decipher.setAuthTag(raw.subarray(60));
        const plaintext = Buffer.concat([
          decipher.update(raw.subarray(12, 60)),
          decipher.final(),
        ]);
        const token = new TextDecoder("utf-8", { fatal: true }).decode(
          plaintext,
        );
        requireToken(token);
        return token;
      } catch {
        throw invalid();
      }
    },
  };
}
