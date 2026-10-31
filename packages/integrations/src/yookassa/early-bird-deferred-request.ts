import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { serializeYooKassaPaymentRequest } from "./client.js";
import type { YooKassaVatCode } from "./contracts.js";
import {
  parseDeferredSnapshot,
  type DeferredSnapshot,
} from "./early-bird-deferred-verifier.js";

const sourceSchema = z
  .object({
    idempotencyKey: z.uuidv4(),
    customer: z.object({ email: z.email().max(254) }).strict(),
    returnUrl: z.url().max(2048),
    fiscal: z
      .object({
        vatCode: z.number().int().min(1).max(12),
        paymentSubject: z.string().regex(/^[a-z_]{1,64}$/u),
        paymentMode: z.string().regex(/^[a-z_]{1,64}$/u),
      })
      .strict(),
  })
  .strict();
export type DeferredRequestSource = z.input<typeof sourceSchema> & {
  snapshot: DeferredSnapshot;
};
export type DeferredSealedRequest = Readonly<{
  ciphertext: string;
  keyReference: string;
  digest: string;
}>;
export function buildDeferredRequest(input: DeferredRequestSource): {
  body: string;
  digest: string;
} {
  const { snapshot: raw, ...rest } = input;
  const s = parseDeferredSnapshot(raw),
    source = sourceSchema.parse(rest),
    url = new URL(source.returnUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    Date.parse(s.launchAt) !== Date.parse("2027-01-11T00:00:00+03:00") ||
    (s.policy === "owner_test_10_20_v1" &&
      (s.mode !== "live" ||
        !s.grantId ||
        s.amountMinor !== (s.stage === "onboarding" ? "1000" : "2000"))) ||
    (s.policy === "wave1_standard_v1" &&
      (s.grantId !== null ||
        (s.stage === "onboarding" && s.amountMinor !== "300000")))
  )
    throw new Error("early_bird_deferred_request_invalid");
  const description =
    s.stage === "onboarding" ? "Онбординг" : "Тариф резидента";
  const body = serializeYooKassaPaymentRequest({
    amountMinor: BigInt(s.amountMinor),
    idempotencyKey: source.idempotencyKey,
    description,
    returnUrl: source.returnUrl,
    metadata: {
      order_id: s.invoiceId,
      operation_id: s.operationId,
      user_id: s.userId,
      purpose: "early_bird_deferred",
      stage: s.stage,
      pricing_policy: s.policy,
      ...(s.grantId ? { pricing_grant_id: s.grantId } : {}),
    },
    receipt: {
      customer: source.customer,
      item: {
        ...source.fiscal,
        vatCode: source.fiscal.vatCode as YooKassaVatCode,
        description,
      },
    },
  });
  return {
    body,
    digest: `sha256:${createHash("sha256").update(body).digest("hex")}`,
  };
}
const validKey = (key: Buffer, ref: string) =>
  Buffer.isBuffer(key) &&
  key.length === 32 &&
  /^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$/u.test(ref);
function aad(source: DeferredRequestSource, ref: string, digest: string) {
  return Buffer.from(
    JSON.stringify([
      "early-bird-deferred-v1",
      parseDeferredSnapshot(source.snapshot),
      source.idempotencyKey,
      ref,
      digest,
    ]),
  );
}
export function sealDeferredRequest(
  source: DeferredRequestSource,
  key: Buffer,
  keyReference: string,
): DeferredSealedRequest {
  if (!validKey(key, keyReference))
    throw new Error("early_bird_deferred_seal_invalid");
  const built = buildDeferredRequest(source),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(source, keyReference, built.digest));
  const data = Buffer.concat([
    cipher.update(built.body, "utf8"),
    cipher.final(),
  ]);
  return {
    keyReference,
    digest: built.digest,
    ciphertext: [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      data.toString("base64url"),
    ].join("."),
  };
}
export function openDeferredRequest(
  source: DeferredRequestSource,
  sealed: DeferredSealedRequest,
  key: Buffer,
): string {
  try {
    if (
      !validKey(key, sealed.keyReference) ||
      !/^sha256:[a-f0-9]{64}$/u.test(sealed.digest) ||
      sealed.ciphertext.length > 262144
    )
      throw new Error();
    const built = buildDeferredRequest(source);
    if (built.digest !== sealed.digest) throw new Error();
    const parts = sealed.ciphertext.split(".");
    if (
      parts.length !== 4 ||
      parts[0] !== "v1" ||
      parts.slice(1).some((p) => !/^[A-Za-z0-9_-]+$/u.test(p!))
    )
      throw new Error();
    const decode = (p: string) => {
      const b = Buffer.from(p, "base64url");
      if (b.toString("base64url") !== p) throw new Error();
      return b;
    };
    const iv = decode(parts[1]!),
      tag = decode(parts[2]!),
      bytes = decode(parts[3]!);
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad(source, sealed.keyReference, sealed.digest));
    decipher.setAuthTag(tag);
    const actual = Buffer.concat([decipher.update(bytes), decipher.final()]),
      expected = Buffer.from(built.body);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error();
    return built.body;
  } catch {
    throw new Error("early_bird_deferred_seal_invalid");
  }
}
