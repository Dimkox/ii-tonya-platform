import {
  buildExpertView,
  type ExpertView,
  type ReservationStatus,
} from "@ii-tonya/domain";

export interface SearchSlotsCommand {
  readonly serviceCode?: string;
  readonly language?: string;
  readonly from: Date;
  readonly to: Date;
  readonly now: Date;
}

export interface SlotView {
  readonly slotId: string;
  readonly expertId: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface ReserveCommand {
  readonly idempotencyKey: string;
  readonly userId: string;
  readonly slotId: string;
  readonly now: Date;
  readonly correlationId: string;
}

export type ReserveResult =
  | {
      readonly kind: "reserved" | "duplicate";
      readonly reservationId: string;
      readonly reservedUntil: Date;
      readonly version: number;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
    };

export interface ExpertDecisionCommand {
  readonly reservationId: string;
  readonly expertId: string;
  readonly callbackTokenHash: string;
  readonly expectedVersion: number;
  readonly correlationId: string;
}

export interface ClientCancelCommand {
  readonly reservationId: string;
  readonly userId: string;
  readonly expectedVersion: number;
  readonly correlationId: string;
}

export interface ExpireReservationCommand {
  readonly reservationId: string;
  readonly expectedVersion: number;
  readonly systemActorId: string;
  readonly correlationId: string;
}

export interface BookingResult {
  readonly reservationId: string;
  readonly status: ReservationStatus;
  readonly version: number;
}

export interface ExpertScheduleCommand {
  readonly expertId: string;
  readonly telegramUserId: string;
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
}

export interface ExpertScheduleRecord {
  readonly reservationId: string;
  readonly expertId: string;
  readonly status: ReservationStatus;
  readonly startsAt: Date;
  readonly clientDisplayName: string;
  readonly expertNote?: string;
  readonly expertNoteConsent: boolean;
  readonly meetingUrl?: string;
}

export interface ExpertScheduleAppointment extends ExpertView {
  readonly status: ReservationStatus;
  readonly meetingUrl?: string;
}

export interface ExpertScheduleView {
  readonly expertId: string;
  readonly timezone: string;
  readonly appointments: readonly ExpertScheduleAppointment[];
}

export interface BookingWorkflowRepository {
  searchSlots(command: SearchSlotsCommand & {
    readonly minimumLeadMs: number;
  }): Promise<readonly SlotView[]>;
  reserveAndPublish(command: ReserveCommand & {
    readonly minimumLeadMs: number;
    readonly confirmationBufferMs: number;
  }): Promise<ReserveResult>;
  transitionAndPublish(command: {
    readonly reservationId: string;
    readonly expectedVersion: number;
    readonly action:
      | "expert_confirm"
      | "expert_cancel"
      | "client_cancel"
      | "expire";
    readonly actor: {
      readonly type: "expert" | "client" | "system";
      readonly id: string;
    };
    readonly now: Date;
    readonly correlationId: string;
  }): Promise<BookingResult>;
  transitionFromTelegramCallback(command: {
    readonly tokenHash: string;
    readonly reservationId: string;
    readonly expertId: string;
    readonly action: "confirm" | "cancel";
    readonly version: number;
    readonly now: Date;
    readonly correlationId: string;
  }): Promise<BookingResult | null>;
  listAuthorizedExpertSchedule(command: {
    readonly expertId: string;
    readonly telegramUserId: string;
    readonly from: Date;
    readonly to: Date;
  }): Promise<readonly ExpertScheduleRecord[] | null>;
}

export interface BookingDependencies {
  readonly repository: BookingWorkflowRepository;
  readonly clock: { now(): Date };
}

export interface BookingService {
  searchSlots(command: SearchSlotsCommand): Promise<readonly SlotView[]>;
  reserve(command: ReserveCommand): Promise<ReserveResult>;
  confirmByExpert(command: ExpertDecisionCommand): Promise<BookingResult>;
  cancelByExpert(command: ExpertDecisionCommand): Promise<BookingResult>;
  cancelByClient(command: ClientCancelCommand): Promise<BookingResult>;
  expire(command: ExpireReservationCommand): Promise<BookingResult>;
  getExpertSchedule(
    command: ExpertScheduleCommand,
  ): Promise<ExpertScheduleView>;
}

const MINIMUM_LEAD_MS = 24 * 60 * 60 * 1_000;
const CONFIRMATION_BUFFER_MS = 30 * 60 * 1_000;

const parseInstant = (value: string, field: string): Date => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed;
};

const validTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
};

export const createBookingService = (
  deps: BookingDependencies,
): BookingService => {
  const clientTransition = (
    command: ClientCancelCommand,
  ): Promise<BookingResult> =>
    deps.repository.transitionAndPublish({
      reservationId: command.reservationId,
      expectedVersion: command.expectedVersion,
      action: "client_cancel",
      actor: { type: "client", id: command.userId },
      now: deps.clock.now(),
      correlationId: command.correlationId,
    });

  const expertTransition = async (
    command: ExpertDecisionCommand,
    action: "confirm" | "cancel",
  ): Promise<BookingResult> => {
    if (!/^[a-f0-9]{64}$/.test(command.callbackTokenHash)) {
      throw new Error("Invalid callback token hash");
    }
    const result = await deps.repository.transitionFromTelegramCallback({
      tokenHash: command.callbackTokenHash,
      reservationId: command.reservationId,
      expertId: command.expertId,
      action,
      version: command.expectedVersion,
      now: deps.clock.now(),
      correlationId: command.correlationId,
    });
    if (result === null || result.reservationId !== command.reservationId) {
      throw new Error("Invalid, stale, or consumed expert callback");
    }
    return result;
  };

  return {
    searchSlots: (command) =>
      deps.repository.searchSlots({
        ...command,
        now: deps.clock.now(),
        minimumLeadMs: MINIMUM_LEAD_MS,
      }),
    reserve: (command) =>
      deps.repository.reserveAndPublish({
        ...command,
        now: deps.clock.now(),
        minimumLeadMs: MINIMUM_LEAD_MS,
        confirmationBufferMs: CONFIRMATION_BUFFER_MS,
      }),
    confirmByExpert: (command) => expertTransition(command, "confirm"),
    cancelByExpert: (command) => expertTransition(command, "cancel"),
    cancelByClient: clientTransition,
    expire: (command) =>
      deps.repository.transitionAndPublish({
        reservationId: command.reservationId,
        expectedVersion: command.expectedVersion,
        action: "expire",
        actor: { type: "system", id: command.systemActorId },
        now: deps.clock.now(),
        correlationId: command.correlationId,
      }),
    async getExpertSchedule(command) {
      if (!/^[1-9]\d{0,19}$/.test(command.telegramUserId)) {
        throw new Error("Invalid Telegram identity");
      }
      if (!validTimezone(command.timezone)) {
        throw new Error("Invalid expert timezone");
      }
      const from = parseInstant(command.from, "schedule start");
      const to = parseInstant(command.to, "schedule end");
      if (from.getTime() >= to.getTime()) {
        throw new Error("Invalid expert schedule range");
      }
      const records = await deps.repository.listAuthorizedExpertSchedule({
        expertId: command.expertId,
        telegramUserId: command.telegramUserId,
        from,
        to,
      });
      if (records === null) {
        throw new Error("Expert schedule access denied");
      }
      const appointments = records.map((record) => {
        if (record.expertId !== command.expertId) {
          throw new Error("Expert schedule ownership mismatch");
        }
        const view = buildExpertView({
          reservationId: record.reservationId,
          startsAt: record.startsAt.toISOString(),
          displayTimezone: command.timezone,
          clientDisplayName: record.clientDisplayName,
          ...(record.expertNote === undefined
            ? {}
            : { expertNote: record.expertNote }),
          expertNoteConsent: record.expertNoteConsent,
        });
        return {
          ...view,
          status: record.status,
          ...(record.status === "booked" &&
          record.meetingUrl !== undefined
            ? { meetingUrl: record.meetingUrl }
            : {}),
        };
      });
      return {
        expertId: command.expertId,
        timezone: command.timezone,
        appointments,
      };
    },
  };
};
