import { z } from "zod";

export const BOOKING_NOTIFICATION_TOPICS = Object.freeze([
  "telegram.reservation_request",
  "client.booking_confirmed",
  "telegram.booking_cancelled",
  "client.booking_cancelled",
  "client.reservation_expired",
  "expert.reservation_expired",
  "client.booking_completed",
  "client.booking_no_show",
] as const);
export type BookingNotificationTopic =
  (typeof BOOKING_NOTIFICATION_TOPICS)[number];

const reference = { reservationId: z.uuid(), charge: z.literal(0) };
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const providerPayload = z.strictObject(reference);
const expiryPayload = z.strictObject({ ...reference, version });
const transitionPayload = <A extends string, S extends string>(
  action: A,
  decision: S,
) =>
  z.strictObject({
    ...reference,
    action: z.literal(action),
    decision: z.literal(decision),
    version,
  });
const event = <T extends BookingNotificationTopic, P extends z.ZodType>(
  topic: T,
  payload: P,
) => z.strictObject({ topic: z.literal(topic), payload });
const expiredTransition = transitionPayload("expire", "expired");

/** Exact producer JSON only. This validates shape, NOT source/recipient authority.
 * Provider variants have no version: the future resolver must bind the operation
 * from the durable source idempotency key, never manufacture a reservation version.
 */
export const bookingNotificationEventSchema = z.discriminatedUnion("topic", [
  event(
    "telegram.reservation_request",
    transitionPayload("reserve", "reserved"),
  ),
  event("client.booking_confirmed", providerPayload),
  event(
    "telegram.booking_cancelled",
    transitionPayload("client_cancel", "cancelled_by_client"),
  ),
  event(
    "client.booking_cancelled",
    transitionPayload("expert_cancel", "cancelled_by_expert"),
  ),
  event(
    "client.reservation_expired",
    z.union([expiredTransition, expiryPayload, providerPayload]),
  ),
  event(
    "expert.reservation_expired",
    z.union([expiredTransition, expiryPayload]),
  ),
  event("client.booking_completed", transitionPayload("complete", "completed")),
  event("client.booking_no_show", transitionPayload("mark_no_show", "no_show")),
]);
export type BookingNotificationEvent = z.infer<
  typeof bookingNotificationEventSchema
>;

/** Local invalidation, never a lifecycle send or an inferred fan-out recipient. */
export const bookingHandoffRevokedEventSchema = z.strictObject({
  topic: z.literal("booking.handoff_revoked"),
  payload: z.strictObject({
    userId: z.uuid(),
    consentDecisionId: z.uuid(),
    purpose: z.literal("expert_handoff"),
  }),
});
export type BookingHandoffRevokedEvent = z.infer<
  typeof bookingHandoffRevokedEventSchema
>;

const readyFields = { kind: z.literal("ready"), startsAt: z.iso.datetime() };
const calendarCancellationSchema = z.enum([
  "not_created",
  "cancelled",
  "cancellation_pending",
  "unknown",
]);
export type BookingCalendarCancellation = z.infer<
  typeof calendarCancellationSchema
>;
// Shape/size only: issuance/authentication remains in the existing callback service.
const callbackToken = z.string().regex(/^ct2\.[A-Za-z0-9_-]{44}$/u);
const callbacks = z
  .strictObject({ confirm: callbackToken, cancel: callbackToken })
  .refine((value) => value.confirm !== value.cancel);

/** Server-authored projection AFTER DB authority/state validation. Not a send grant.
 * No PII, source payload, IDs, arbitrary text or URLs belong at this boundary.
 * Literal topic/status/evidence pairs exclude contradictory renderable states.
 */
const readyView = z.discriminatedUnion("topic", [
  z.strictObject({
    ...readyFields,
    topic: z.literal("telegram.reservation_request"),
    status: z.literal("reserved"),
    callbacks,
  }),
  z.strictObject({
    ...readyFields,
    topic: z.literal("client.booking_confirmed"),
    status: z.literal("booked"),
    calendar: z.literal("verified_booked"),
  }),
  z.strictObject({
    ...readyFields,
    topic: z.literal("telegram.booking_cancelled"),
    status: z.literal("cancelled_by_client"),
    calendar: calendarCancellationSchema,
  }),
  z.strictObject({
    ...readyFields,
    topic: z.literal("client.booking_cancelled"),
    status: z.literal("cancelled_by_expert"),
    calendar: calendarCancellationSchema,
  }),
  z.strictObject({
    ...readyFields,
    topic: z.literal("client.reservation_expired"),
    status: z.literal("expired"),
    calendar: calendarCancellationSchema,
  }),
  z.strictObject({
    ...readyFields,
    topic: z.literal("expert.reservation_expired"),
    status: z.literal("expired"),
    calendar: calendarCancellationSchema,
  }),
  z.strictObject({
    ...readyFields,
    topic: z.literal("client.booking_completed"),
    status: z.literal("completed"),
  }),
  z.strictObject({
    ...readyFields,
    topic: z.literal("client.booking_no_show"),
    status: z.literal("no_show"),
  }),
]);
export const bookingNotificationSuppressionReasonSchema = z.enum([
  "state_superseded",
  "provider_unknown",
  "authority_invalid",
  "recipient_unavailable",
  "source_invalid",
]);
export type BookingNotificationSuppressionReason = z.infer<
  typeof bookingNotificationSuppressionReasonSchema
>;
export const bookingNotificationViewSchema = z.union([
  readyView,
  z.strictObject({
    kind: z.literal("suppressed"),
    topic: z.enum(BOOKING_NOTIFICATION_TOPICS),
    reason: bookingNotificationSuppressionReasonSchema,
  }),
]);
export type BookingNotificationView = z.infer<
  typeof bookingNotificationViewSchema
>;

export type BookingNotificationRenderResult =
  | Readonly<{
      kind: "suppressed";
      reason: BookingNotificationSuppressionReason | "invalid_view";
    }>
  | Readonly<{
      kind: "rendered";
      topic: BookingNotificationTopic;
      recipient: "client" | "expert";
      text: string;
      replyMarkup: null | Readonly<{
        inline_keyboard: readonly [
          readonly [
            Readonly<{ text: "Подтвердить"; callback_data: string }>,
            Readonly<{ text: "Отказать"; callback_data: string }>,
          ],
        ];
      }>;
    }>;
