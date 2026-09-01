import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { CallbackInfrastructureError } from "@ii-tonya/contracts";

const TOKEN_PREFIX = "ct2.";
const TOKEN_VERSION = 2;
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

export interface AuthenticatedExpertCallback {
  tokenHash: string;
  claims: ExpertCallbackClaims;
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

class CallbackAuthStateError extends Error {}

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
    throw new CallbackAuthStateError("Invalid callback claims");
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
    throw new CallbackAuthStateError(
      "Callback secret must be at least 32 bytes",
    );
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
    throw new CallbackAuthStateError("Invalid callback token");
  }
  const encoded = token.slice(TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new CallbackAuthStateError("Invalid callback token");
  }
  const payload = Buffer.from(encoded, "base64url");
  if (
    payload.byteLength !== PAYLOAD_BYTES ||
    payload[0] !== TOKEN_VERSION ||
    payload.toString("base64url") !== encoded
  ) {
    throw new CallbackAuthStateError("Invalid callback token");
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
    throw new CallbackAuthStateError("Callback token exceeds Telegram limit");
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
    const authenticated = await authenticateCallbackInternal(
      token,
      expectedTelegramUserId,
      binding,
      secret,
      store,
      now,
    );
    const consumed = await store.consumeIfValid({
      tokenHash: authenticated.tokenHash,
      expertId: authenticated.claims.expertId,
      action: authenticated.claims.action,
      version: authenticated.claims.version,
      now,
    });
    if (consumed === null) {
      throw new CallbackAuthStateError(
        "Callback token is unknown or already used",
      );
    }
    return consumed;
  } catch (error) {
    if (error instanceof CallbackInfrastructureError) throw error;
    if (!(error instanceof CallbackAuthStateError)) throw error;
    throw new CallbackVerificationError();
  }
}

export async function authenticateCallback(
  token: string,
  expectedTelegramUserId: string,
  binding: ExpertBinding,
  secret: Uint8Array,
  store: CallbackClaimsStore,
  now: Date,
): Promise<AuthenticatedExpertCallback> {
  try {
    return await authenticateCallbackInternal(
      token,
      expectedTelegramUserId,
      binding,
      secret,
      store,
      now,
    );
  } catch (error) {
    if (error instanceof CallbackInfrastructureError) throw error;
    if (!(error instanceof CallbackAuthStateError)) throw error;
    throw new CallbackVerificationError();
  }
}

async function authenticateCallbackInternal(
  token: string,
  expectedTelegramUserId: string,
  binding: ExpertBinding,
  secret: Uint8Array,
  store: CallbackClaimsStore,
  now: Date,
): Promise<AuthenticatedExpertCallback> {
  requireStrongSecret(secret);
  const { nonce, authenticatedTag } = parseToken(token);
  const expectedTag = callbackTag(nonce, secret);
  if (!timingSafeEqual(authenticatedTag, expectedTag)) {
    throw new CallbackAuthStateError("Invalid callback token");
  }

  const hash = tokenHash(nonce);
  const claims = await store.peek(hash);
  if (claims === null) {
    throw new CallbackAuthStateError(
      "Callback token is unknown or already used",
    );
  }
  validateClaims(claims);

  if (
    !numericTelegramIdentity.test(expectedTelegramUserId) ||
    binding.telegramUserId !== expectedTelegramUserId
  ) {
    throw new CallbackAuthStateError("Telegram identity is not authorized");
  }
  if (!binding.active || !binding.verified) {
    throw new CallbackAuthStateError("Expert binding is not eligible");
  }
  if (claims.expertId !== binding.expertId) {
    throw new CallbackAuthStateError("Expert binding does not match callback");
  }
  if (claims.expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)) {
    throw new CallbackAuthStateError("Callback token has expired");
  }

  return { tokenHash: hash, claims };
}

const EXPERT_COMMAND_TOKEN_PREFIX = "ct3.";
const EXPERT_COMMAND_TOKEN_VERSION = 3;
const EXPERT_COMMAND_MAC_DOMAIN = Buffer.from(
  `ii-tonya:telegram-callback\u0000${EXPERT_COMMAND_TOKEN_PREFIX}`,
  "utf8",
);

export type ExpertCommandCallbackOperation =
  | "redeem_expert_referral"
  | "view_referral_summary"
  | "quote_residency"
  | "start_residency_checkout";

export interface ExpertCommandCallbackClaims {
  readonly kind: "expert_command";
  readonly expertId: string;
  readonly operation: ExpertCommandCallbackOperation;
  readonly objectId: string;
  readonly version: number;
  readonly expiresAtEpochSeconds: number;
}

export type VersionedCallbackClaims =
  | Readonly<{ kind: "reservation" } & ExpertCallbackClaims>
  | ExpertCommandCallbackClaims;

export interface ExpertCommandCallbackClaimsStore {
  put(tokenHash: string, claims: ExpertCommandCallbackClaims): Promise<void>;
  peek(tokenHash: string): Promise<ExpertCommandCallbackClaims | null>;
  consumeIfValid(input: {
    readonly tokenHash: string;
    readonly expertId: string;
    readonly operation: ExpertCommandCallbackOperation;
    readonly objectId: string;
    readonly version: number;
    readonly now: Date;
  }): Promise<ExpertCommandCallbackClaims | null>;
}

