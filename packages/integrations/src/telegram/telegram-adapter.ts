import { z } from "zod";
import { TransportFailure } from "../http/transport-failure.js";

const MAX_RETRY_AFTER_SECONDS = 60;
const TELEGRAM_TEXT_LIMIT = 4_096;
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

export interface TelegramExpertScheduleView {
  idempotencyKey: string;
  telegramUserId: string;
  timezone: string;
  appointments: readonly {
    startsAt: string;
    status: "reserved" | "booked";
    clientDisplayName: string;
    expertNote?: string;
    meetingUrl?: string;
  }[];
}

export interface TelegramExpertClientChoicesView {
  idempotencyKey: string;
  telegramUserId: string;
  timezone: string;
  choices: readonly {
    startsAt: string;
    serviceName: string;
    callbackData: string;
  }[];
}

export interface TelegramExpertClientView {
  idempotencyKey: string;
  telegramUserId: string;
  timezone: string;
  clientDisplayName: string;
  startsAt: string;
  serviceName: string;
  preparationNote?: string;
}

export interface TelegramExpertStatsView {
  idempotencyKey: string;
  telegramUserId: string;
  upcoming: number;
  completed: number;
  cancelled: number;
  noShow: number;
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
  checkoutCallbackData?: string;
}
export interface ExpertResidencyTariffsView {
  idempotencyKey: string;
  telegramUserId: string;
  tariffs: readonly {
    tariffVersionId: string;
    displayName: string;
    priceMinor: string;
    currency: "RUB";
    durationSeconds: number;
  }[];
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
  sendReferralRedeemed(view: {
    idempotencyKey: string;
    telegramUserId: string;
  }): Promise<TelegramSendOutcome>;
  sendReferralSummary(
    view: ExpertReferralSummaryView,
  ): Promise<TelegramSendOutcome>;
  sendResidencyQuote(
    view: ExpertResidencyQuoteView,
  ): Promise<TelegramSendOutcome>;
  sendResidencyTariffs(
    view: ExpertResidencyTariffsView,
  ): Promise<TelegramSendOutcome>;
  sendResidencyCheckoutLink(view: {
    idempotencyKey: string;
    telegramUserId: string;
    checkoutUrl: string;
  }): Promise<TelegramSendOutcome>;
}

export interface ExpertTelegramQueryViewPort {
  sendQuerySchedule(
    view: TelegramExpertScheduleView,
  ): Promise<TelegramSendOutcome>;
  sendClientChoices(
    view: TelegramExpertClientChoicesView,
  ): Promise<TelegramSendOutcome>;
  sendClientView(view: TelegramExpertClientView): Promise<TelegramSendOutcome>;
  sendStats(view: TelegramExpertStatsView): Promise<TelegramSendOutcome>;
  sendUnsupported(view: {
    idempotencyKey: string;
    telegramUserId: string;
  }): Promise<TelegramSendOutcome>;
  answerCallbackQuery(view: {
    idempotencyKey: string;
    callbackQueryId: string;
    status: "processed" | "unavailable";
  }): Promise<TelegramSendOutcome>;
}

export interface TelegramTransportRequest {
  method: "POST";
  url: URL;
  headers: Readonly<Record<string, string>>;
  body:
    | {
        chat_id: string;
        text: string;
        reply_markup?: {
          inline_keyboard: readonly (readonly {
            text: string;
            callback_data: string;
          }[])[];
        };
      }
    | { callback_query_id: string; text: string; show_alert: false };
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
  (Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value);

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
    (view.maskedCodeStatus !== undefined &&
      !safeText.test(view.maskedCodeStatus))
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

const assertPlainText = (value: string, maximum: number): void => {
  if (
    value.length < 1 ||
    value.length > maximum ||
    /[\u0000-\u001F\u007F-\u009F]/u.test(value)
  ) {
    throw new Error("invalid_expert_view");
  }
};

const normalizeNote = (value: string): string => {
  if (value.length > 64 * 1024 || /[\u0000\u007F-\u009F]/u.test(value)) {
    throw new Error("invalid_expert_view");
  }
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) throw new Error("invalid_expert_view");
  return normalized;
};

const truncate = (value: string, maximum: number, marker: string): string =>
  value.length <= maximum
    ? value
    : `${value.slice(0, Math.max(0, maximum - marker.length - 1)).trimEnd()} ${marker}`;

