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
  }>;
  processClientView(command: {
    readonly principal: QueryPrincipal;
    readonly authenticated: Parameters<
      QueryService["clientView"]
    >[0]["authenticated"];
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<{ readonly kind: "processed" | "disabled" | "unavailable" }>;
}

const requireApplied = (
  outcome: TelegramSendOutcome,
  clientView = false,
): void => {
  if (outcome.kind !== "applied") {
    throw new Error(
      clientView
        ? "telegram_client_view_delivery_unconfirmed"
        : "telegram_delivery_unconfirmed",
    );
  }
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
        requireApplied(
          await deps.views.sendQuerySchedule({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
            timezone: schedule.timezone,
            appointments,
          }),
        );
        return { kind: "processed" };
      }
      case "/client": {
        const choices = await unavailable(() =>
          deps.queries.clientChoices(command.principal),
        );
        requireApplied(
          await deps.views.sendClientChoices({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
            timezone: command.principal.timezone,
            choices,
          }),
        );
        return { kind: "processed" };
      }
      case "/stats": {
        const stats = await unavailable(() =>
          deps.queries.stats(command.principal),
        );
        requireApplied(
          await deps.views.sendStats({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
            ...stats,
          }),
        );
        return { kind: "processed" };
      }
      default:
        requireApplied(
          await deps.views.sendUnsupported({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
          }),
        );
        return { kind: "unsupported" };
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
    requireApplied(
      await deps.views.sendClientView({
        idempotencyKey: command.idempotencyKey,
        telegramUserId: command.principal.telegramUserId,
        timezone: command.principal.timezone,
        clientDisplayName: view.clientDisplayName,
        startsAt: view.startsAt.toISOString(),
        serviceName: view.serviceName,
        ...(view.preparationNote === undefined
          ? {}
          : { preparationNote: view.preparationNote }),
      }),
      true,
    );
    return { kind: "processed" };
  },
});
