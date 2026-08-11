import { z } from "zod";
import { TransportFailure } from "../http/transport-failure.js";

const MAX_RETRY_AFTER_SECONDS = 60;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const money = /^(?:0|[1-9]\d*)$/u;
const safeText = /^[^\u0000-\u001F\u007F-\u009F]{1,256}$/u;

const callbackQuerySchema = z
  .object({
    id: z.string().min(1),
    from: z.object({ id: z.number().int().positive() }).passthrough(),
    data: z.string().min(1).max(64),
  })
  .passthrough();

const updateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    callback_query: callbackQuerySchema.optional(),
  })
  .passthrough();

const sendSuccessSchema = z
  .object({
    ok: z.literal(true),
    result: z
      .object({
        message_id: z.number().int(),
      })
      .passthrough(),
  })
  .strict();

const rateLimitSchema = z
  .object({
    ok: z.literal(false),
    error_code: z.literal(429),
    parameters: z
      .object({
        retry_after: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

export interface TelegramUpdate {
  updateId: number;
  callbackQuery?: {
    id: string;
    telegramUserId: string;
    data: string;
  };
}

export interface ExpertReservationView {
  idempotencyKey: string;
  telegramUserId: string;
  text: string;
}

export interface ExpertScheduleView {
  idempotencyKey: string;
  telegramUserId: string;
  text: string;
}

export interface ExpertReferralSummaryView {
  idempotencyKey: string;
  telegramUserId: string;
  availableMinor: string;
  reservedMinor: string;
  debtMinor: string;
  nearestExpiry: string | null;
  maskedCodeStatus?: string;
}

export interface ExpertResidencyQuoteView {
  idempotencyKey: string;
  telegramUserId: string;
  tariffVersionId: string;
  displayName: string;
  priceMinor: string;
  creditMinor: string;
  cashMinor: string;
  currency: "RUB";
  durationSeconds: number;
}

export type TelegramSendOutcome =
  | { kind: "applied"; providerOperationId: string }
  | {
      kind: "not_applied";
      retryable: boolean;
      reasonCode: string;
      retryAfterMs?: number;
    }
  | { kind: "unknown_outcome"; reconciliationKey: string; reasonCode: string };

export interface TelegramPort {
  decodeUpdate(rawBody: Uint8Array): Promise<TelegramUpdate>;
  sendReservationRequest(
    view: ExpertReservationView,
  ): Promise<TelegramSendOutcome>;
  sendSchedule(view: ExpertScheduleView): Promise<TelegramSendOutcome>;
}

export interface ExpertTelegramViewPort {
  sendReferralSummary(
    view: ExpertReferralSummaryView,
  ): Promise<TelegramSendOutcome>;
  sendResidencyQuote(
    view: ExpertResidencyQuoteView,
  ): Promise<TelegramSendOutcome>;
}

export interface TelegramTransportRequest {
  method: "POST";
  url: URL;
  headers: Readonly<Record<string, string>>;
  body: {
    chat_id: string;
    text: string;
  };
  context: {
    idempotencyKey: string;
    disableRequestLogging: true;
  };
}

export interface TelegramTransportResponse {
  status: number;
  body: unknown;
}

export interface TelegramTransport {
  request(
    request: TelegramTransportRequest,
  ): Promise<TelegramTransportResponse>;
}

export interface TelegramAdapterDeps {
  baseUrl: URL;
  botToken: string;
  transport: TelegramTransport;
  logger: {
    error(entry: unknown): void;
  };
  maxBodyBytes: number;
}

const validInstantOrNull = (value: string | null): boolean =>
  value === null ||
  (Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

const assertMoney = (...values: string[]): void => {
  if (!values.every((value) => money.test(value))) {
    throw new Error("invalid_expert_view");
  }
};

export function renderExpertReferralSummary(
  view: ExpertReferralSummaryView,
): string {
  assertMoney(view.availableMinor, view.reservedMinor, view.debtMinor);
  if (
    !validInstantOrNull(view.nearestExpiry) ||
    (view.maskedCodeStatus !== undefined && !safeText.test(view.maskedCodeStatus))
  ) {
    throw new Error("invalid_expert_view");
  }
  return [
    `Referral credit: ${view.availableMinor} RUB minor units`,
    `Reserved: ${view.reservedMinor} RUB minor units`,
    `Debt: ${view.debtMinor} RUB minor units`,
    `Nearest expiry: ${view.nearestExpiry ?? "none"}`,
    ...(view.maskedCodeStatus === undefined
      ? []
      : [`Code status: ${view.maskedCodeStatus}`]),
  ].join("\n");
}

export function renderExpertResidencyQuote(
  view: ExpertResidencyQuoteView,
): string {
  assertMoney(view.priceMinor, view.creditMinor, view.cashMinor);
  if (
    view.currency !== "RUB" ||
    !safeText.test(view.displayName) ||
    !Number.isSafeInteger(view.durationSeconds) ||
    view.durationSeconds < 86_400 ||
    view.durationSeconds > 315_360_000
  ) {
    throw new Error("invalid_expert_view");
  }
  return [
    `Tariff: ${view.displayName}`,
    `Price: ${view.priceMinor} RUB minor units`,
    `Referral credit: ${view.creditMinor} RUB minor units`,
    `Cash due: ${view.cashMinor} RUB minor units`,
    `Duration: ${view.durationSeconds} seconds`,
  ].join("\n");
}

export function buildTelegramMethodUrl(
  baseUrl: URL,
  botToken: string,
  method: "sendMessage",
): URL {
  if (baseUrl.protocol !== "https:") {
    throw new Error("Telegram base URL must use HTTPS");
  }
  if (
    botToken.length === 0 ||
    botToken.includes("/") ||
    botToken.includes("?") ||
    botToken.includes("#")
  ) {
    throw new Error("Invalid Telegram bot token");
  }
  const url = new URL(baseUrl);
  url.pathname = `/bot${botToken}/${method}`;
  url.search = "";
  url.hash = "";
  return url;
}

export function redactTelegramUrl(url: URL): string {
  const redacted = new URL(url);
  redacted.username = "";
  redacted.password = "";
  redacted.search = "";
  redacted.hash = "";
  redacted.pathname = /^\/bot[^/]+\/sendMessage$/u.test(redacted.pathname)
    ? "/bot[REDACTED]/sendMessage"
    : "/[REDACTED]";
  return redacted.toString();
}

const logFailure = (
  deps: TelegramAdapterDeps,
  url: URL,
  reasonCode: string,
): void => {
  deps.logger.error({
    provider: "telegram",
    operation: "sendMessage",
    reasonCode,
    url: redactTelegramUrl(url),
  });
};

export class TelegramAdapter implements TelegramPort, ExpertTelegramViewPort {
  private readonly deps: TelegramAdapterDeps;

  constructor(deps: TelegramAdapterDeps) {
    if (
      !Number.isSafeInteger(deps.maxBodyBytes) ||
      deps.maxBodyBytes < 1 ||
      deps.maxBodyBytes > 64 * 1024
    ) {
      throw new Error("invalid_max_body_bytes");
    }
    this.deps = deps;
    buildTelegramMethodUrl(deps.baseUrl, deps.botToken, "sendMessage");
  }

  async decodeUpdate(rawBody: Uint8Array): Promise<TelegramUpdate> {
    if (rawBody.byteLength > this.deps.maxBodyBytes) {
      throw new Error("body_size");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(utf8Decoder.decode(rawBody));
    } catch {
      throw new Error("invalid_schema");
    }
    const update = updateSchema.safeParse(parsed);
    if (!update.success) throw new Error("invalid_schema");
    const callbackQuery = update.data.callback_query;
    return {
      updateId: update.data.update_id,
      ...(callbackQuery === undefined
        ? {}
        : {
            callbackQuery: {
              id: callbackQuery.id,
              telegramUserId: String(callbackQuery.from.id),
              data: callbackQuery.data,
            },
          }),
    };
  }

  async sendReservationRequest(
    view: ExpertReservationView,
  ): Promise<TelegramSendOutcome> {
    return this.sendText(view);
  }

  async sendSchedule(view: ExpertScheduleView): Promise<TelegramSendOutcome> {
    return this.sendText(view);
  }

  async sendReferralSummary(
    view: ExpertReferralSummaryView,
  ): Promise<TelegramSendOutcome> {
    return this.sendText({
      idempotencyKey: view.idempotencyKey,
      telegramUserId: view.telegramUserId,
      text: renderExpertReferralSummary(view),
    });
  }

  async sendResidencyQuote(
    view: ExpertResidencyQuoteView,
  ): Promise<TelegramSendOutcome> {
    return this.sendText({
      idempotencyKey: view.idempotencyKey,
      telegramUserId: view.telegramUserId,
      text: renderExpertResidencyQuote(view),
    });
  }

  private async sendText(
    view: ExpertReservationView | ExpertScheduleView,
  ): Promise<TelegramSendOutcome> {
    const url = buildTelegramMethodUrl(
      this.deps.baseUrl,
      this.deps.botToken,
      "sendMessage",
    );
    let response: TelegramTransportResponse;
    try {
      response = await this.deps.transport.request({
        method: "POST",
        url,
        headers: { "content-type": "application/json" },
        body: {
          chat_id: view.telegramUserId,
          text: view.text,
        },
        context: {
          idempotencyKey: view.idempotencyKey,
          disableRequestLogging: true,
        },
      });
    } catch (error) {
      if (error instanceof TransportFailure && error.phase === "before_write") {
        logFailure(this.deps, url, "timeout_before_write");
        return {
          kind: "not_applied",
          retryable: true,
          reasonCode: "timeout_before_write",
        };
      }
      const reasonCode =
        error instanceof TransportFailure && error.phase === "after_write"
          ? "timeout_after_write"
          : "transport_failure_unknown_phase";
      logFailure(this.deps, url, reasonCode);
      return {
        kind: "unknown_outcome",
        reconciliationKey: view.idempotencyKey,
        reasonCode,
      };
    }

    if (response.status === 200) {
      const success = sendSuccessSchema.safeParse(response.body);
      if (success.success) {
        return {
          kind: "applied",
          providerOperationId: String(success.data.result.message_id),
        };
      }
      logFailure(this.deps, url, "invalid_success_schema");
      return {
        kind: "unknown_outcome",
        reconciliationKey: view.idempotencyKey,
        reasonCode: "invalid_success_schema",
      };
    }

    if (response.status === 429) {
      const rateLimit = rateLimitSchema.safeParse(response.body);
      const retryAfterMs = rateLimit.success
        ? Math.min(
            rateLimit.data.parameters.retry_after,
            MAX_RETRY_AFTER_SECONDS,
          ) * 1_000
        : undefined;
      return {
        kind: "not_applied",
        retryable: true,
        reasonCode: "rate_limited",
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      };
    }

    if (response.status === 400 || response.status === 403) {
      return {
        kind: "not_applied",
        retryable: false,
        reasonCode: "recipient_rejected",
      };
    }
    if (response.status >= 500 && response.status <= 599) {
      const reasonCode = `http_${response.status}_after_write`;
      logFailure(this.deps, url, reasonCode);
      return {
        kind: "unknown_outcome",
        reconciliationKey: view.idempotencyKey,
        reasonCode,
      };
    }
    return {
      kind: "not_applied",
      retryable: false,
      reasonCode: Number.isSafeInteger(response.status)
        ? `http_${response.status}`
        : "invalid_transport_response",
    };
  }
}