const assertTelegramText = (value: string): void => {
  if (
    value.length < 1 ||
    value.length > TELEGRAM_TEXT_LIMIT ||
    Buffer.from(value, "utf8").toString("utf8") !== value
  ) {
    throw new Error("invalid_expert_view");
  }
};

const formatInstant = (
  value: string,
  timezone: string,
  includeTimezone: boolean,
): string => {
  if (!validInstantOrNull(value)) throw new Error("invalid_expert_view");
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(value));
  } catch {
    throw new Error("invalid_expert_view");
  }
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const formatted = `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}`;
  return includeTimezone ? `${formatted} (${timezone})` : formatted;
};

const assertCount = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("invalid_expert_view");
  }
};

const tariffUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function renderExpertResidencyTariffs(
  view: ExpertResidencyTariffsView,
): string {
  if (view.tariffs.length > 20) throw new Error("invalid_expert_view");
  if (view.tariffs.length === 0) {
    return "Активных тарифов резидентства сейчас нет.";
  }
  const blocks = view.tariffs.map((tariff, index) => {
    assertPlainText(tariff.displayName, 256);
    assertMoney(tariff.priceMinor);
    if (
      !tariffUuid.test(tariff.tariffVersionId) ||
      tariff.currency !== "RUB" ||
      BigInt(tariff.priceMinor) <= 0n ||
      !Number.isSafeInteger(tariff.durationSeconds) ||
      tariff.durationSeconds < 1
    ) {
      throw new Error("invalid_expert_view");
    }
    return [
      `${index + 1}. ${tariff.displayName}`,
      `Цена: ${tariff.priceMinor} RUB minor units`,
      `Срок: ${tariff.durationSeconds} секунд`,
      `ID: ${tariff.tariffVersionId}`,
      `Расчёт: /residency ${tariff.tariffVersionId}`,
    ].join("\n");
  });
  const header = "Доступные тарифы резидентства:";
  const selected: string[] = [];
  for (const block of blocks) {
    const nextCount = selected.length + 1;
    const marker = `Показано ${nextCount} из ${blocks.length}.`;
    const candidate = [
      header,
      ...selected,
      block,
      ...(nextCount < blocks.length ? [marker] : []),
    ].join("\n\n");
    if (candidate.length > TELEGRAM_TEXT_LIMIT) break;
    selected.push(block);
  }
  if (selected.length === 0) throw new Error("invalid_expert_view");
  const rendered = [
    header,
    ...selected,
    ...(selected.length < blocks.length
      ? [`Показано ${selected.length} из ${blocks.length}.`]
      : []),
  ].join("\n\n");
  assertTelegramText(rendered);
  return rendered;
}

export function renderTelegramExpertSchedule(
  view: TelegramExpertScheduleView,
): string {
  if (view.appointments.length === 0) return "Записей на ближайшие 7 дней нет.";
  const blocks = view.appointments.map((appointment) => {
    assertPlainText(appointment.clientDisplayName, 256);
    const note =
      appointment.expertNote === undefined
        ? undefined
        : truncate(
            normalizeNote(appointment.expertNote),
            1_000,
            "[заметка сокращена]",
          );
    if (
      appointment.meetingUrl !== undefined &&
      (!/^https:\/\/[^\s]+$/u.test(appointment.meetingUrl) ||
        appointment.meetingUrl.length > 2_048)
    ) {
      throw new Error("invalid_expert_view");
    }
    return [
      `${formatInstant(appointment.startsAt, view.timezone, true)} — ${appointment.clientDisplayName}`,
      `Статус: ${appointment.status}`,
      ...(note === undefined ? [] : [`Заметка: ${note}`]),
      ...(appointment.status === "booked" &&
      appointment.meetingUrl !== undefined
        ? [`Встреча: ${appointment.meetingUrl}`]
        : []),
    ].join("\n");
  });
  const selected: string[] = [];
  for (const block of blocks) {
    const nextCount = selected.length + 1;
    const marker = `Показано ${nextCount} из ${blocks.length}.`;
    const candidate = [
      ...selected,
      block,
      ...(nextCount < blocks.length ? [marker] : []),
    ].join("\n\n");
    if (candidate.length > TELEGRAM_TEXT_LIMIT) break;
    selected.push(block);
  }
  if (selected.length === 0) throw new Error("invalid_expert_view");
  const rendered = [
    ...selected,
    ...(selected.length < blocks.length
      ? [`Показано ${selected.length} из ${blocks.length}.`]
      : []),
  ].join("\n\n");
  assertTelegramText(rendered);
  return rendered;
}

