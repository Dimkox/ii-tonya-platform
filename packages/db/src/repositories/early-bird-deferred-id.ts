import { createHmac } from "node:crypto";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Stable per-choice IDs; key rotation requires retaining the original key for recovery. */
export function deferredId(
  key: Buffer,
  kind: string,
  userId: string,
  choiceId: string,
): string {
  if (
    !Buffer.isBuffer(key) ||
    key.length !== 32 ||
    !/^[a-z-]{1,32}$/u.test(kind) ||
    !uuid.test(userId) ||
    !uuid.test(choiceId)
  )
    throw new Error("early_bird_deferred_identity_invalid");
  const bytes = createHmac("sha256", key)
    .update(
      JSON.stringify([
        "ii-tonya:early-bird-deferred:v1",
        kind,
        userId,
        choiceId,
      ]),
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
