import { z } from "zod";
import { TransportFailure } from "../http/transport-failure.js";

const MAX_RETRY_AFTER_SECONDS = 60;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

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

export interface ExpertReferralSummaryTelegramView {
  readonly code: {
    readonly status: "none" | "issued" | "redeemed" | "revoked";
    readonly maskedSuffix: string | null;
  };
  readonly spendableBalanceMinor: string;
  readonly reservedBalanceMinor: string;
  readonly debtMinor: string;
  readonly nearestExpiryAt: string | null;
}

export interface ExpertResidencyQuoteTelegramView {
  readonly tariffVersionId: string;
  readonly displayName: string;
  readonly description: string;
  readonly priceMinor: string;
  readonly currency: "RUB";
  readonly durationSeconds: number;
  readonly creditMinor: string;
  readonly cashMinor: string;
}

const decimalMinor = /^[0-9]{1,19}$/u;
const safeText = /^[^\u0000-\u001F\u007F-\u009F]{1,256}$/u;
const canonicalUtcInstant =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const isCanonicalUtcInstant = (value: string): boolean => {
  const parsed = new Date(value);
  return (
    canonicalUtcInstant.test(value) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString() === value
  );
};

export const renderExpertReferralSummary = (
  view: ExpertReferralSummaryTelegramView,
): string => {
  if (
    !["none", "issued", "redeemed", "revoked"].includes(view.code.status) ||
    (view.code.status === "none"
      ? view.code.maskedSuffix !== null
      : typeof view.code.maskedSuffix !== "string" ||
        !/^…[A-Za-z0-9]{4,12}$/u.test(view.code.maskedSuffix)) ||
    !decimalMinor.test(view.spendableBalanceMinor) ||
    !decimalMinor.test(view.reservedBalanceMinor) ||
    !decimalMinor.test(view.debtMinor) ||
    (view.nearestExpiryAt !== null &&
      !isCanonicalUtcInstant(view.nearestExpiryAt))
  ) {
    throw new Error("invalid_expert_referral_view");
  }
  const code =
    view.code.status === "none"
      ? "none"
      : `${view.code.status} ${view.code.maskedSuffix}`;
  return [
    `Referral code: ${code}`,
    `Spendable (minor): ${view.spendableBalanceMinor}`,
    `Reserved (minor): ${view.reservedBalanceMinor}`,
    `Debt (minor): ${view.debtMinor}`,
    `Nearest expiry: ${view.nearestExpiryAt ?? "none"}`,
  ].join("\n");
};

export const renderExpertResidencyQuote = (
  view: ExpertResidencyQuoteTelegramView,
): string => {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(view.tariffVersionId) ||
    !safeText.test(view.displayName) ||
    !safeText.test(view.description) ||
    !decimalMinor.test(view.priceMinor) ||
    view.currency !== "RUB" ||
    !Number.isSafeInteger(view.durationSeconds) ||
    view.durationSeconds < 86_400 ||
    view.durationSeconds > 315_360_000 ||
    !decimalMinor.test(view.creditMinor) ||
    !decimalMinor.test(view.cashMinor)
  ) {
    throw new Error("invalid_expert_residency_quote_view");
  }
  return [
    `${view.displayName}: ${view.description}`,
    `Price: ${view.priceMinor} ${view.currency}`,
    `Referral credit: ${view.creditMinor}`,
    `Cash: ${view.cashMinor}`,
    `Duration seconds: ${String(view.durationSeconds)}`,
  ].join("\n");
};

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

export class TelegramAdapter implements TelegramPort {
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
