import { describe, expect, it } from "vitest";
import {
  BOOKING_NOTIFICATION_TOPICS,
  bookingNotificationEventSchema,
  bookingHandoffRevokedEventSchema,
  bookingNotificationViewSchema,
} from "../../contracts/src/booking-notifications.js";
import { renderBookingNotification } from "./booking-notification-renderer.js";

const reservationId = "10000000-0000-4000-8000-000000000001";
const startsAt = "2026-10-15T12:30:00.000Z";
const confirm = `ct2.${"A".repeat(44)}`;
const cancel = `ct2.${"B".repeat(44)}`;
const domainEvents = [
  ["telegram.reservation_request", "reserve", "reserved"],
  ["telegram.booking_cancelled", "client_cancel", "cancelled_by_client"],
  ["client.booking_cancelled", "expert_cancel", "cancelled_by_expert"],
  ["client.reservation_expired", "expire", "expired"],
  ["expert.reservation_expired", "expire", "expired"],
  ["client.booking_completed", "complete", "completed"],
  ["client.booking_no_show", "mark_no_show", "no_show"],
] as const;
const events = [
  ...domainEvents.map(([topic, action, decision]) => ({
    topic,
    payload: { reservationId, action, decision, version: 2, charge: 0 },
  })),
  ...["client.reservation_expired", "expert.reservation_expired"].map(
    (topic) => ({
      topic,
      payload: { reservationId, version: 2, charge: 0 },
    }),
  ),
  ...["client.booking_confirmed", "client.reservation_expired"].map(
    (topic) => ({
      topic,
      payload: { reservationId, charge: 0 },
    }),
  ),
];
const ready = (topic: string, status: string, evidence = {}) => ({
  kind: "ready",
  topic,
  status,
  startsAt,
  ...evidence,
});
const views = [
  [
    ready("telegram.reservation_request", "reserved", {
      callbacks: { confirm, cancel },
    }),
    "expert",
    "Новая заявка на 2026-10-15 12:30 UTC. Клиент.",
  ],
  [
    ready("client.booking_confirmed", "booked", {
      calendar: "verified_booked",
    }),
    "client",
    "Запись подтверждена на 2026-10-15 12:30 UTC.",
  ],
  [
    ready("telegram.booking_cancelled", "cancelled_by_client", {
      calendar: "unknown",
    }),
    "expert",
    "Локальная запись отменена клиентом. Отмена в календаре ещё не подтверждена. Время: 2026-10-15 12:30 UTC.",
  ],
  [
    ready("client.booking_cancelled", "cancelled_by_expert", {
      calendar: "cancelled",
    }),
    "client",
    "Локальная запись отменена экспертом. Отмена в календаре подтверждена. Время: 2026-10-15 12:30 UTC.",
  ],
  [
    ready("client.reservation_expired", "expired", { calendar: "not_created" }),
    "client",
    "Срок локальной заявки истёк. Запись в календаре не создавалась. Время: 2026-10-15 12:30 UTC.",
  ],
  [
    ready("expert.reservation_expired", "expired", {
      calendar: "cancellation_pending",
    }),
    "expert",
    "Срок локальной заявки истёк. Прежние кнопки недоступны. Отмена в календаре ещё не подтверждена. Время: 2026-10-15 12:30 UTC.",
  ],
  [
    ready("client.booking_completed", "completed"),
    "client",
    "Встреча отмечена как завершённая. Время: 2026-10-15 12:30 UTC.",
  ],
  [
    ready("client.booking_no_show", "no_show"),
    "client",
    "Встреча отмечена как несостоявшаяся. Время: 2026-10-15 12:30 UTC.",
  ],
] as const;

