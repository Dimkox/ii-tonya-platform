import type {
  ExpertTelegramQueryViewPort,
  ExpertTelegramViewPort,
} from "./telegram-adapter.js";
import type { TelegramSendOutcome } from "./telegram-adapter.js";

export interface ExpertTelegramCommandPrincipal {
  readonly userId: string;
  readonly expertId: string;
  readonly telegramUserId: string;
  readonly timezone: string;
}

interface FinancialPrincipal {
  readonly authenticated: true;
  readonly userId: string;
  readonly expertId: string;
}

interface ReferralQueryService {
  redeemCode(
    principal: FinancialPrincipal,
    code: string,
    idempotencyKey: string,
  ): Promise<
    | { readonly kind: "redeemed"; readonly referralId: string }
    | { readonly kind: "forbidden" | "disabled" }
  >;
  summary(principal: FinancialPrincipal): Promise<
    | {
        readonly availableMinor: string;
        readonly reservedMinor: string;
        readonly debtMinor: string;
        readonly nearestExpiry: string | null;
      }
    | { readonly kind: "forbidden" }
  >;
}

interface ResidencyQueryService {
  quote(
    principal: FinancialPrincipal,
    tariffVersionId: string,
  ): Promise<
    | {
        readonly tariffVersionId?: string;
        readonly displayName?: string;
        readonly priceMinor: string;
        readonly creditMinor: string;
        readonly cashMinor: string;
        readonly currency?: "RUB";
        readonly durationSeconds?: number;
      }
    | { readonly kind: "forbidden" | "disabled" }
  >;
}

interface QueryService {
  schedule(principal: ExpertTelegramCommandPrincipal): Promise<{
    readonly timezone: string;
    readonly appointments: readonly {
      readonly startsAt: string;
      readonly status: string;
      readonly clientDisplayName: string;
      readonly expertNote?: string;
      readonly meetingUrl?: string;
    }[];
  }>;
  clientChoices(principal: ExpertTelegramCommandPrincipal): Promise<
    readonly {
      readonly startsAt: string;
      readonly serviceName: string;
      readonly callbackData: string;
    }[]
  >;
  stats(principal: ExpertTelegramCommandPrincipal): Promise<{
    readonly upcoming: number;
    readonly completed: number;
    readonly cancelled: number;
    readonly noShow: number;
  }>;
  clientView(command: {
    readonly principal: ExpertTelegramCommandPrincipal;
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
    readonly principal: ExpertTelegramCommandPrincipal;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<{
    readonly kind: "processed" | "unsupported" | "disabled" | "unavailable";
    readonly deliveryOutcome?: "applied" | "unknown_outcome";
  }>;
  processClientView(command: {
    readonly principal: ExpertTelegramCommandPrincipal;
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
  readonly financialViewsEnabled?: boolean;
  readonly referralMutationsEnabled?: boolean;
  readonly queries: QueryService;
  readonly views: ExpertTelegramQueryViewPort & ExpertTelegramViewPort;
  readonly referral?: ReferralQueryService;
  readonly residency?: ResidencyQueryService;
}): ExpertCommandProcessor => {
  if (
    (deps.financialViewsEnabled === true ||
      deps.referralMutationsEnabled === true) &&
    (deps.referral === undefined ||
      (deps.financialViewsEnabled === true && deps.residency === undefined))
  ) {
    throw new Error("Expert Telegram financial query capability is required");
  }
  const financialPrincipal = (
    principal: ExpertTelegramCommandPrincipal,
  ): FinancialPrincipal => ({
    authenticated: true,
    userId: principal.userId,
    expertId: principal.expertId,
  });
  const tariffCommand =
    /^\/residency ([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
  const redeemCommand = /^\/redeem (EXR_[A-Za-z0-9_-]{8,128})$/u;
  return {
    async processCommand(command) {
      if (!deps.enabled) return { kind: "disabled" };
      if (command.chatType !== "private") return { kind: "unavailable" };
      switch (command.text) {
        case "/referral": {
          if (deps.financialViewsEnabled !== true) {
            const deliveryOutcome = ordinaryDeliveryOutcome(
              await deps.views.sendUnsupported({
                idempotencyKey: command.idempotencyKey,
                telegramUserId: command.principal.telegramUserId,
              }),
            );
            return { kind: "unsupported", deliveryOutcome };
          }
          const summary = await unavailable(() =>
            deps.referral!.summary(financialPrincipal(command.principal)),
          );
          if ("kind" in summary) throw new Error("expert_query_unavailable");
          const deliveryOutcome = ordinaryDeliveryOutcome(
            await deps.views.sendReferralSummary({
              idempotencyKey: command.idempotencyKey,
              telegramUserId: command.principal.telegramUserId,
              ...summary,
            }),
          );
          return { kind: "processed", deliveryOutcome };
        }
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
        default: {
          const redeemMatch = redeemCommand.exec(command.text);
          if (deps.referralMutationsEnabled === true && redeemMatch !== null) {
            const result = await unavailable(() =>
              deps.referral!.redeemCode(
                financialPrincipal(command.principal),
                redeemMatch[1]!,
                command.idempotencyKey,
              ),
            );
            if (result.kind !== "redeemed") {
              throw new Error("expert_query_unavailable");
            }
            const deliveryOutcome = ordinaryDeliveryOutcome(
              await deps.views.sendReferralRedeemed({
                idempotencyKey: `${command.idempotencyKey}:redeem:delivery`,
                telegramUserId: command.principal.telegramUserId,
              }),
            );
            return { kind: "processed", deliveryOutcome };
          }
          const match = tariffCommand.exec(command.text);
          if (deps.financialViewsEnabled === true && match !== null) {
            const quote = await unavailable(() =>
              deps.residency!.quote(
                financialPrincipal(command.principal),
                match[1]!,
              ),
            );
            if ("kind" in quote) throw new Error("expert_query_unavailable");
            if (
              quote.tariffVersionId === undefined ||
              quote.tariffVersionId !== match[1] ||
              quote.displayName === undefined ||
              quote.currency !== "RUB" ||
              quote.durationSeconds === undefined
            ) {
              throw new Error("expert_query_unavailable");
            }
            const deliveryOutcome = ordinaryDeliveryOutcome(
              await deps.views.sendResidencyQuote({
                idempotencyKey: command.idempotencyKey,
                telegramUserId: command.principal.telegramUserId,
                tariffVersionId: quote.tariffVersionId,
                displayName: quote.displayName,
                priceMinor: quote.priceMinor,
                creditMinor: quote.creditMinor,
                cashMinor: quote.cashMinor,
                currency: quote.currency,
                durationSeconds: quote.durationSeconds,
              }),
            );
            return { kind: "processed", deliveryOutcome };
          }
          const deliveryOutcome = ordinaryDeliveryOutcome(
            await deps.views.sendUnsupported({
              idempotencyKey: command.idempotencyKey,
              telegramUserId: command.principal.telegramUserId,
            }),
          );
          return { kind: "unsupported", deliveryOutcome };
        }
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
  };
};