export function renderTelegramExpertClient(
  view: TelegramExpertClientView,
): string {
  assertPlainText(view.clientDisplayName, 256);
  assertPlainText(view.serviceName, 256);
  const prefix = [
    `Клиент: ${view.clientDisplayName}`,
    `Время: ${formatInstant(view.startsAt, view.timezone, true)}`,
    `Услуга: ${view.serviceName}`,
  ];
  const notePrefix = "Заметка для подготовки: ";
  const available =
    TELEGRAM_TEXT_LIMIT - prefix.join("\n").length - notePrefix.length - 1;
  const note =
    view.preparationNote === undefined
      ? undefined
      : truncate(
          normalizeNote(view.preparationNote),
          available,
          "[заметка сокращена]",
        );
  const rendered = [
    ...prefix,
    ...(note === undefined ? [] : [`${notePrefix}${note}`]),
  ].join("\n");
  assertTelegramText(rendered);
  return rendered;
}

export function renderTelegramExpertStats(
  view: TelegramExpertStatsView,
): string {
  [view.upcoming, view.completed, view.cancelled, view.noShow].forEach(
    assertCount,
  );
  return [
    `Предстоящие: ${view.upcoming}`,
    `Завершённые за 30 дней: ${view.completed}`,
    `Отменённые за 30 дней: ${view.cancelled}`,
    `Неявки за 30 дней: ${view.noShow}`,
  ].join("\n");
}