describe("strict booking producer contracts", () => {
  it("classifies exactly eight lifecycle topics, not navigation or local revocation", () => {
    expect([...BOOKING_NOTIFICATION_TOPICS].sort()).toEqual(
      views.map(([v]) => v.topic).sort(),
    );
  });
  it.each(events)(
    "accepts the real $topic producer shape without manufacturing a version",
    (event) => {
      expect(bookingNotificationEventSchema.parse(event)).toEqual(event);
    },
  );
  it.each(events)(
    "rejects extra fields and missing charge for $topic",
    (event) => {
      for (const extra of [
        { text: "diagnosis" },
        { chatId: "123" },
        { meetingUrl: "https://example.test" },
        { consent: true },
      ]) {
        expect(
          bookingNotificationEventSchema.safeParse({
            ...event,
            payload: { ...event.payload, ...extra },
          }).success,
        ).toBe(false);
      }
      expect(
        bookingNotificationEventSchema.safeParse({
          ...event,
          recipient: "expert",
        }).success,
      ).toBe(false);
      expect(
        bookingNotificationEventSchema.safeParse({
          ...event,
          payload: { ...event.payload, charge: undefined },
        }).success,
      ).toBe(false);
      expect(
        bookingNotificationEventSchema.safeParse({
          ...event,
          payload: { ...event.payload, charge: 5000 },
        }).success,
      ).toBe(false);
    },
  );
  it.each(domainEvents)(
    "binds action, decision and version to %s",
    (topic, action, decision) => {
      for (const replacement of [
        { action: "expert_confirm" },
        { decision: "booked" },
        { version: 0 },
        { version: 1.5 },
        { version: Number.MAX_SAFE_INTEGER + 1 },
        { reservationId: "forged" },
      ]) {
        expect(
          bookingNotificationEventSchema.safeParse({
            topic,
            payload: {
              reservationId,
              action,
              decision,
              version: 2,
              charge: 0,
              ...replacement,
            },
          }).success,
        ).toBe(false);
      }
    },
  );
  it("rejects a versioned provider confirmation and unproduced expert rejection expiry", () => {
    expect(
      bookingNotificationEventSchema.safeParse({
        topic: "client.booking_confirmed",
        payload: { reservationId, version: 2, charge: 0 },
      }).success,
    ).toBe(false);
    expect(
      bookingNotificationEventSchema.safeParse({
        topic: "expert.reservation_expired",
        payload: { reservationId, charge: 0 },
      }).success,
    ).toBe(false);
    expect(
      bookingNotificationEventSchema.safeParse({
        topic: "booking.start",
        payload: { expertId: reservationId },
      }).success,
    ).toBe(false);
  });
  it("classifies strict handoff revocation as local control, never as a send", () => {
    const event = {
      topic: "booking.handoff_revoked",
      payload: {
        userId: reservationId,
        consentDecisionId: reservationId,
        purpose: "expert_handoff",
      },
    };
    expect(bookingHandoffRevokedEventSchema.parse(event)).toEqual(event);
    expect(bookingNotificationEventSchema.safeParse(event).success).toBe(false);
    expect(
      bookingHandoffRevokedEventSchema.safeParse({
        ...event,
        payload: { ...event.payload, chatId: "123" },
      }).success,
    ).toBe(false);
    expect(
      bookingHandoffRevokedEventSchema.safeParse({
        ...event,
        payload: { ...event.payload, purpose: "client_messaging" },
      }).success,
    ).toBe(false);
    expect(renderBookingNotification(event)).toEqual({
      kind: "suppressed",
      reason: "invalid_view",
    });
  });
});

