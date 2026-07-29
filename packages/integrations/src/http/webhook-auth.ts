import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookRejectionReason =
  "missing_header" | "content_type" | "body_size" | "timestamp" | "signature";

export type WebhookVerification =
  { accepted: true } | { accepted: false; reason: WebhookRejectionReason };

export interface SignedWebhookInput {
  body: Uint8Array;
  contentType: string | undefined;
  signature: string | undefined;
  timestamp: string | undefined;
  secret: string;
  nowEpochSeconds: number;
  maxAgeSeconds: number;
  maxBodyBytes: number;
}

const integerTimestamp = /^\d+$/u;
const sha256HexSignature = /^[0-9a-f]{64}$/u;

export function verifySignedWebhook(
  input: SignedWebhookInput,
): WebhookVerification {
  if (!input.signature || !input.timestamp) {
    return { accepted: false, reason: "missing_header" };
  }
  if (input.contentType !== "application/json") {
    return { accepted: false, reason: "content_type" };
  }
  if (input.body.byteLength > input.maxBodyBytes) {
    return { accepted: false, reason: "body_size" };
  }
  if (!integerTimestamp.test(input.timestamp)) {
    return { accepted: false, reason: "timestamp" };
  }
  if (
    input.secret.trim().length === 0 ||
    !sha256HexSignature.test(input.signature)
  ) {
    return { accepted: false, reason: "signature" };
  }

  const timestamp = Number(input.timestamp);
  if (
    !Number.isSafeInteger(timestamp) ||
    !Number.isSafeInteger(input.nowEpochSeconds) ||
    !Number.isSafeInteger(input.maxAgeSeconds) ||
    input.maxAgeSeconds < 0 ||
    Math.abs(input.nowEpochSeconds - timestamp) > input.maxAgeSeconds
  ) {
    return { accepted: false, reason: "timestamp" };
  }

  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.`)
    .update(input.body)
    .digest("hex");
  const actualBytes = Buffer.from(input.signature, "utf8");
  const matches = timingSafeEqual(Buffer.from(expected, "utf8"), actualBytes);

  return matches
    ? { accepted: true }
    : { accepted: false, reason: "signature" };
}

export type SignedWebhookRequest = Pick<
  SignedWebhookInput,
  "body" | "contentType" | "signature" | "timestamp"
>;

export interface SignedWebhookVerifierConfig {
  secret: string;
  nowEpochSeconds(): number;
  maxAgeSeconds: number;
  maxBodyBytes: number;
}

export function createSignedWebhookVerifier(
  config: SignedWebhookVerifierConfig,
): (request: SignedWebhookRequest) => WebhookVerification {
  if (config.secret.trim().length === 0) {
    throw new Error("invalid_webhook_secret_configuration");
  }

  return (request) =>
    verifySignedWebhook({
      ...request,
      secret: config.secret,
      nowEpochSeconds: config.nowEpochSeconds(),
      maxAgeSeconds: config.maxAgeSeconds,
      maxBodyBytes: config.maxBodyBytes,
    });
}
