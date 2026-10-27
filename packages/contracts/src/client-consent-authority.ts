import { createHash } from "node:crypto";
import { z } from "zod";

const uuid = z.uuid().refine((value) => value === value.toLowerCase());
const decision = z.strictObject({
  decisionId: uuid,
  revision: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/u)
    .refine(
      (value) =>
        /^[1-9][0-9]{0,18}$/u.test(value) &&
        BigInt(value) <= 9223372036854775807n,
    ),
});

/** Server-authored, never inferred from a client's payload or a later grant. */
export const clientConsentAuthoritySchema = z.strictObject({
  v: z.literal(1),
  subjectId: uuid,
  purposes: z.strictObject({
    client_messaging: decision,
    selarti_ai_processing: decision.optional(),
  }),
});
export type ClientConsentAuthority = z.infer<
  typeof clientConsentAuthoritySchema
>;
export type ClientConsentPurpose = keyof ClientConsentAuthority["purposes"];
export const CLIENT_ASYNC_OUTBOX_TOPICS = Object.freeze([
  "telegram.send_text.v1",
  "selarti.request.v1",
] as const);
export type ClientAsyncTopic = (typeof CLIENT_ASYNC_OUTBOX_TOPICS)[number];
export const isClientAsyncTopic = (topic: string): topic is ClientAsyncTopic =>
  topic === "telegram.send_text.v1" || topic === "selarti.request.v1";

/** Stable across JSONB's key ordering; binds the exact content only internally. */
export function clientDispatchPayloadDigest(payload: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(payload)))
    .digest("hex");
}
export type ClientDispatchAdmission = Readonly<{
  kind: "admitted";
  outboxId: string;
  topic: ClientAsyncTopic;
  owner: string;
  claimToken: string;
  attempt: number;
  attemptId: string;
  reconciliationKey: string;
  payloadDigest: string;
}>;
export type DispatchStartResult =
  | ClientDispatchAdmission
  | Readonly<{ kind: "deferred"; reasonCode: "client_authority_busy" }>
  | Readonly<{
      kind: "blocked";
      reasonCode: "client_authority_invalid" | "attempt_already_started";
    }>;
export interface ClientDispatchMessage {
  id: string;
  topic: string;
  payload: unknown;
  attempt: number;
  reconciliationKey: string;
  dispatchClaimToken: string | null;
}
export function matchesClientDispatchAdmission(
  message: ClientDispatchMessage,
  admission: ClientDispatchAdmission | undefined,
): boolean {
  return (
    admission?.kind === "admitted" &&
    admission.outboxId === message.id &&
    admission.topic === message.topic &&
    admission.claimToken === message.dispatchClaimToken &&
    admission.attempt === message.attempt &&
    admission.reconciliationKey === message.reconciliationKey &&
    admission.payloadDigest === clientDispatchPayloadDigest(message.payload)
  );
}
export interface ClientDispatchAdmissionGate {
  consume(
    message: ClientDispatchMessage,
    admission: ClientDispatchAdmission,
  ): Promise<boolean>;
}
