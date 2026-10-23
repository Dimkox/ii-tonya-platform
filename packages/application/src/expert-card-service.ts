import { createHash } from "node:crypto";
export type ExpertCardScope = {
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
};
export type ExpertCardEvent = ExpertCardScope & {
  requestKey: string;
  requestDigest: string;
};
export type ExpertCardEntry =
  | { kind: "text"; text: string }
  | { kind: "photo" | "document"; reference: string };
export type ExpertCardContent = ExpertCardEntry & { caption?: string };
export interface ExpertCardWorkflow {
  applicationId: string;
  draftId: string | null;
  revision: number;
  status: "collecting" | "manager_review" | "changes_requested" | "approved";
  entryCount: number;
  materialStatus:
    "none" | "waiting_content" | "pending" | "delivered" | "unknown_outcome";
  promoConfirmed: boolean;
  activeResident?: boolean;
}
export interface ExpertCardRepository {
  getWorkflow(scope: ExpertCardScope): Promise<ExpertCardWorkflow | null>;
  addEntry(
    input: ExpertCardEvent & {
      expectedRevision: number;
      entry: ExpertCardEntry;
    },
  ): Promise<ExpertCardWorkflow & { replay: boolean }>;
  submitDraft(
    input: ExpertCardEvent & { expectedRevision: number },
  ): Promise<ExpertCardWorkflow & { replay: boolean }>;
  submitPromoProof(
    input: ExpertCardEvent & {
      expectedRevision: number;
      proof: { kind: "link" | "photo" | "document"; reference: string };
    },
  ): Promise<ExpertCardWorkflow & { replay: boolean }>;
  issueWorkHandoff(
    input: ExpertCardEvent,
  ): Promise<
    { kind: "issued"; token: string; expiresAt: string } | { kind: "duplicate" }
  >;
  redeemWorkHandoff(input: ExpertCardEvent & { token: string }): Promise<{
    kind: "linked" | "duplicate";
    applicationId: string;
    userId: string;
  }>;
}
export interface ExpertCardMainCheckoutBinding {
  readonly orderId: string;
  readonly userId: string;
  readonly expertId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly providerMode: "test" | "live";
  readonly purpose: "main_residency";
  readonly paymentDeadline: string;
  readonly idempotencyKey: string;
}
export interface ExpertCardMainCheckout {
  readonly strictFirstSendCancellation: true;
  createOrRecover(
    binding: ExpertCardMainCheckoutBinding,
  ): Promise<
    | { kind: "ready"; orderId: string; paymentId: string; url: string }
    | { kind: "pending" | "unavailable" }
  >;
}
export interface ExpertCardFinancial {
  checkoutBindingForOwner(
    input: ExpertCardEvent & { revision: number },
    orderId: string,
  ): Promise<ExpertCardMainCheckoutBinding>;
  verifyMainCheckoutForOwner(
    input: ExpertCardEvent & { revision: number },
    orderId: string,
    paymentId: string,
  ): Promise<boolean>;
  quoteMain(
    input: ExpertCardEvent & {
      tariffVersionId: string;
      termMonths: 1 | 3;
      revision: number;
    },
  ): Promise<{
    id: string;
    priceMinor: string;
    termMonths: 1 | 3;
    expiresAt: string;
    revision: number;
    replay: boolean;
  }>;
  acceptMain(
    input: ExpertCardEvent & { quoteId: string; revision: number },
  ): Promise<{
    acceptanceId: string;
    quoteId: string;
    revision: number;
    replay: boolean;
  }>;
  createMainInvoice(input: ExpertCardEvent & { revision: number }): Promise<{
    orderId: string;
    quoteId: string;
    revision: number;
    priceMinor: string;
    cashMinor: string;
    currency: "RUB";
    status: string;
    paymentDeadline: string;
    replay: boolean;
  }>;
}
export type ExpertCardReply =
  | {
      status: "handled";
      text: string;
      payment?: {
        status: "ready" | "waiting_configuration" | "pending" | "unavailable";
        orderId: string;
        url?: string;
        paymentId?: string;
      };
    }
  | {
      status:
        "unhandled" | "rejected" | "unavailable" | "disabled" | "duplicate";
      text?: never;
    };
