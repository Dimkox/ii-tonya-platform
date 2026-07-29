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
  const fixedActual = Buffer.alloc(expected.length);
  actualBytes.copy(fixedActual, 0, 0, expected.length);
  const matches = timingSafeEqual(Buffer.from(expected, "utf8"), fixedActual);

  return actualBytes.length === expected.length && matches
    ? { accepted: true }
    : { accepted: false, reason: "signature" };
}
