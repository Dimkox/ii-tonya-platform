import { z } from "zod";

const uuid = z.uuid();
const amount = z.string().regex(/^[1-9][0-9]{0,11}$/u);
const instant = z.iso.datetime({ offset: true });
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const publicExpertPaymentKindSchema = z.enum([
  "onboarding_create",
  "onboarding_capture",
  "onboarding_cancel",
  "main_create",
  "main_refund",
]);
export type PublicExpertPaymentKind = z.infer<
  typeof publicExpertPaymentKindSchema
>;
const envelope = z.strictObject({
  ciphertext: z.string().min(1).max(262144),
  keyReference: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$/u),
});
/** UUIDs identify delivery only. No amount, mode, provider parent or URL is caller authority. */
export const publicExpertPrepareDescriptorSchema = z
  .strictObject({
    requestId: uuid,
    idempotencyKey: uuid,
    kind: publicExpertPaymentKindSchema,
    requestDigest: digest,
    bodyVersion: z.literal(1),
    ciphertext: envelope.shape.ciphertext.nullable(),
    keyReference: envelope.shape.keyReference.nullable(),
    bodyExpiresAt: instant.nullable(),
  })
  .superRefine((v, ctx) => {
    const contactFree =
      v.kind === "onboarding_capture" || v.kind === "onboarding_cancel";
    if (
      contactFree
        ? v.ciphertext !== null ||
          v.keyReference !== null ||
          v.bodyExpiresAt !== null
        : v.ciphertext === null ||
          v.keyReference === null ||
          v.bodyExpiresAt === null
    )
      ctx.addIssue({
        code: "custom",
        message: "public_envelope_kind_mismatch",
      });
  });
export type PublicExpertPrepareDescriptor = z.infer<
  typeof publicExpertPrepareDescriptorSchema
>;
const immutableSnapshot = z.strictObject({
  version: z.literal(1),
  requestId: uuid,
  userId: uuid,
  product: z.enum(["onboarding", "main", "refund"]),
  kind: publicExpertPaymentKindSchema,
  legacySourceId: uuid,
  legacyOperationId: uuid,
  mode: z.enum(["test", "live"]),
  amountMinor: amount,
  currency: z.literal("RUB"),
  idempotencyKey: uuid,
  contactId: uuid.nullable(),
  parentPaymentId: providerId.nullable(),
  requestDigest: digest,
  bodyVersion: z.literal(1),
  bodyExpiresAt: instant.nullable(),
  paymentDeadline: instant,
  providerDeadline: instant,
  createdAt: instant,
});
function checkSnapshot(
  v: z.infer<typeof immutableSnapshot>,
  ctx: z.RefinementCtx,
) {
  const contactFree =
    v.kind === "onboarding_capture" || v.kind === "onboarding_cancel";
  const parent = contactFree || v.kind === "main_refund";
  if (
    (v.product === "onboarding"
      ? !v.kind.startsWith("onboarding_") || v.amountMinor !== "300000"
      : v.product === "main"
        ? v.kind !== "main_create"
        : v.kind !== "main_refund") ||
    contactFree !== (v.contactId === null) ||
    contactFree !== (v.bodyExpiresAt === null) ||
    parent !== (v.parentPaymentId !== null) ||
    Date.parse(v.paymentDeadline) > Date.parse(v.providerDeadline)
  )
    ctx.addIssue({
      code: "custom",
      message: "public_snapshot_binding_mismatch",
    });
}
export const publicExpertPaymentSnapshotSchema = immutableSnapshot
  .extend({
    state: z.enum([
      "prepared",
      "admitted",
      "uncertain",
      "bound",
      "resolved",
      "abandoned",
    ]),
    providerObjectId: providerId.nullable(),
    envelope: envelope.nullable(),
  })
  .superRefine((v, ctx) => {
    checkSnapshot(v, ctx);
    if (
      (v.contactId === null && v.envelope !== null) ||
      ((v.state === "bound" || v.state === "resolved") &&
        v.providerObjectId === null) ||
      (v.product === "onboarding" &&
        v.parentPaymentId !== null &&
        v.providerObjectId !== v.parentPaymentId)
    )
      ctx.addIssue({
        code: "custom",
        message: "public_snapshot_state_mismatch",
      });
  });
export type PublicExpertPaymentSnapshot = z.infer<
  typeof publicExpertPaymentSnapshotSchema