const uuid =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const revision = "(0|[1-9][0-9]{0,5}|1000000)";
const quoteCommand = new RegExp(
  `^/main_tariff (${uuid}) (1|3) ${revision}$`,
  "u",
);
const acceptCommand = new RegExp(`^/main_accept (${uuid}) ${revision}$`, "u");
const invoiceCommand = new RegExp(`^/main_invoice ${revision}$`, "u");
const submitCommand = new RegExp(`^/card_submit ${revision}$`, "u");
const proofCommand = new RegExp(
  `^/promo_proof ${revision}(?: (\\S{1,2048}))?$`,
  "u",
);
const safeScope = (s: ExpertCardScope) =>
  /^[1-9][0-9]{0,19}$/u.test(s.botId) &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(s.botKey) &&
  /^[1-9][0-9]{0,19}$/u.test(s.telegramUserId) &&
  s.chatId === s.telegramUserId;
const validUpdate = (v: string) => /^(0|[1-9][0-9]{0,19})$/u.test(v);
const media = (reference: string) =>
  /^telegram:file:[A-Za-z0-9_-]{1,512}$/u.test(reference);
export function safeExpertCardProofLink(value: string): string | null {
  try {
    const u = new URL(value);
    const h = u.hostname.toLowerCase();
    return value.length <= 2048 &&
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      h.includes(".") &&
      !/^[0-9.]+$/u.test(h) &&
      !h.startsWith("[") &&
      !/(?:^|\.)(?:localhost|local|internal|invalid)$/u.test(h)
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}
export function createExpertCardService(deps: {
  enabled: boolean;
  paymentMode: "test" | "live";
  mainCheckout?: ExpertCardMainCheckout;
  workBotId: string;
  workBotKey: string;
  workBotUsername: string;
  promoScope?: { botId: string; botKey: string };
  repository: ExpertCardRepository;
  financial: ExpertCardFinancial;
}) {
  const reply = (text: string): ExpertCardReply => ({
    status: "handled",
    text,
  });
  const scope = (input: ExpertCardScope) => ({
    botId: input.botId,
    botKey: input.botKey,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
  });
  return {
    async handlePromoHandoff(
      input: ExpertCardScope & { updateId: number | string; text: string },
    ): Promise<ExpertCardReply> {
      if (!deps.enabled) return { status: "disabled" };
      if (input.text !== "/work_handoff") return { status: "unhandled" };
      const updateId = String(input.updateId),
        s = scope(input);
      if (
        (typeof input.updateId === "number" &&
          !Number.isSafeInteger(input.updateId)) ||
        !safeScope(s) ||
        !validUpdate(updateId) ||
        s.botId !== deps.promoScope?.botId ||
        s.botKey !== deps.promoScope.botKey
      )
        return { status: "rejected" };
      try {
        const result = await deps.repository.issueWorkHandoff({
          ...s,
          requestKey: `${s.botId}:${updateId}`,
          requestDigest: createHash("sha256")
            .update(JSON.stringify({ ...s, updateId, text: input.text }))
            .digest("hex"),
        });
        if (result.kind === "duplicate") return { status: "duplicate" };
        if (!/^[A-Za-z0-9_-]{43}$/u.test(result.token))
          return { status: "unavailable" };
        return reply(
          `Перейдите в рабочий бот до ${result.expiresAt}: https://t.me/${deps.workBotUsername}?start=card_${result.token}`,
        );
      } catch {
        return { status: "unavailable" };
      }
    },
    async handleWork(
      input: ExpertCardScope & {
        updateId: string;
        requestDigest: string;
        content: ExpertCardContent;
      },
    ): Promise<ExpertCardReply> {
      if (!deps.enabled) return { status: "disabled" };
      const s = scope(input),
        content = { ...input.content };
      if (
        !safeScope(s) ||
        s.botId !== deps.workBotId ||
        s.botKey !== deps.workBotKey ||
        !validUpdate(input.updateId) ||
        !/^[0-9a-f]{64}$/u.test(input.requestDigest)
      )
        return { status: "rejected" };
      if (
        content.kind === "text"
          ? typeof content.text !== "string" ||
            content.text.trim().length < 1 ||
            content.text.length > 4000 ||
            /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(
              content.text,
            )
          : !["photo", "document"].includes(content.kind) ||
            !media(content.reference)
      )
        return { status: "rejected" };
      if (
        content.caption !== undefined &&
        (typeof content.caption !== "string" || content.caption.length > 4000)
      )
        return { status: "rejected" };
      // Only the explicit proof caption is a media command. Other captions never
      // become quotes, invoices or handoff instructions.
      const caption = (content.caption ?? "").trim();
      const text =
        content.kind === "text"
          ? content.text.trim()
          : /^\/promo_proof(?:\s|$)/u.test(caption)
            ? caption
            : "";
      const event = {
        ...s,
        requestKey: `${s.botId}:${input.updateId}`,
        requestDigest: input.requestDigest,
      };
      try {
        const handoff = /^\/start card_([A-Za-z0-9_-]{43})$/u.exec(text);
        if (text.startsWith("/start card_") && !handoff)
          return { status: "rejected" };
        if (handoff) {
          const redeemed = await deps.repository.redeemWorkHandoff({
            ...event,
            token: handoff[1]!,
          });
          if (redeemed.kind === "duplicate") return { status: "duplicate" };
          return reply(
            "Рабочий бот подключён. Интервью: отправляйте текст, фото или документ. /card — состояние; /card_submit НОМЕР_РЕВИЗИИ — отправить на проверку. TODO: Wait for Content Spec",
          );
        }
        if (
          text.startsWith("/") &&
          !/^\/(?:card|card_submit|promo_proof|main_tariff|main_accept|main_invoice)(?:\s|$)/u.test(
            text,
          )
        )
          return { status: "unhandled" };
        const current = await deps.repository.getWorkflow(s);
        if (!current) return { status: "unhandled" };
        if (text === "/card")
          return reply(
            `Карточка: ${current.status}; ревизия ${current.revision}; записей ${current.entryCount}. Материалы: ${current.materialStatus}. ${current.materialStatus === "waiting_content" ? "TODO: Wait for Content Spec" : ""}`.trim(),
          );
        const submit = submitCommand.exec(text);
        if (submit) {
          const result = await deps.repository.submitDraft({
            ...event,
            expectedRevision: Number(submit[1]),
          });
          if (result.replay) return { status: "duplicate" };
          return reply(
            `Карточка ревизии ${result.revision} передана менеджеру.`,
          );
        }
        const proof = proofCommand.exec(text);
        if (proof) {
          let reference: string, kind: "link" | "photo" | "document";
          if (content.kind === "text") {
            const link = proof[2] && safeExpertCardProofLink(proof[2]);
            if (!link) return { status: "rejected" };
            reference = link;
            kind = "link";
          } else {
            if (proof[2]) return { status: "rejected" };
            reference = content.reference;
            kind = content.kind;
          }
          const result = await deps.repository.submitPromoProof({
            ...event,
            expectedRevision: Number(proof[1]),
            proof: { kind, reference },
          });
          if (result.replay) return { status: "duplicate" };
          return reply(
            "Подтверждение публикации сохранено для проверки менеджером.",
          );
        }
        const quote = quoteCommand.exec(text);
        if (quote) {
          if (Number(quote[3]) < 1) return { status: "rejected" };
          const result = await deps.financial.quoteMain({
            ...event,
            tariffVersionId: quote[1]!,
            termMonths: Number(quote[2]) as 1 | 3,
            revision: Number(quote[3]),
          });
          if (result.replay) return { status: "duplicate" };
          return reply(
            `Предложение ${result.id}: ${result.priceMinor} коп., ${result.termMonths} мес.; ревизия ${result.revision}; действует до ${result.expiresAt}. Принять: /main_accept ${result.id} ${result.revision}`,
          );
        }
        const accept = acceptCommand.exec(text);
        if (accept) {
          const result = await deps.financial.acceptMain({
            ...event,
            quoteId: accept[1]!,
            revision: Number(accept[2]),
          });
          if (result.replay) return { status: "duplicate" };
          return reply(
            `Предложение принято для ревизии ${result.revision}. Создать основной счёт: /main_invoice ${result.revision}`,
          );
        }
        const invoice = invoiceCommand.exec(text);
        if (invoice) {
          const result = await deps.financial.createMainInvoice({
            ...event,
            revision: Number(invoice[1]),
          });
          if (result.replay) return { status: "duplicate" };
          const pending = (
            status: "waiting_configuration" | "pending" | "unavailable",
          ): ExpertCardReply => ({
            status: "handled",
            text: `Основной счёт ${result.orderId}: ${result.cashMinor} коп.; статус ${result.status}; срок ${result.paymentDeadline}. ${status === "waiting_configuration" ? "Платёжное подключение пока не настроено." : "Платёжная ссылка пока недоступна; счёт сохранён."}`,
            payment: { status, orderId: result.orderId },
          });
          if (deps.mainCheckout?.strictFirstSendCancellation !== true)
            return pending("waiting_configuration");
          try {
            const frame = { ...event, revision: Number(invoice[1]) };
            const binding = Object.freeze({
              ...(await deps.financial.checkoutBindingForOwner(
                frame,
                result.orderId,
              )),
            });
            if (
              binding.orderId !== result.orderId ||
              binding.purpose !== "main_residency" ||
              binding.currency !== result.currency ||
              binding.amountMinor !== result.cashMinor ||
              binding.providerMode !== deps.paymentMode ||
              !new RegExp(`^${uuid}$`, "u").test(binding.userId) ||
              !new RegExp(`^${uuid}$`, "u").test(binding.expertId) ||
              !binding.idempotencyKey
            )
              return pending("unavailable");
            const outcome = await deps.mainCheckout.createOrRecover(binding);
            if (outcome.kind !== "ready")
              return pending(
                outcome.kind === "pending" ? "pending" : "unavailable",
              );
            const url = new URL(outcome.url);
            if (
              outcome.orderId !== result.orderId ||
              !/^[A-Za-z0-9_-]{1,64}$/u.test(outcome.paymentId) ||
              url.protocol !== "https:" ||
              url.username ||
              url.password ||
              url.port ||
              !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(
                url.hostname,
              )
            )
              return pending("unavailable");
            if (
              (await deps.financial.verifyMainCheckoutForOwner(
                frame,
                result.orderId,
                outcome.paymentId,
              )) !== true
            )
              return pending("unavailable");
            return {
              status: "handled",
              text: `Основной счёт ${result.orderId}: ${result.cashMinor} коп. Оплатить: ${url.toString()}`,
              payment: {
                status: "ready",
                orderId: result.orderId,
                url: url.toString(),
                paymentId: outcome.paymentId,
              },
            };
          } catch {
            return pending("unavailable");
          }
        }
        if (text.startsWith("/")) return { status: "rejected" };
        if (current.activeResident) return { status: "unhandled" };
        if (!["collecting", "changes_requested"].includes(current.status))
          return reply(
            `Карточка: ${current.status}; ревизия ${current.revision}. Изменения доступны после возврата менеджером.`,
          );
        const entry: ExpertCardEntry =
          content.kind === "text"
            ? { kind: "text", text: content.text }
            : { kind: content.kind, reference: content.reference };
        const result = await deps.repository.addEntry({
          ...event,
          expectedRevision: current.revision,
          entry,
        });
        if (result.replay) return { status: "duplicate" };
        return reply(
          `Ответ сохранён. Ревизия ${result.revision}. Отправить менеджеру: /card_submit ${result.revision}`,
        );
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}
export type ExpertCardService = ReturnType<typeof createExpertCardService>;