describe("minimal truthful lifecycle renderer", () => {
  it.each(views)(
    "renders exact topic/state projection %j",
    (view, recipient, text) => {
      expect(bookingNotificationViewSchema.parse(view)).toEqual(view);
      expect(renderBookingNotification(view)).toEqual({
        kind: "rendered",
        topic: view.topic,
        recipient,
        text,
        replyMarkup:
          view.topic === "telegram.reservation_request"
            ? {
                inline_keyboard: [
                  [
                    { text: "Подтвердить", callback_data: confirm },
                    { text: "Отказать", callback_data: cancel },
                  ],
                ],
              }
            : null,
      });
    },
  );
  it.each(views)(
    "rejects PII/URL fields, wrong status and malformed time for %j",
    (view) => {
      for (const extra of [
        { clientName: "Sensitive Name" },
        { diagnosis: "Sensitive" },
        { contact: "+79990000000" },
        { meetingUrl: "https://example.test" },
        { expertNote: "Sensitive" },
        { text: "arbitrary" },
        { recipient: "client" },
        { status: "booked_forged" },
        { startsAt: "2026-02-30T12:30:00Z" },
        { startsAt: "<b>https://example.test</b>" },
      ]) {
        expect(renderBookingNotification({ ...view, ...extra })).toEqual({
          kind: "suppressed",
          reason: "invalid_view",
        });
      }
    },
  );
  it.each([
    "not_created",
    "cancelled",
    "cancellation_pending",
    "unknown",
  ] as const)(
    "distinguishes calendar evidence %s for both cancellation and expiry recipients",
    (calendar) => {
      const sentence =
        calendar === "not_created"
          ? "Запись в календаре не создавалась."
          : calendar === "cancelled"
            ? "Отмена в календаре подтверждена."
            : "Отмена в календаре ещё не подтверждена.";
      for (const [topic, status] of [
        ["telegram.booking_cancelled", "cancelled_by_client"],
        ["client.booking_cancelled", "cancelled_by_expert"],
        ["client.reservation_expired", "expired"],
        ["expert.reservation_expired", "expired"],
      ]) {
        const result = renderBookingNotification(
          ready(topic!, status!, { calendar }),
        );
        expect(result.kind).toBe("rendered");
        if (result.kind === "rendered") expect(result.text).toContain(sentence);
      }
    },
  );
  it.each([
    "state_superseded",
    "provider_unknown",
    "authority_invalid",
    "recipient_unavailable",
    "source_invalid",
  ] as const)(
    "suppresses %s across all topics with no text or buttons",
    (reason) => {
      for (const [view] of views) {
        expect(
          renderBookingNotification({
            kind: "suppressed",
            topic: view.topic,
            reason,
          }),
        ).toEqual({ kind: "suppressed", reason });
      }
    },
  );
  it("cannot turn an unknown/pending/legacy calendar fact into a confirmation", () => {
    for (const calendar of [
      "unknown",
      "cancellation_pending",
      "legacy_unverified",
      "not_created",
      "cancelled",
      undefined,
    ]) {
      expect(
        renderBookingNotification(
          ready("client.booking_confirmed", "booked", { calendar }),
        ),
      ).toEqual({ kind: "suppressed", reason: "invalid_view" });
    }
  });
  it("requires distinct bounded opaque callback tokens, not arbitrary buttons/URLs", () => {
    for (const callbacks of [
      { confirm, cancel: confirm },
      { confirm: "https://example.test", cancel },
      { confirm: `${confirm}A`, cancel },
      { confirm: "ct2.short", cancel },
      { confirm, cancel, url: "https://example.test" },
    ]) {
      expect(
        renderBookingNotification(
          ready("telegram.reservation_request", "reserved", { callbacks }),
        ),
      ).toEqual({ kind: "suppressed", reason: "invalid_view" });
    }
    expect(Buffer.byteLength(confirm)).toBeLessThanOrEqual(64);
  });
  it("never renders meeting URLs, contacts, financial or clinical claims in any template", () => {
    for (const [view] of views) {
      const output = renderBookingNotification(view);
      expect(output.kind).toBe("rendered");
      if (output.kind === "rendered") {
        expect(output.text).not.toMatch(
          /https?:|www\.|@|\+\d{7}|диагноз|оплат|штраф|возврат|руб|скидк/iu,
        );
        expect(output).not.toHaveProperty("parse_mode");
      }
    }
  });
  it("does not render source events, unknown topics or invented suppression reasons", () => {
    for (const input of [
      ...events,
      null,
      ready("booking.start", "reserved"),
      {
        kind: "suppressed",
        topic: "client.booking_confirmed",
        reason: "delivered",
      },
    ]) {
      expect(renderBookingNotification(input)).toEqual({
        kind: "suppressed",
        reason: "invalid_view",
      });
    }
  });
});