const expertCommandOperations = new Set<ExpertCommandCallbackOperation>([
  "redeem_expert_referral",
  "view_referral_summary",
  "quote_residency",
  "start_residency_checkout",
]);
const callbackObjectId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const validateExpertCommandClaims = (
  claims: ExpertCommandCallbackClaims,
): void => {
  if (
    claims.kind !== "expert_command" ||
    claims.expertId.length === 0 ||
    !expertCommandOperations.has(claims.operation) ||
    !callbackObjectId.test(claims.objectId) ||
    !Number.isSafeInteger(claims.version) ||
    claims.version <= 0 ||
    !Number.isSafeInteger(claims.expiresAtEpochSeconds) ||
    claims.expiresAtEpochSeconds <= 0
  ) {
    throw new CallbackAuthStateError("Invalid expert command callback claims");
  }
};

const expertCommandTag = (nonce: Uint8Array, secret: Uint8Array): Buffer =>
  createHmac("sha256", secret)
    .update(EXPERT_COMMAND_MAC_DOMAIN)
    .update(Buffer.from([EXPERT_COMMAND_TOKEN_VERSION]))
    .update(nonce)
    .digest()
    .subarray(0, TAG_BYTES);

const parseExpertCommandToken = (
  token: string,
): { readonly nonce: Buffer; readonly authenticatedTag: Buffer } => {
  if (!token.startsWith(EXPERT_COMMAND_TOKEN_PREFIX)) {
    throw new CallbackAuthStateError("Invalid expert command callback token");
  }
  const encoded = token.slice(EXPERT_COMMAND_TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new CallbackAuthStateError("Invalid expert command callback token");
  }
  const payload = Buffer.from(encoded, "base64url");
  if (
    payload.byteLength !== PAYLOAD_BYTES ||
    payload[0] !== EXPERT_COMMAND_TOKEN_VERSION ||
    payload.toString("base64url") !== encoded
  ) {
    throw new CallbackAuthStateError("Invalid expert command callback token");
  }
  return {
    nonce: payload.subarray(1, 1 + NONCE_BYTES),
    authenticatedTag: payload.subarray(1 + NONCE_BYTES),
  };
};

export async function issueExpertCommandCallback(
  claims: ExpertCommandCallbackClaims,
  secret: Uint8Array,
  store: ExpertCommandCallbackClaimsStore,
): Promise<string> {
  validateExpertCommandClaims(claims);
  requireStrongSecret(secret);
  const nonce = randomBytes(NONCE_BYTES);
  const payload = Buffer.concat([
    Buffer.from([EXPERT_COMMAND_TOKEN_VERSION]),
    nonce,
    expertCommandTag(nonce, secret),
  ]);
  const token = `${EXPERT_COMMAND_TOKEN_PREFIX}${payload.toString("base64url")}`;
  if (Buffer.byteLength(token, "utf8") > MAX_CALLBACK_BYTES) {
    throw new CallbackAuthStateError("Callback token exceeds Telegram limit");
  }
  await store.put(tokenHash(nonce), claims);
  return token;
}

export async function verifyExpertCommandCallback(
  token: string,
  expectedTelegramUserId: string,
  binding: ExpertBinding,
  expected: {
    readonly operation: ExpertCommandCallbackOperation;
    readonly objectId: string;
  },
  secret: Uint8Array,
  store: ExpertCommandCallbackClaimsStore,
  now: Date,
): Promise<ExpertCommandCallbackClaims> {
  try {
    requireStrongSecret(secret);
    const { nonce, authenticatedTag } = parseExpertCommandToken(token);
    const expectedTag = expertCommandTag(nonce, secret);
    if (!timingSafeEqual(authenticatedTag, expectedTag)) {
      throw new CallbackAuthStateError("Invalid expert command callback token");
    }
    const hash = tokenHash(nonce);
    const stored = await store.peek(hash);
    if (stored === null) {
      throw new CallbackAuthStateError("Unknown expert command callback token");
    }
    validateExpertCommandClaims(stored);
    if (
      !numericTelegramIdentity.test(expectedTelegramUserId) ||
      binding.telegramUserId !== expectedTelegramUserId ||
      !binding.active ||
      !binding.verified ||
      stored.expertId !== binding.expertId ||
      stored.operation !== expected.operation ||
      stored.objectId !== expected.objectId ||
      stored.expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)
    ) {
      throw new CallbackAuthStateError(
        "Expert command callback not authorized",
      );
    }
    const consumed = await store.consumeIfValid({
      tokenHash: hash,
      expertId: stored.expertId,
      operation: stored.operation,
      objectId: stored.objectId,
      version: stored.version,
      now,
    });
    if (
      consumed === null ||
      consumed.kind !== "expert_command" ||
      consumed.expertId !== stored.expertId ||
      consumed.operation !== stored.operation ||
      consumed.objectId !== stored.objectId ||
      consumed.version !== stored.version ||
      consumed.expiresAtEpochSeconds !== stored.expiresAtEpochSeconds
    ) {
      throw new CallbackAuthStateError(
        "Expert command callback not consumable",
      );
    }
    return consumed;
  } catch (error) {
    if (error instanceof CallbackInfrastructureError) throw error;
    if (!(error instanceof CallbackAuthStateError)) throw error;
    throw new CallbackVerificationError();
  }
}