>;
/** Validated transport facts are not a fresh-GET brand; only the isolated writer admits them. */
export const publicExpertVerifiedObservationSchema = z
  .strictObject({
    version: z.literal(1),
    requestId: uuid,
    providerObjectId: providerId,
    parentPaymentId: providerId.nullable(),
    status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
    paid: z.boolean().nullable(),
    amountMinor: amount,
    currency: z.literal("RUB"),
    mode: z.enum(["test", "live"]),
    providerCreatedAt: instant,
    providerCapturedAt: instant.nullable(),
    paymentMethodType: z.string().min(1).max(64).nullable(),
    identity: z.strictObject({
      purpose: z.enum(["onboarding", "main_residency", "public_main_refund"]),
      operationId: uuid,
      orderId: uuid,
      userId: uuid,
    }),
    evidenceDigest: digest,
    observedAt: instant,
  })
  .superRefine((v, ctx) => {
    const refund = v.identity.purpose === "public_main_refund";
    const created = Date.parse(v.providerCreatedAt),
      observed = Date.parse(v.observedAt),
      captured =
        v.providerCapturedAt === null ? null : Date.parse(v.providerCapturedAt);
    if (
      created > observed ||
      (captured !== null && (captured < created || captured > observed))
    )
      ctx.addIssue({
        code: "custom",
        message: "public_observation_time_mismatch",
      });
    if (
      refund
        ? v.paid !== null ||
          captured !== null ||
          v.paymentMethodType !== null ||
          v.parentPaymentId === null ||
          v.status === "waiting_for_capture"
        : v.paid !==
            (v.status === "succeeded" || v.status === "waiting_for_capture") ||
          (v.status === "succeeded") !== (captured !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "public_observation_status_mismatch",
      });
    if (
      v.identity.purpose === "onboarding" &&
      (v.amountMinor !== "300000" ||
        (["waiting_for_capture", "succeeded"].includes(v.status) &&
          v.paymentMethodType !== "bank_card"))
    )
      ctx.addIssue({
        code: "custom",
        message: "public_onboarding_method_mismatch",
      });
    if (
      v.identity.purpose === "main_residency" &&
      (v.status === "waiting_for_capture" || v.parentPaymentId !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "public_main_identity_mismatch",
      });
  });
export type PublicExpertVerifiedObservation = z.infer<
  typeof publicExpertVerifiedObservationSchema
>;
export const publicExpertBindingProofSchema = z.strictObject({
  version: z.literal(1),
  complete: z.literal(true),
  exactCandidates: z.literal(1),
  observation: publicExpertVerifiedObservationSchema,
});
export const publicExpertApplyActionSchema = z
  .strictObject({
    version: z.literal(1),
    kind: z.enum([
      "ready_to_apply",
      "already_applied",
      "manual_reconciliation",
      "not_ready",
    ]),
    requestId: uuid,
    observationId: uuid.nullable(),
    legacySourceId: uuid,
    legacyOperationId: uuid,
    providerObjectId: providerId.nullable(),
    action: z
      .enum([
        "onboarding_settle",
        "main_settle",
        "main_refund",
        "release_terminal_unpaid",
      ])
      .nullable(),
    applyAttemptId: uuid.nullable(),
    evidence: z
      .strictObject({
        snapshot: immutableSnapshot.superRefine(checkSnapshot),
        observation: publicExpertVerifiedObservationSchema,
        legacyEventId: z
          .string()
          .regex(/^public:[0-9a-f-]{36}:[0-9a-f-]{36}$/u),
      })
      .nullable(),
  })
  .superRefine((v, ctx) => {
    if (
      (v.kind === "ready_to_apply" || v.kind === "already_applied") &&
      (!v.action ||
        !v.applyAttemptId ||
        !v.evidence ||
        !v.observationId ||
        !v.providerObjectId)
    )
      ctx.addIssue({
        code: "custom",
        message: "public_apply_evidence_required",
      });
    if (
      v.evidence &&
      (v.evidence.snapshot.requestId !== v.requestId ||
        v.evidence.observation.requestId !== v.requestId ||
        v.evidence.snapshot.legacySourceId !== v.legacySourceId ||
        v.evidence.snapshot.legacyOperationId !== v.legacyOperationId ||
        v.evidence.observation.providerObjectId !== v.providerObjectId ||
        v.evidence.legacyEventId !== `public:${v.requestId}:${v.observationId}`)
    )
      ctx.addIssue({
        code: "custom",
        message: "public_apply_identity_mismatch",
      });
  });
export type PublicExpertApplyAction = z.infer<
  typeof publicExpertApplyActionSchema
>;
