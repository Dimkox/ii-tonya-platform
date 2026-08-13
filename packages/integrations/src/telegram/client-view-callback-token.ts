import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const PREFIX = "cv1.";
const VERSION = 1;
const NONCE_BYTES = 16;
const TAG_BYTES = 16;
const PAYLOAD_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const MAC_DOMAIN = Buffer.from(
  `ii-tonya:telegram-client-view\u0000${PREFIX}`,
  "utf8",
);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TELEGRAM_ID = /^[1-9]\d{0,19}$/u;

export interface ClientViewCallbackClaims {
  readonly reservationId: string;
  readonly expertId: string;
  readonly version: number;
  readonly expiresAtEpochSeconds: number;
}

export interface ClientViewCallbackStore {
  put(tokenHash: string, claims: ClientViewCallbackClaims): Promise<void>;
  peek(tokenHash: string): Promise<ClientViewCallbackClaims | null>;
}

export interface ClientViewExpertBinding {
  readonly telegramUserId: string;
  readonly expertId: string;
  readonly active: boolean;
  readonly verified: boolean;
}

class ClientViewCallbackStateError extends Error {}

export class ClientViewCallbackVerificationError extends Error {
  constructor() {
    super("Client view callback verification failed");
    this.name = "ClientViewCallbackVerificationError";
  }
}

const validateClaims = (claims: ClientViewCallbackClaims): void => {
  if (
    !UUID.test(claims.reservationId) ||
    !UUID.test(claims.expertId) ||
    !Number.isSafeInteger(claims.version) ||
    claims.version < 1 ||
    !Number.isSafeInteger(claims.expiresAtEpochSeconds) ||
    claims.expiresAtEpochSeconds < 1
  ) {
    throw new ClientViewCallbackStateError();
  }
};

const requireSecret = (secret: Uint8Array): void => {
  if (secret.byteLength < 32) throw new ClientViewCallbackStateError();
};

const digest = (nonce: Uint8Array): string =>
  createHash("sha256").update(nonce).digest("hex");

const tag = (nonce: Uint8Array, secret: Uint8Array): Buffer =>
  createHmac("sha256", secret)
    .update(MAC_DOMAIN)
    .update(Buffer.from([VERSION]))
    .update(nonce)
    .digest()
    .subarray(0, TAG_BYTES);

const parse = (token: string): { nonce: Buffer; tag: Buffer } => {
  if (!token.startsWith(PREFIX)) throw new ClientViewCallbackStateError();
  const encoded = token.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new ClientViewCallbackStateError();
  }
  const payload = Buffer.from(encoded, "base64url");
  if (
    payload.byteLength !== PAYLOAD_BYTES ||
    payload[0] !== VERSION ||
    payload.toString("base64url") !== encoded
  ) {
    throw new ClientViewCallbackStateError();
  }
  return {
    nonce: payload.subarray(1, 1 + NONCE_BYTES),
    tag: payload.subarray(1 + NONCE_BYTES),
  };
};

export async function issueClientViewCallback(
  claims: ClientViewCallbackClaims,
  secret: Uint8Array,
  store: ClientViewCallbackStore,
): Promise<string> {
  validateClaims(claims);
  requireSecret(secret);
  const nonce = randomBytes(NONCE_BYTES);
  const payload = Buffer.concat([
    Buffer.from([VERSION]),
    nonce,
    tag(nonce, secret),
  ]);
  const token = `${PREFIX}${payload.toString("base64url")}`;
  if (Buffer.byteLength(token, "utf8") > 64) {
    throw new ClientViewCallbackStateError();
  }
  await store.put(digest(nonce), claims);
  return token;
}

export async function authenticateClientViewCallback(
  token: string,
  telegramUserId: string,
  binding: ClientViewExpertBinding,
  secret: Uint8Array,
  store: ClientViewCallbackStore,
  now: Date,
): Promise<{ tokenHash: string; claims: ClientViewCallbackClaims }> {
  try {
    requireSecret(secret);
    const parsed = parse(token);
    if (!timingSafeEqual(parsed.tag, tag(parsed.nonce, secret))) {
      throw new ClientViewCallbackStateError();
    }
    const tokenHash = digest(parsed.nonce);
    const claims = await store.peek(tokenHash);
    if (claims === null) throw new ClientViewCallbackStateError();
    validateClaims(claims);
    if (
      !TELEGRAM_ID.test(telegramUserId) ||
      binding.telegramUserId !== telegramUserId ||
      !binding.active ||
      !binding.verified ||
      claims.expertId !== binding.expertId ||
      claims.expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)
    ) {
      throw new ClientViewCallbackStateError();
    }
    return { tokenHash, claims };
  } catch (error) {
    if (!(error instanceof ClientViewCallbackStateError)) throw error;
    throw new ClientViewCallbackVerificationError();
  }
}
