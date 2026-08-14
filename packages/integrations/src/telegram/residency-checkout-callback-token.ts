import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "xr1.";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TELEGRAM_ID = /^[1-9]\d{0,19}$/u;
const domain = Buffer.from("ii-tonya:expert-residency-checkout:xr1\0", "utf8");
const issuanceDomain = Buffer.from(
  "ii-tonya:expert-residency-checkout:xr1:issue:v1\0",
  "utf8",
);

export interface ResidencyCheckoutCallbackClaims {
  readonly expertId: string;
  readonly telegramUserId: string;
  readonly tariffVersionId: string;
  readonly action: "start_residency_checkout";
  readonly expiresAt: Date;
}

export interface ResidencyCheckoutCallbackStore {
  put(
    tokenHash: string,
    claims: ResidencyCheckoutCallbackClaims,
    idempotencyKey: string,
  ): Promise<void>;
  consume(
    tokenHash: string,
    claims: Omit<ResidencyCheckoutCallbackClaims, "expiresAt">,
    now: Date,
  ): Promise<ResidencyCheckoutCallbackClaims | null>;
}

export type ResidencyCheckoutStoredOutcome =
  | { readonly kind: "ready"; readonly checkoutUrl: string }
  | { readonly kind: "unavailable" | "unknown" };

export type ResidencyCheckoutStateClaim =
  | {
      readonly kind: "acquired";
      readonly tokenHash: string;
      readonly claims: ResidencyCheckoutCallbackClaims;
      readonly fence: string;
      readonly recovery: boolean;
    }
  | {
      readonly kind: "replay";
      readonly tokenHash: string;
      readonly outcome: ResidencyCheckoutStoredOutcome;
    }
  | { readonly kind: "processing"; readonly tokenHash: string };

export interface ResidencyCheckoutStateStore extends ResidencyCheckoutCallbackStore {
  inspectCheckout(
    tokenHash: string,
    expertId: string,
    telegramUserId: string,
    now: Date,
  ): Promise<ResidencyCheckoutCallbackClaims | null>;
  claimCheckout(
    tokenHash: string,
    claims: Omit<ResidencyCheckoutCallbackClaims, "expiresAt">,
    now: Date,
    leaseUntil: Date,
    fence: string,
  ): Promise<ResidencyCheckoutStateClaim | null>;
  recordCheckoutOutcome(
    tokenHash: string,
    fence: string,
    outcome: ResidencyCheckoutStoredOutcome,
    now: Date,
  ): Promise<boolean>;
}

const valid = (claims: ResidencyCheckoutCallbackClaims): boolean =>
  UUID.test(claims.expertId) &&
  TELEGRAM_ID.test(claims.telegramUserId) &&
  UUID.test(claims.tariffVersionId) &&
  claims.action === "start_residency_checkout" &&
  Number.isFinite(claims.expiresAt.getTime());
const digest = (nonce: Uint8Array): string =>
  createHash("sha256").update(nonce).digest("hex");
const issuanceNonce = (
  idempotencyKey: string,
  claims: Omit<ResidencyCheckoutCallbackClaims, "expiresAt">,
  secret: Uint8Array,
): Buffer =>
  createHmac("sha256", secret)
    .update(issuanceDomain)
    .update(idempotencyKey)
    .update("\0")
    .update(claims.telegramUserId)
    .update("\0")
    .update(claims.expertId)
    .update("\0")
    .update(claims.tariffVersionId)
    .digest()
    .subarray(0, 16);
const mac = (
  nonce: Uint8Array,
  claims: Omit<ResidencyCheckoutCallbackClaims, "expiresAt">,
  secret: Uint8Array,
): Buffer =>
  createHmac("sha256", secret)
    .update(domain)
    .update(claims.telegramUserId)
    .update("\0")
    .update(claims.expertId)
    .update("\0")
    .update(claims.tariffVersionId)
    .update("\0")
    .update(nonce)
    .digest()
    .subarray(0, 16);

export class ResidencyCheckoutCallbackVerificationError extends Error {
  constructor() {
    super("Residency checkout callback verification failed");
  }
}

const decode = (
  token: string,
): { nonce: Buffer; tokenHash: string; mac: Buffer } => {
  if (!token.startsWith(PREFIX)) throw new Error();
  const payload = Buffer.from(token.slice(PREFIX.length), "base64url");
  if (
    payload.length !== 32 ||
    token !== `${PREFIX}${payload.toString("base64url")}`
  ) {
    throw new Error();
  }
  const nonce = payload.subarray(0, 16);
  return { nonce, tokenHash: digest(nonce), mac: payload.subarray(16) };
};

export async function issueResidencyCheckoutCallback(
  claims: ResidencyCheckoutCallbackClaims,
  idempotencyKey: string,
  secret: Uint8Array,
  store: ResidencyCheckoutCallbackStore,
): Promise<string> {
  if (
    !valid(claims) ||
    secret.byteLength < 32 ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > 256
  )
    throw new ResidencyCheckoutCallbackVerificationError();
  const nonce = issuanceNonce(idempotencyKey, claims, secret);
  const token = `${PREFIX}${Buffer.concat([nonce, mac(nonce, claims, secret)]).toString("base64url")}`;
  await store.put(digest(nonce), claims, idempotencyKey);
  return token;
}

export async function authenticateResidencyCheckoutCallback(
  token: string,
  binding: Omit<ResidencyCheckoutCallbackClaims, "expiresAt">,
  secret: Uint8Array,
  store: ResidencyCheckoutCallbackStore,
  now: Date,
) {
  try {
    if (secret.byteLength < 32 || !Number.isFinite(now.getTime()))
      throw new Error();
    const decoded = decode(token);
    if (!timingSafeEqual(decoded.mac, mac(decoded.nonce, binding, secret)))
      throw new Error();
    const claims = await store.consume(decoded.tokenHash, binding, now);
    if (claims === null || claims.expiresAt.getTime() <= now.getTime())
      throw new Error();
    return { tokenHash: decoded.tokenHash, claims };
  } catch {
    throw new ResidencyCheckoutCallbackVerificationError();
  }
}

export async function inspectResidencyCheckoutCallback(
  token: string,
  binding: { readonly expertId: string; readonly telegramUserId: string },
  secret: Uint8Array,
  store: ResidencyCheckoutStateStore,
  now: Date,
): Promise<{ tokenHash: string; claims: ResidencyCheckoutCallbackClaims }> {
  let decoded: ReturnType<typeof decode>;
  try {
    if (
      secret.byteLength < 32 ||
      !UUID.test(binding.expertId) ||
      !TELEGRAM_ID.test(binding.telegramUserId) ||
      !Number.isFinite(now.getTime())
    ) {
      throw new Error();
    }
    decoded = decode(token);
  } catch {
    throw new ResidencyCheckoutCallbackVerificationError();
  }
  const claims = await store.inspectCheckout(
    decoded.tokenHash,
    binding.expertId,
    binding.telegramUserId,
    now,
  );
  try {
    if (
      claims === null ||
      claims.expiresAt.getTime() <= now.getTime() ||
      !timingSafeEqual(decoded.mac, mac(decoded.nonce, claims, secret))
    ) {
      throw new Error();
    }
    return { tokenHash: decoded.tokenHash, claims };
  } catch {
    throw new ResidencyCheckoutCallbackVerificationError();
  }
}
