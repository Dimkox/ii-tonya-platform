import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { buildEarlyBirdOwnerRequest } from "./early-bird-request.js";

type Source = Parameters<typeof buildEarlyBirdOwnerRequest>[0];
type Sealed = {
  readonly ciphertext: string;
  readonly keyReference: string;
  readonly digest: string;
};
const keyRef = /^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$/u;
const digest = /^sha256:[a-f0-9]{64}$/u;
const b64 = /^[A-Za-z0-9_-]+$/u;

function aad(source: Source, value: Sealed): Buffer {
  return Buffer.from(
    JSON.stringify([
      "early-bird-owner-request",
      1,
      value.keyReference,
      value.digest,
      source.intent.userId,
      source.intent.operationId,
      source.intent.invoiceId,
      source.intent.idempotencyKey,
      source.intent.grantId,
      source.intent.pricingPolicy,
      source.intent.priceKind,
      source.intent.mode,
      source.intent.onboardingMinor,
      source.intent.subscriptionMinor,
      source.intent.totalMinor,
      Date.parse(source.intent.baseOfferShownAt),
      Date.parse(source.intent.expiresAt),
      Date.parse(source.intent.launchAt),
    ]),
    "utf8",
  );
}
function validKey(key: Buffer, ref: string): boolean {
  return Buffer.isBuffer(key) && key.length === 32 && keyRef.test(ref);
}
/** Seal only the canonical owner request; callers must keep the key in a secret manager. */
export function sealEarlyBirdOwnerRequest(
  source: Source,
  key: Buffer,
  keyReference: string,
): Sealed {
  try {
    if (!validKey(key, keyReference)) throw new Error();
    const request = buildEarlyBirdOwnerRequest(source);
    const iv = randomBytes(12);
    const result = { keyReference, digest: request.digest, ciphertext: "" };
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(source, result));
    const bytes = Buffer.concat([
      cipher.update(request.body, "utf8"),
      cipher.final(),
    ]);
    const ciphertext = [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      bytes.toString("base64url"),
    ].join(".");
    if (ciphertext.length > 262144) throw new Error();
    return Object.freeze({ ...result, ciphertext });
  } catch {
    throw new Error("early_bird_sealed_request_invalid");
  }
}
/** Authenticate the envelope and independently rebuild the entire request from trusted intent and receipt data. */
export function openEarlyBirdOwnerRequest(
  source: Source,
  sealed: Sealed,
  key: Buffer,
): ReturnType<typeof buildEarlyBirdOwnerRequest> {
  try {
    if (
      !sealed ||
      !validKey(key, sealed.keyReference) ||
      !digest.test(sealed.digest) ||
      typeof sealed.ciphertext !== "string" ||
      sealed.ciphertext.length > 262144
    )
      throw new Error();
    const expected = buildEarlyBirdOwnerRequest(source);
    if (expected.digest !== sealed.digest) throw new Error();
    const parts = sealed.ciphertext.split(".");
    if (
      parts.length !== 4 ||
      parts[0] !== "v1" ||
      parts.slice(1).some((part) => !b64.test(part!))
    )
      throw new Error();
    const decode = (part: string) => {
      const buffer = Buffer.from(part, "base64url");
      if (buffer.toString("base64url") !== part) throw new Error();
      return buffer;
    };
    const iv = decode(parts[1]!),
      tag = decode(parts[2]!),
      bytes = decode(parts[3]!);
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad(source, sealed));
    decipher.setAuthTag(tag);
    const opened = Buffer.concat([decipher.update(bytes), decipher.final()]);
    const canonical = Buffer.from(expected.body, "utf8");
    if (
      opened.length !== canonical.length ||
      !timingSafeEqual(opened, canonical)
    )
      throw new Error();
    return expected;
  } catch {
    throw new Error("early_bird_sealed_request_invalid");
  }
}
