import type { ExpertTelegramQueryViewPort } from "./telegram-adapter.js";
import type { TelegramSendOutcome } from "./telegram-adapter.js";

interface QueryPrincipal {
  readonly expertId: string;
  readonly telegramUserId: string;
  readonly timezone: string;
}

interface QueryService {
  schedule(principal: QueryPrincipal): Promise<{
    readonly timezone: string;
    readonly appointments: readonly {
      readonly startsAt: string;
      readonly status: string;
      readonly clientDisplayName: string;
      readonly expertNote?: string;
      readonly meetingUrl?: string;
    }[];
  }>;
  clientChoices(principal: QueryPrincipal): Promise<
    readonly {
      readonly startsAt: string;
      readonly serviceName: string;
      readonly callbackData: string;
    }[]
  >;
  stats(principal: QueryPrincipal): Promise<{
    readonly upcoming: number;
    readonly completed: number;
    readonly cancelled: number;
    readonly noShow: number;
  }>;
  clientView(command: {
    readonly principal: QueryPrincipal;
    readonly authenticated: {
      readonly tokenHash: string;
      readonly claims: {
        readonly reservationId: string;
        readonly expertId: string;
        readonly telegramUserId: string;
        readonly version: number;
        readonly expiresAtEpochSeconds: number;
      };
    };
    readonly correlationId: string;
  }): Promise<{
    readonly clientDisplayName: string;
    readonly startsAt: Date;
    readonly serviceName: string;
    readonly preparationNote?: string;
  }>;
}

export interface ExpertCommandProcessor {
  processCommand(command: {
    readonly text: string;
    readonly chatType: string;
    readonly principal: QueryPrincipal;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<{
    readonly kind: "processed" | "unsupported" | "disabled" | "unavailable";
    readonly deliveryOutcome?: "applied" | "unknown_outcome";
  }>;
  processClientView(command: {
    readonly principal: QueryPrincipal;
    readonly authenticated: Parameters<
      QueryService["clientView"]
    >[0]["authenticated"];
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<{
    readonly kind: "processed" | "reissue_client" | "disabled" | "unavailable";
    readonly deliveryOutcome?: "applied" | "not_applied" | "unknown_outcome";
  }>;
}

const ordinaryDeliveryOutcome = (
  outcome: TelegramSendOutcome,
): "applied" | "unknown_outcome" => {
  if (outcome.kind === "not_applied") {
    throw new Error("telegram_delivery_not_applied");
  }
  return outcome.kind;
};

const unavailable = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch {
    throw new Error("expert_query_unavailable");
  }
};

export const createExpertCommandProcessor = (deps: {
  readonly enabled: boolean;
  readonly queries: QueryService;
  readonly views: ExpertTelegramQueryViewPort;
}): ExpertCommandProcessor => ({
  async processCommand(command) {
    if (!deps.enabled) return { kind: "disabled" };
    if (command.chatType !== "private") return { kind: "unavailable" };
    switch (command.text) {
      case "/schedule": {
        const schedule = await unavailable(() =>
          deps.queries.schedule(command.principal),
        );
        const appointments: {
          startsAt: string;
          status: "reserved" | "booked";
          clientDisplayName: string;
          expertNote?: string;
          meetingUrl?: string;
        }[] = schedule.appointments.map((appointment) => {
          if (
            appointment.status !== "reserved" &&
            appointment.status !== "booked"
          ) {
            throw new Error("expert_query_unavailable");
          }
          return {
            startsAt: appointment.startsAt,
            status: appointment.status,
            clientDisplayName: appointment.clientDisplayName,
            ...(appointment.expertNote === undefined
              ? {}
              : { expertNote: appointment.expertNote }),
            ...(appointment.meetingUrl === undefined
              ? {}
              : { meetingUrl: appointment.meetingUrl }),
          };
        });
        const deliveryOutcome = ordinaryDeliveryOutcome(
          await deps.views.sendQuerySchedule({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
            timezone: schedule.timezone,
            appointments,
          }),
        );
        return { kind: "processed", deliveryOutcome };
      }
      case "/client": {
        const choices = await unavailable(() =>
          deps.queries.clientChoices(command.principal),
        );
        const deliveryOutcome = ordinaryDeliveryOutcome(
          await deps.views.sendClientChoices({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
            timezone: command.principal.timezone,
            choices,
          }),
        );
        return { kind: "processed", deliveryOutcome };
      }
      case "/stats": {
        const stats = await unavailable(() =>
          deps.queries.stats(command.principal),
        );
        const deliveryOutcome = ordinaryDeliveryOutcome(
          await deps.views.sendStats({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
            ...stats,
          }),
        );
        return { kind: "processed", deliveryOutcome };
      }
      default:
        const deliveryOutcome = ordinaryDeliveryOutcome(
          await deps.views.sendUnsupported({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
          }),
        );
        return { kind: "unsupported", deliveryOutcome };
    }
  },

  async processClientView(command) {
    if (!deps.enabled) return { kind: "disabled" };
    const view = await unavailable(() =>
      deps.queries.clientView({
        principal: command.principal,
        authenticated: command.authenticated,
        correlationId: command.correlationId,
      }),
    );
    const outcome = await deps.views.sendClientView({
      idempotencyKey: command.idempotencyKey,
      telegramUserId: command.principal.telegramUserId,
      timezone: command.principal.timezone,
      clientDisplayName: view.clientDisplayName,
      startsAt: view.startsAt.toISOString(),
      serviceName: view.serviceName,
      ...(view.preparationNote === undefined
        ? {}
        : { preparationNote: view.preparationNote }),
    });
    if (outcome.kind === "not_applied") {
      return { kind: "reissue_client", deliveryOutcome: outcome.kind };
    }
    if (outcome.kind === "unknown_outcome") {
      return { kind: "unavailable", deliveryOutcome: outcome.kind };
    }
    return { kind: "processed", deliveryOutcome: outcome.kind };
  },
});
