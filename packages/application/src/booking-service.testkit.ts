import type { ReservationStatus } from "@ii-tonya/domain";

import type {
  BookingDependencies,
  BookingResult,
  ReserveCommand,
} from "./booking-service.js";

export interface BookingFixture extends BookingDependencies {
  readonly reserveCommand: ReserveCommand;
  readonly reservationId: string;
  readonly expertId: string;
  readonly telegramUserId: string;
  readonly callbackTokenHash: string;
  readonly outbox: {
    topics(): readonly string[];
    allFree(): boolean;
  };
  readonly audit: {
    actions(): readonly string[];
  };
}

export const bookingFixture = (
  initial?: { readonly status: ReservationStatus; readonly version: number },
): BookingFixture => {
  const reservationId = "00000000-0000-4000-8000-000000000101";
  const expertId = "00000000-0000-4000-8000-000000000102";
  const userId = "00000000-0000-4000-8000-000000000103";
  const telegramUserId = "123456789";
  const callbackTokenHash = "a".repeat(64);
  const topics: string[] = [];
  const charges: number[] = [];
  const actions: string[] = [];
  let reservation:
    | { status: ReservationStatus; version: number }
    | undefined = initial === undefined ? undefined : { ...initial };

  const publish = (topic: string): void => {
    topics.push(topic);
    charges.push(0);
  };

  const fixture: BookingFixture = {
    reservationId,
    expertId,
    telegramUserId,
    callbackTokenHash,
    reserveCommand: {
      idempotencyKey: "reserve-1",
      userId,
      slotId: "00000000-0000-4000-8000-000000000104",
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "reserve-correlation-1",
    },
    clock: {
      now: () => new Date("2026-07-28T10:01:00.000Z"),
    },
    repository: {
      async searchSlots() {
        return [];
      },
      async reserveAndPublish() {
        if (reservation !== undefined) {
          return {
            kind: "duplicate" as const,
            reservationId,
            reservedUntil: new Date("2026-07-30T09:30:00.000Z"),
            version: reservation.version,
          };
        }
        reservation = { status: "reserved", version: 1 };
        publish("planerka.reserve");
        publish("telegram.reservation_request");
        actions.push("reservation.created");
        return {
          kind: "reserved" as const,
          reservationId,
          reservedUntil: new Date("2026-07-30T09:30:00.000Z"),
          version: 1,
        };
      },
      async transitionAndPublish(command): Promise<BookingResult> {
        if (reservation === undefined) {
          throw new Error("Reservation not found");
        }
        if (command.expectedVersion !== reservation.version) {
          throw new Error("Stale reservation version");
        }
        if (
          command.actor.type === "expert" &&
          command.actor.id !== expertId
        ) {
          throw new Error("Reservation expert ownership mismatch");
        }
        if (command.actor.type === "client" && command.actor.id !== userId) {
          throw new Error("Reservation client ownership mismatch");
        }
        const nextStatus: ReservationStatus =
          command.action === "expert_confirm"
            ? "booked"
            : command.action === "expert_cancel"
              ? "cancelled_by_expert"
              : command.action === "client_cancel"
                ? "cancelled_by_client"
                : "expired";
        reservation = {
          status: nextStatus,
          version: reservation.version + 1,
        };
        if (command.action === "expert_confirm") {
          publish("planerka.confirm");
          publish("client.booking_confirmed");
        }
        if (command.action === "expire") {
          publish("planerka.cancel");
          publish("client.reservation_expired");
          publish("expert.reservation_expired");
        }
        return { reservationId, ...reservation };
      },
      async transitionFromTelegramCallback(command): Promise<BookingResult | null> {
        if (
          command.tokenHash !== callbackTokenHash ||
          command.reservationId !== reservationId
        ) return null;
        return this.transitionAndPublish({
          reservationId,
          expectedVersion: command.version,
          action:
            command.action === "confirm"
              ? "expert_confirm"
              : "expert_cancel",
          actor: { type: "expert", id: command.expertId },
          now: command.now,
          correlationId: command.correlationId,
        });
      },
      async listAuthorizedExpertSchedule(command) {
        if (
          command.telegramUserId !== telegramUserId ||
          command.expertId !== expertId
        ) return null;
        return [
          {
            reservationId,
            expertId,
            status: "reserved" as const,
            startsAt: new Date("2026-07-30T10:00:00.000Z"),
            clientDisplayName: "Клиент",
            expertNote: "Не показывать без согласия",
            expertNoteConsent: false,
            meetingUrl: "https://meeting.invalid/private",
            rawConversation: "never expose",
            unconsentedProfile: "never expose",
          },
        ];
      },
    },
    outbox: {
      topics: () => [...topics],
      allFree: () => charges.every((charge) => charge === 0),
    },
    audit: {
      actions: () => [...actions],
    },
  };
  return fixture;
};
