import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_PREFIX = "ct1.";
const TOKEN_VERSION = 1;
const NONCE_BYTES = 16;
const TAG_BYTES = 16;
const PAYLOAD_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const MAX_CALLBACK_BYTES = 64;
const MINIMUM_SECRET_BYTES = 32;
const MAC_DOMAIN = Buffer.from(
  `ii-tonya:telegram-callback\u0000${TOKEN_PREFIX}`,
  "utf8",
);
const numericTelegramIdentity = /^[1-9]\d*$/u;

export interface ExpertCallbackClaims {
  reservationId: string;
  expertId: string;
  action: "confirm" | "cancel";
  version: number;
  expiresAtEpochSeconds: number;
}

export interface ExpertBinding {
  telegramUserId: string;
  expertId: string;
  active: boolean;
  verified: boolean;
}

export interface CallbackClaimsStore {
  put(tokenHash: string, claims: ExpertCallbackClaims): Promise<void>;
  peek(tokenHash: string): Promise<ExpertCallbackClaims | null>;
  consumeIfValid(input: {
    tokenHash: string;
    expertId: string;
    action: "confirm" | "cancel";
    version: number;
    now: Date;
  }): Promise<ExpertCallbackClaims | null>;
}

const validateClaims = (claims: ExpertCallbackClaims): void => {
  if (
    claims.reservationId.length === 0 ||
    claims.expertId.length === 0 ||
    (claims.action !== "confirm" && claims.action !== "cancel") ||
    !Number.isSafeInteger(claims.version) ||
    claims.version <= 0 ||
    !Number.isSafeInteger(claims.expiresAtEpochSeconds) ||
    claims.expiresAtEpochSeconds <= 0
  ) {
    throw new Error("Invalid callback claims");
  }
};

const tokenHash = (nonce: Uint8Array): string =>
  createHash("sha256").update(nonce).digest("hex");

const callbackTag = (nonce: Uint8Array, secret: Uint8Array): Buffer =>
  createHmac("sha256", secret)
    .update(MAC_DOMAIN)
    .update(Buffer.from([TOKEN_VERSION]))
    .update(nonce)
    .digest()
    .subarray(0, TAG_BYTES);

const requireStrongSecret = (secret: Uint8Array): void => {
  if (secret.byteLength < MINIMUM_SECRET_BYTES) {
    throw new Error("Callback secret must be at least 32 bytes");
  }
};

export class CallbackVerificationError extends Error {
  constructor() {
    super("Callback verification failed");
    this.name = "CallbackVerificationError";
  }
}

const parseToken = (
  token: string,
): { nonce: Buffer; authenticatedTag: Buffer } => {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new Error("Invalid callback token");
  }
  const encoded = token.slice(TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new Error("Invalid callback token");
  }
  const payload = Buffer.from(encoded, "base64url");
  if (
    payload.byteLength !== PAYLOAD_BYTES ||
    payload[0] !== TOKEN_VERSION ||
    payload.toString("base64url") !== encoded
  ) {
    throw new Error("Invalid callback token");
  }
  return {
    nonce: payload.subarray(1, 1 + NONCE_BYTES),
    authenticatedTag: payload.subarray(1 + NONCE_BYTES),
  };
};

export async function issueCallback(
  claims: ExpertCallbackClaims,
  secret: Uint8Array,
  store: CallbackClaimsStore,
): Promise<string> {
  validateClaims(claims);
  requireStrongSecret(secret);

  const nonce = randomBytes(NONCE_BYTES);
  const payload = Buffer.concat([
    Buffer.from([TOKEN_VERSION]),
    nonce,
    callbackTag(nonce, secret),
  ]);
  const token = `${TOKEN_PREFIX}${payload.toString("base64url")}`;
  if (Buffer.byteLength(token, "utf8") > MAX_CALLBACK_BYTES) {
    throw new Error("Callback token exceeds Telegram limit");
  }
  await store.put(tokenHash(nonce), claims);
  return token;
}

export async function verifyCallback(
  token: string,
  expectedTelegramUserId: string,
  binding: ExpertBinding,
  secret: Uint8Array,
  store: CallbackClaimsStore,
  now: Date,
): Promise<ExpertCallbackClaims> {
  try {
    return await verifyCallbackInternal(
      token,
      expectedTelegramUserId,
      binding,
      secret,
      store,
      now,
    );
  } catch {
    throw new CallbackVerificationError();
  }
}

async function verifyCallbackInternal(
  token: string,
  expectedTelegramUserId: string,
  binding: ExpertBinding,
  secret: Uint8Array,
  store: CallbackClaimsStore,
  now: Date,
): Promise<ExpertCallbackClaims> {
  requireStrongSecret(secret);
  const { nonce, authenticatedTag } = parseToken(token);
  const expectedTag = callbackTag(nonce, secret);
  if (!timingSafeEqual(authenticatedTag, expectedTag)) {
    throw new Error("Invalid callback token");
  }

  const hash = tokenHash(nonce);
  const claims = await store.peek(hash);
  if (claims === null) {
    throw new Error("Callback token is unknown or already used");
  }
  validateClaims(claims);

  if (
    !numericTelegramIdentity.test(expectedTelegramUserId) ||
    binding.telegramUserId !== expectedTelegramUserId
  ) {
    throw new Error("Telegram identity is not authorized");
  }
  if (!binding.active || !binding.verified) {
    throw new Error("Expert binding is not eligible");
  }
  if (claims.expertId !== binding.expertId) {
    throw new Error("Expert binding does not match callback");
  }
  if (claims.expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)) {
    throw new Error("Callback token has expired");
  }

  const consumed = await store.consumeIfValid({
    tokenHash: hash,
    expertId: claims.expertId,
    action: claims.action,
    version: claims.version,
    now,
  });
  if (consumed === null) {
    throw new Error("Callback token is unknown or already used");
  }
  return consumed;
}
