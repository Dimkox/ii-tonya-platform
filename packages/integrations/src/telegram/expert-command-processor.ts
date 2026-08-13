import type { ExpertTelegramQueryViewPort } from "./telegram-adapter.js";

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

export const createExpertCommandProcessor = (deps: {
  readonly enabled: boolean;
  readonly queries: QueryService;
  readonly views: ExpertTelegramQueryViewPort;
}): ExpertCommandProcessor => ({
  async processCommand(command) {
    if (!deps.enabled) return { kind: "disabled" };
    if (command.chatType !== "private") return { kind: "unavailable" };
    try {
      switch (command.text) {
        case "/schedule": {
          const schedule = await deps.queries.schedule(command.principal);
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
          await deps.views.sendQuerySchedule({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
            timezone: schedule.timezone,
            appointments,
          });
          return { kind: "processed" };
        }
        case "/client": {
          const choices = await deps.queries.clientChoices(command.principal);
          await deps.views.sendClientChoices({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
            choices,
          });
          return { kind: "processed" };
        }
        case "/stats": {
          const stats = await deps.queries.stats(command.principal);
          await deps.views.sendStats({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
            ...stats,
          });
          return { kind: "processed" };
        }
        default:
          await deps.views.sendUnsupported({
            idempotencyKey: command.idempotencyKey,
            telegramUserId: command.principal.telegramUserId,
          });
          return { kind: "unsupported" };
      }
    } catch {
      await deps.views.sendUnsupported({
        idempotencyKey: command.idempotencyKey,
        telegramUserId: command.principal.telegramUserId,
      });
      return { kind: "unavailable" };
    }
  },

  async processClientView(command) {
    if (!deps.enabled) return { kind: "disabled" };
    try {
      const view = await deps.queries.clientView({
        principal: command.principal,
        authenticated: command.authenticated,
        correlationId: command.correlationId,
      });
      await deps.views.sendClientView({
        idempotencyKey: command.idempotencyKey,
        telegramUserId: command.principal.telegramUserId,
        clientDisplayName: view.clientDisplayName,
        startsAt: view.startsAt.toISOString(),
        serviceName: view.serviceName,
        ...(view.preparationNote === undefined
          ? {}
          : { preparationNote: view.preparationNote }),
      });
      return { kind: "processed" };
    } catch {
      await deps.views.sendUnsupported({
        idempotencyKey: command.idempotencyKey,
        telegramUserId: command.principal.telegramUserId,
      });
      return { kind: "unavailable" };
    }
  },
});
