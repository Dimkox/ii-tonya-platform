import { createHmac } from "node:crypto";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Stable per-choice operation IDs; secret rotation requires explicit persisted-key versioning. */
export function deriveEarlyBirdOwnerOperationIds(
  key: Buffer,
  input: { userId: string; choiceId: string; generation?: number },
): { operationId: string; invoiceId: string; idempotencyKey: string } {
  if (
    !Buffer.isBuffer(key) ||
    key.length !== 32 ||
    !uuid.test(input.userId) ||
    !uuid.test(input.choiceId) ||
    (input.generation !== undefined &&
      (!Number.isSafeInteger(input.generation) || input.generation < 0))
  )
    throw new Error("early_bird_identity_invalid");
  const derive = (kind: string) => {
    const bytes = createHmac("sha256", key)
      .update(
        JSON.stringify([
          "ii-tonya:early-bird-owner-id:v1",
          kind,
          input.userId,
          input.choiceId,
          ...(input.generation ? [input.generation] : []),
        ]),
      )
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  return {
    operationId: derive("operation"),
    invoiceId: derive("invoice"),
    idempotencyKey: derive("idempotency"),
  };
}
