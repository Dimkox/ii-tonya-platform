import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const PREFIX = "xr1.";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TELEGRAM_ID = /^[1-9]\d{0,19}$/u;
const domain = Buffer.from("ii-tonya:expert-residency-checkout:xr1\0", "utf8");

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

const valid = (claims: ResidencyCheckoutCallbackClaims): boolean =>
  UUID.test(claims.expertId) &&
  TELEGRAM_ID.test(claims.telegramUserId) &&
  UUID.test(claims.tariffVersionId) &&
  claims.action === "start_residency_checkout" &&
  Number.isFinite(claims.expiresAt.getTime());
const digest = (nonce: Uint8Array): string =>
  createHash("sha256").update(nonce).digest("hex");
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

export async function issueResidencyCheckoutCallback(
  claims: ResidencyCheckoutCallbackClaims,
  idempotencyKey: string,
  secret: Uint8Array,
  store: ResidencyCheckoutCallbackStore,
): Promise<string> {
  if (!valid(claims) || secret.byteLength < 32 || idempotencyKey.length < 1)
    throw new ResidencyCheckoutCallbackVerificationError();
  const nonce = randomBytes(16);
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
    if (
      !token.startsWith(PREFIX) ||
      secret.byteLength < 32 ||
      !Number.isFinite(now.getTime())
    )
      throw new Error();
    const payload = Buffer.from(token.slice(PREFIX.length), "base64url");
    if (
      payload.length !== 32 ||
      token !== `${PREFIX}${payload.toString("base64url")}`
    )
      throw new Error();
    const nonce = payload.subarray(0, 16);
    if (!timingSafeEqual(payload.subarray(16), mac(nonce, binding, secret)))
      throw new Error();
    const claims = await store.consume(digest(nonce), binding, now);
    if (claims === null || claims.expiresAt.getTime() <= now.getTime())
      throw new Error();
    return { tokenHash: digest(nonce), claims };
  } catch {
    throw new ResidencyCheckoutCallbackVerificationError();
  }
}