export function buildTelegramMethodUrl(
  baseUrl: URL,
  botToken: string,
  method: "sendMessage" | "answerCallbackQuery",
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
  const method = /^\/bot[^/]+\/(sendMessage|answerCallbackQuery)$/u.exec(
    redacted.pathname,
  )?.[1];
  redacted.pathname =
    method === undefined ? "/[REDACTED]" : `/bot[REDACTED]/${method}`;
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

export class TelegramAdapter
  implements TelegramPort, ExpertTelegramViewPort, ExpertTelegramQueryViewPort
{
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

  async sendReferralRedeemed(view: {
    idempotencyKey: string;
    telegramUserId: string;
  }): Promise<TelegramSendOutcome> {
    return this.sendText({
      ...view,
      text: "Экспертный промокод принят.",
    });
  }

  async sendResidencyQuote(
    view: ExpertResidencyQuoteView,
  ): Promise<TelegramSendOutcome> {
    const callbackData = view.checkoutCallbackData;
    if (
      callbackData !== undefined &&
      (!callbackData.startsWith("xr1.") ||
        Buffer.byteLength(callbackData, "utf8") > 64 ||
        Buffer.byteLength(callbackData, "utf8") < 1)
    ) {
      throw new Error("invalid_expert_view");
    }
    return this.sendText({
      idempotencyKey: view.idempotencyKey,
      telegramUserId: view.telegramUserId,
      text: renderExpertResidencyQuote(view),
      ...(callbackData === undefined
        ? {}
        : {
            replyMarkup: {
              inline_keyboard: [
                [{ text: "Оплатить", callback_data: callbackData }],
              ],
            },
          }),
    });
  }

  async sendResidencyTariffs(
    view: ExpertResidencyTariffsView,
  ): Promise<TelegramSendOutcome> {
    return this.sendText({
      idempotencyKey: view.idempotencyKey,
      telegramUserId: view.telegramUserId,
      text: renderExpertResidencyTariffs(view),
    });
  }

  async sendResidencyCheckoutLink(view: {
    idempotencyKey: string;
    telegramUserId: string;
    checkoutUrl: string;
  }): Promise<TelegramSendOutcome> {
    if (
      view.checkoutUrl.length < 1 ||
      view.checkoutUrl.length > 2_048 ||
      /\s/u.test(view.checkoutUrl)
    ) {
      throw new Error("invalid_expert_view");
    }
    let checkoutUrl: URL;
    try {
      checkoutUrl = new URL(view.checkoutUrl);
    } catch {
      throw new Error("invalid_expert_view");
    }
    if (
      checkoutUrl.protocol !== "https:" ||
      checkoutUrl.username !== "" ||
      checkoutUrl.password !== ""
    ) {
      throw new Error("invalid_expert_view");
    }
    return this.sendText({
      idempotencyKey: view.idempotencyKey,
      telegramUserId: view.telegramUserId,
      text: `Оплата резидентства: ${view.checkoutUrl}`,
    });
  }

  async sendQuerySchedule(
    view: TelegramExpertScheduleView,
  ): Promise<TelegramSendOutcome> {
    return this.sendText({
      idempotencyKey: view.idempotencyKey,
      telegramUserId: view.telegramUserId,
      text: renderTelegramExpertSchedule(view),
    });
  }

  async sendClientChoices(
    view: TelegramExpertClientChoicesView,
  ): Promise<TelegramSendOutcome> {
    const inlineKeyboard = view.choices.map((choice, index) => {
      if (
        !validInstantOrNull(choice.startsAt) ||
        Buffer.byteLength(choice.callbackData, "utf8") < 1 ||
        Buffer.byteLength(choice.callbackData, "utf8") > 64 ||
        !choice.callbackData.startsWith("cv1.")
      ) {
        throw new Error("invalid_expert_view");
      }
      assertPlainText(choice.serviceName, 256);
      return [
        {
          text: `Запись ${index + 1} · ${formatInstant(choice.startsAt, view.timezone, false)}`,
          callback_data: choice.callbackData,
        },
      ];
    });
    return this.sendText({
      idempotencyKey: view.idempotencyKey,
      telegramUserId: view.telegramUserId,
      text:
        view.choices.length === 0
          ? "Активных записей нет."
          : "Выберите запись:",
      ...(inlineKeyboard.length === 0
        ? {}
        : { replyMarkup: { inline_keyboard: inlineKeyboard } }),
    });
  }

  async sendClientView(
    view: TelegramExpertClientView,
  ): Promise<TelegramSendOutcome> {
    return this.sendText({
      idempotencyKey: view.idempotencyKey,
      telegramUserId: view.telegramUserId,
      text: renderTelegramExpertClient(view),
    });
  }

  async sendStats(view: TelegramExpertStatsView): Promise<TelegramSendOutcome> {
    return this.sendText({
      idempotencyKey: view.idempotencyKey,
      telegramUserId: view.telegramUserId,
      text: renderTelegramExpertStats(view),
    });
  }

  async sendUnsupported(view: {
    idempotencyKey: string;
    telegramUserId: string;
  }): Promise<TelegramSendOutcome> {
    return this.sendText({ ...view, text: "Команда недоступна." });
  }

  async answerCallbackQuery(view: {
    idempotencyKey: string;
    callbackQueryId: string;
    status: "processed" | "unavailable";
  }): Promise<TelegramSendOutcome> {
    assertPlainText(view.callbackQueryId, 256);
    const url = buildTelegramMethodUrl(
      this.deps.baseUrl,
      this.deps.botToken,
      "answerCallbackQuery",
    );
    let response: TelegramTransportResponse;
    try {
      response = await this.deps.transport.request({
        method: "POST",
        url,
        headers: { "content-type": "application/json" },
        body: {
          callback_query_id: view.callbackQueryId,
          text:
            view.status === "processed"
              ? "Готово."
              : "Запрос недоступен. Откройте /client ещё раз.",
          show_alert: false,
        },
        context: {
          idempotencyKey: view.idempotencyKey,
          disableRequestLogging: true,
        },
      });
    } catch (error) {
      const beforeWrite =
        error instanceof TransportFailure && error.phase === "before_write";
      const reasonCode = beforeWrite
        ? "timeout_before_write"
        : "callback_answer_outcome_unknown";
      logFailure(this.deps, url, reasonCode);
      return beforeWrite
        ? { kind: "not_applied", retryable: true, reasonCode }
        : {
            kind: "unknown_outcome",
            reconciliationKey: view.idempotencyKey,
            reasonCode,
          };
    }
    if (
      response.status === 200 &&
      response.body !== null &&
      typeof response.body === "object" &&
      (response.body as { ok?: unknown }).ok === true
    ) {
      return { kind: "applied", providerOperationId: view.callbackQueryId };
    }
    return {
      kind: "not_applied",
      retryable: response.status === 429,
      reasonCode:
        response.status === 429 ? "rate_limited" : "callback_answer_rejected",
    };
  }

  private async sendText(
    view: (ExpertReservationView | ExpertScheduleView) & {
      replyMarkup?: {
        inline_keyboard: readonly (readonly {
          text: string;
          callback_data: string;
        }[])[];
      };
    },
  ): Promise<TelegramSendOutcome> {
    assertTelegramText(view.text);
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
          ...(view.replyMarkup === undefined
            ? {}
            : { reply_markup: view.replyMarkup }),
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
