import type { ExpertScheduleView } from "./booking-service.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const CLIENT_VIEW_TTL_SECONDS = 10 * 60;
const CLIENT_CHOICE_LIMIT = 20;

export interface ExpertTelegramQueryPrincipal {
  readonly expertId: string;
  readonly telegramUserId: string;
  readonly timezone: string;
}

export interface ClientViewClaims {
  readonly reservationId: string;
  readonly expertId: string;
  readonly telegramUserId: string;
  readonly version: number;
  readonly expiresAtEpochSeconds: number;
}

export interface AuthenticatedClientViewCallback {
  readonly tokenHash: string;
  readonly claims: ClientViewClaims;
}

export interface ExpertClientChoiceRecord {
  readonly reservationId: string;
  readonly version: number;
  readonly startsAt: Date;
  readonly serviceName: string;
}

export interface ExpertClientChoice {
  readonly callbackData: string;
  readonly startsAt: string;
  readonly serviceName: string;
}

export interface ExpertClientView {
  readonly reservationId: string;
  readonly clientDisplayName: string;
  readonly startsAt: Date;
  readonly serviceName: string;
  readonly preparationNote?: string;
}

export interface ExpertTelegramStats {
  readonly upcoming: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly noShow: number;
}

export interface ExpertTelegramQueryRepository {
  listClientCandidates(command: {
    readonly expertId: string;
    readonly telegramUserId: string;
    readonly now: Date;
    readonly limit: 20;
  }): Promise<readonly ExpertClientChoiceRecord[] | null>;
  readStats(command: {
    readonly expertId: string;
    readonly telegramUserId: string;
    readonly from: string;
    readonly now: Date;
  }): Promise<ExpertTelegramStats | null>;
  consumeClientView(command: {
    readonly tokenHash: string;
    readonly reservationId: string;
    readonly expertId: string;
    readonly telegramUserId: string;
    readonly version: number;
    readonly now: Date;
    readonly correlationId: string;
  }): Promise<ExpertClientView | null>;
}

export interface ExpertTelegramQueryService {
  schedule(
    principal: ExpertTelegramQueryPrincipal,
  ): Promise<ExpertScheduleView>;
  clientChoices(
    principal: ExpertTelegramQueryPrincipal,
  ): Promise<readonly ExpertClientChoice[]>;
  stats(principal: ExpertTelegramQueryPrincipal): Promise<ExpertTelegramStats>;
  clientView(command: {
    readonly principal: ExpertTelegramQueryPrincipal;
    readonly authenticated: AuthenticatedClientViewCallback;
    readonly correlationId: string;
  }): Promise<ExpertClientView>;
}

export const createExpertTelegramQueryService = (deps: {
  readonly booking: {
    getExpertSchedule(command: {
      readonly expertId: string;
      readonly telegramUserId: string;
      readonly timezone: string;
      readonly from: string;
      readonly to: string;
    }): Promise<ExpertScheduleView>;
  };
  readonly repository: ExpertTelegramQueryRepository;
  readonly clientViewCallbacks: {
    issue(claims: ClientViewClaims): Promise<string>;
  };
  readonly clock: { now(): Date };
}): ExpertTelegramQueryService => ({
  async schedule(principal) {
    const now = deps.clock.now();
    if (!Number.isFinite(now.getTime()))
      throw new Error("expert_query_unavailable");
    return deps.booking.getExpertSchedule({
      ...principal,
      from: now.toISOString(),
      to: new Date(now.getTime() + SEVEN_DAYS_MS).toISOString(),
    });
  },

  async clientChoices(principal) {
    const now = deps.clock.now();
    if (!Number.isFinite(now.getTime()))
      throw new Error("expert_query_unavailable");
    const records = await deps.repository.listClientCandidates({
      expertId: principal.expertId,
      telegramUserId: principal.telegramUserId,
      now,
      limit: CLIENT_CHOICE_LIMIT,
    });
    if (records === null) throw new Error("expert_query_unavailable");
    return Promise.all(
      records.map(async (record) => ({
        callbackData: await deps.clientViewCallbacks.issue({
          reservationId: record.reservationId,
          expertId: principal.expertId,
          telegramUserId: principal.telegramUserId,
          version: record.version,
          expiresAtEpochSeconds:
            Math.floor(now.getTime() / 1_000) + CLIENT_VIEW_TTL_SECONDS,
        }),
        startsAt: record.startsAt.toISOString(),
        serviceName: record.serviceName,
      })),
    );
  },

  async stats(principal) {
    const now = deps.clock.now();
    if (!Number.isFinite(now.getTime()))
      throw new Error("expert_query_unavailable");
    const result = await deps.repository.readStats({
      expertId: principal.expertId,
      telegramUserId: principal.telegramUserId,
      from: new Date(now.getTime() - THIRTY_DAYS_MS).toISOString(),
      now,
    });
    if (result === null) throw new Error("expert_query_unavailable");
    return result;
  },

  async clientView(command) {
    const now = deps.clock.now();
    if (
      !Number.isFinite(now.getTime()) ||
      command.authenticated.claims.telegramUserId !==
        command.principal.telegramUserId
    )
      throw new Error("expert_query_unavailable");
    const result = await deps.repository.consumeClientView({
      tokenHash: command.authenticated.tokenHash,
      reservationId: command.authenticated.claims.reservationId,
      expertId: command.principal.expertId,
      telegramUserId: command.principal.telegramUserId,
      version: command.authenticated.claims.version,
      now,
      correlationId: command.correlationId,
    });
    if (result === null) throw new Error("expert_query_unavailable");
    return result;
  },
});
