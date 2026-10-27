import {
  richChecklist,
  proposeRichFields,
  richProfilePatchSchema,
  richServiceSchema,
} from "@ii-tonya/contracts";
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
export type ExpertCardContent = ExpertCardEntry & {
  caption?: string;
  size?: number;
  mimeType?: string;
};
export interface CardSafetyResult {
  safetyBlocked?: boolean;
  safetyIssues?: readonly {
    field: string;
    ruleId: string | null;
    severity: "BLOCKER" | "WARNING";
    reason: string;
  }[];
}
export interface ExpertCardWorkflow extends CardSafetyResult {
  returnReason?: string | null;
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
export interface DraftTagPage {
  revision: number;
  page: number;
  pages: number;
  tags: readonly {
    id: string;
    label: string;
    selected: boolean;
    active?: boolean;
  }[];
  tags_array: readonly string[];
}
export interface ExpertCardRepository {
  ingestRichPhoto?(
    input: ExpertCardEvent & {
      expectedRevision: number;
      reference: string;
      size: number;
      mimeType: "image/jpeg" | "image/png";
    },
  ): Promise<{ id: string; state: string }>;
  richAction?(
    input: ExpertCardEvent & {
      expectedRevision: number;
      action:
        | "patch"
        | "service"
        | "remove_service"
        | "remove_photo"
        | "propose"
        | "accept_proposal"
        | "preview"
        | "proposal_preview"
        | "confirm"
        | "start"
        | "geocode"
        | "manager"
        | "guided_answer"
        | "service_add";
      automaticRevision?: boolean;
      value?: unknown;
      page?: number;
      token?: string;
    },
  ): Promise<ExpertCardWorkflow & { replay: boolean; pageText?: string }>;

  changeDocumentProposal?(
    input: ExpertCardEvent & {
      expectedRevision: number;
      replacement: string | null;
    },
  ): Promise<ExpertCardWorkflow & { replay: boolean }>;
  readOwnAnswers?(
    scope: ExpertCardScope,
  ): Promise<{ revision: number; fields: Record<string, string> }>;
  correctEntry?(
    input: ExpertCardEvent & {
      expectedRevision: number;
      entryId: string;
      text: string;
    },
  ): Promise<ExpertCardWorkflow & { replay: boolean }>;
  completeDocumentImport?(
    input: ExpertCardEvent & {
      expectedRevision: number;
      proposal: { source: "pdf" | "docx"; content: string } | null;
    },
  ): Promise<boolean | "manual_fallback">;
  getDraftTags?(scope: ExpertCardScope, page?: number): Promise<DraftTagPage>;
  toggleDraftTag?(
    input: ExpertCardEvent & { expectedRevision: number; tagId: string },
  ): Promise<ExpertCardWorkflow & { replay: boolean }>;
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
      tagCallbackAuthorized?: true;
      inlineKeyboard?: readonly (readonly {
        text: string;
        callback_data: string;
      }[])[];
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
      tagCallbackAuthorized?: true;
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
const documentCommand = new RegExp(
  `^/card_document ${revision} (discard|replace)(?: ([\\s\\S]+))?$`,
  "u",
);
const correctCommand = new RegExp(
  `^/card_correct ${revision} (${uuid}) ([\\s\\S]+)$`,
  "u",
);
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
  draftTagsEnabled?: boolean;
  documentImport?: {
    read(
      input: ExpertCardScope & {
        reference: string;
        signal: AbortSignal;
        size?: number;
        mimeType?: string;
      },
    ): Promise<{ bytes: Uint8Array; type: "pdf" | "docx" } | null>;
    parser: {
      parse(input: {
        bytes: Uint8Array;
        type: "pdf" | "docx";
        signal: AbortSignal;
      }): Promise<{ source: "pdf" | "docx"; content: string } | null>;
    };
  };
  personalOffers?: {
    read(scope: ExpertCardScope): Promise<{ text: string } | null>;
  };
}) {
  const reply = (text: string): ExpertCardReply => ({
    status: "handled",
    text,
  });
  const safetyReply = (
    result: CardSafetyResult,
  ): ExpertCardReply | undefined =>
    result.safetyBlocked
      ? reply(
          `Не удалось сохранить: ${
            result.safetyIssues
              ?.slice(0, 3)
              .map((i) => `${i.field}: ${i.reason.slice(0, 500)}`)
              .join(" ") ?? "Проверка содержимого недоступна."
          } Исправьте текст. /card_answers — ответы и команда исправления.`,
        )
      : undefined;
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
      if (
        input.text !== "/work_handoff" &&
        input.text !== "/materials" &&
        !proofCommand.test(input.text)
      )
        return { status: "unhandled" };
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
        if (input.text === "/materials") {
          const current = await deps.repository.getWorkflow(s);
          if (!current) return { status: "unavailable" };
          return reply(
            current.materialStatus === "waiting_content"
              ? "AWAITING_MATERIALS. Ваши материалы для рассылки будут доступны в ближайшее время"
              : `Материалы: ${current.materialStatus}`,
          );
        }
        const proof = proofCommand.exec(input.text);
        if (proof) {
          const reference = proof[2] && safeExpertCardProofLink(proof[2]);
          if (!reference) return { status: "rejected" };
          const result = await deps.repository.submitPromoProof({
            ...s,
            requestKey: `${s.botId}:${updateId}`,
            requestDigest: createHash("sha256")
              .update(JSON.stringify({ ...s, updateId, text: input.text }))
              .digest("hex"),
            expectedRevision: Number(proof[1]),
            proof: { kind: "link", reference },
          });
          return result.replay
            ? { status: "duplicate" }
            : reply(
                "Подтверждение публикации сохранено для проверки менеджером.",
              );
        }
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
        callbackData?: string;
        callbackQueryId?: string;
        signal?: AbortSignal;
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
        if (input.callbackData !== undefined || text === "/tags") {
          if (
            !deps.draftTagsEnabled ||
            !deps.repository.getDraftTags ||
            !deps.repository.toggleDraftTag
          )
            return reply("Выбор тегов пока недоступен.");
          let page = 0;
          if (input.callbackData !== undefined) {
            const callback =
              /^ct1:(p|t):(0|[1-9][0-9]{0,5}):([0-9]{1,3})(?::([0-9a-f-]{36}))?$/u.exec(
                input.callbackData,
              );
            if (!callback) return { status: "rejected" };
            page = Number(callback[3]);
            if (callback[1] === "t") {
              if (!callback[4]) return { status: "rejected" };
              const result = await deps.repository.toggleDraftTag({
                ...event,
                expectedRevision: Number(callback[2]),
                tagId: callback[4],
              });
              const blocked = safetyReply(result);
              if (blocked) return { ...blocked, tagCallbackAuthorized: true };
              if (result.replay)
                return { status: "duplicate", tagCallbackAuthorized: true };
            } else {
              if (callback[4]) return { status: "rejected" };
              const before = await deps.repository.getDraftTags(s, page);
              if (before.revision !== Number(callback[2]))
                return {
                  status: "handled",
                  text: "Список изменился. Откройте /tags заново.",
                  tagCallbackAuthorized: true,
                };
            }
          }
          const result = await deps.repository.getDraftTags(s, page);
          page = result.page;
          const buttons = result.tags.map((tag) => [
            {
              text: `${tag.selected ? "✓ " : ""}${tag.label}${tag.active === false ? " [неактивен — удалить]" : ""}`,
              callback_data: `ct1:t:${result.revision}:${page}:${tag.id}`,
            },
          ]);
          const navigation = [];
          if (page > 0)
            navigation.push({
              text: "←",
              callback_data: `ct1:p:${result.revision}:${page - 1}`,
            });
          if (page + 1 < result.pages)
            navigation.push({
              text: "→",
              callback_data: `ct1:p:${result.revision}:${page + 1}`,
            });
          if (navigation.length) buttons.push(navigation);
          return {
            status: "handled",
            text: `Теги: ${result.tags_array.length}/20. Страница ${page + 1}/${result.pages}. ${result.tags_array.join(", ")} Теги не подтверждают квалификацию.`,
            inlineKeyboard: buttons,
            ...(input.callbackData !== undefined
              ? { tagCallbackAuthorized: true as const }
              : {}),
          };
        }
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
            "Рабочий бот подключён. Мой актуальный тариф: /my_tariff. Интервью: /card_mode — начать; /card_checklist — мастер-чек-лист. Отправляйте текст, фото или документ. /card — состояние; /card_answers — ответы и исправления; /card_submit НОМЕР_РЕВИЗИИ — отправить на проверку.",
          );
        }
        if (
          text.startsWith("/") &&
          !/^\/(?:card|card_mode|card_service_add|card_photo_remove|card_manager|card_checklist|card_geocode|card_answer|card_set|card_service|card_remove|card_import|card_accept|card_preview|card_proposal|card_confirm|card_answers|card_correct|card_document|card_submit|promo_proof|main_tariff|main_accept|main_invoice|my_tariff|tags)(?:\s|$)/u.test(
            text,
          )
        )
          return { status: "unhandled" };
        if (text === "/my_tariff" || text === "Мой актуальный тариф") {
          const offer = await deps.personalOffers?.read(s);
          return offer ? reply(offer.text) : { status: "unavailable" };
        }
        const current = await deps.repository.getWorkflow(s);
        if (!current) return { status: "unhandled" };
        if (text === "/card_checklist") return reply(richChecklist());
        const removePhoto =
          /^\/card_photo_remove (0|[1-9][0-9]{0,5}) ([1-9]|10)$/u.exec(text);
        if (removePhoto && deps.repository.richAction) {
          const r = await deps.repository.richAction({
            ...event,
            expectedRevision: Number(removePhoto[1]),
            action: "remove_photo",
            value: Number(removePhoto[2]),
          });
          return r.replay
            ? { status: "duplicate" }
            : reply(
                r.pageText ??
                  "Фото убрано из черновика. Пришлите новое фото для замены.",
              );
        }
        if (text === "/card_mode" && deps.repository.richAction) {
          const r = await deps.repository.richAction({
            ...event,
            expectedRevision: current.revision,
            automaticRevision: true,
            action: "start",
          });
          return r.replay
            ? { status: "duplicate" }
            : reply(r.pageText ?? "Начнём с имени: /card_answer ваше имя");
        }
        if (text === "/card_manager" && deps.repository.richAction) {
          const r = await deps.repository.richAction({
            ...event,
            expectedRevision: current.revision,
            automaticRevision: true,
            action: "manager",
          });
          return r.replay
            ? { status: "duplicate" }
            : reply(r.pageText ?? "Запрос сохранён.");
        }
        if (text === "/card_geocode" && deps.repository.richAction) {
          const r = await deps.repository.richAction({
            ...event,
            expectedRevision: current.revision,
            automaticRevision: true,
            action: "geocode",
          });
          return r.replay
            ? { status: "duplicate" }
            : reply(r.pageText ?? "Карта пока недоступна.");
        }
        const answer =
          /^\/card_answer (0|[1-9][0-9]{0,5}) ([A-Za-z]+) ([\s\S]+)$/u.exec(
            text,
          );
        if (answer && deps.repository.richAction) {
          let value: unknown = answer[3];
          if (["socialLinks", "photos", "services"].includes(answer[2]!)) {
            try {
              value = JSON.parse(answer[3]!);
            } catch {
              return reply(
                "Для списка нужен JSON-массив. /card_checklist — пример.",
              );
            }
          }
          if (value === "null") value = null;
          const patch = richProfilePatchSchema.safeParse({
            [answer[2]!]: value,
          });
          if (!patch.success)
            return reply(
              "Проверьте " +
                answer[2] +
                ": " +
                patch.error.issues.map((i) => i.message).join("; "),
            );
          const r = await deps.repository.richAction({
            ...event,
            expectedRevision: Number(answer[1]),
            action: "patch",
            value: patch.data,
          });
          return (
            safetyReply(r) ??
            (r.replay
              ? { status: "duplicate" }
              : reply(r.pageText ?? "Сохранено."))
          );
        }
        if (text.startsWith("/card_answer ") && deps.repository.richAction) {
          const r = await deps.repository.richAction({
            ...event,
            expectedRevision: current.revision,
            automaticRevision: true,
            action: "guided_answer",
            value: text.slice(13).trim(),
          });
          return (
            safetyReply(r) ??
            (r.replay
              ? { status: "duplicate" }
              : reply(r.pageText ?? "Сохранено."))
          );
        }
        if (text === "/card_service_add" && deps.repository.richAction) {
          const r = await deps.repository.richAction({
            ...event,
            expectedRevision: current.revision,
            automaticRevision: true,
            action: "service_add",
          });
          return r.replay
            ? { status: "duplicate" }
            : reply(r.pageText ?? "Введите название услуги.");
        }
        if (text === "/card_preview" && deps.repository.richAction) {
          const r = await deps.repository.richAction({
            ...event,
            expectedRevision: current.revision,
            automaticRevision: true,
            action: "preview",
          });
          return r.replay
            ? { status: "duplicate" }
            : reply(r.pageText ?? "Откройте карточку.");
        }
        const rich =
          /^\/(card_set|card_service|card_remove|card_import|card_accept|card_preview|card_proposal|card_confirm) (0|[1-9][0-9]{0,5})(?: ([\s\S]+))?$/u.exec(
            text,
          );
        if (rich && deps.repository.richAction) {
          const revision = Number(rich[2]);
          const command = rich[1]!;
          const tail = rich[3] ?? "";
          let action:
            | "patch"
            | "service"
            | "remove_service"
            | "remove_photo"
            | "propose"
            | "accept_proposal"
            | "preview"
            | "proposal_preview"
            | "confirm";
          let value: unknown;
          let page: number | undefined;
          let token: string | undefined;
          if (command === "card_set" || command === "card_service") {
            let parsed: unknown;
            try {
              parsed = JSON.parse(tail);
            } catch {
              return reply(
                "Нужен JSON. Пример: /card_set " +
                  revision +
                  ' {"fullName":"Анна"}. Шаблон: /card_checklist',
              );
            }
            const checked = (
              command === "card_set"
                ? richProfilePatchSchema
                : richServiceSchema
            ).safeParse(parsed);
            if (!checked.success)
              return reply(
                "Исправьте поля: " +
                  checked.error.issues
                    .map((i) => i.path.join(".") + ": " + i.message)
                    .join("; ")
                    .slice(0, 3000),
              );
            value = checked.data;
            action = command === "card_set" ? "patch" : "service";
          } else if (command === "card_import") {
            value = proposeRichFields(tail, (i) => {
              const h = createHash("sha256")
                .update(event.requestDigest + ":" + i)
                .digest("hex");
              return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
            });
            action = "propose";
          } else if (command === "card_remove") {
            value = tail;
            action = "remove_service";
          } else if (command === "card_accept" || command === "card_confirm") {
            token = tail;
            action = command === "card_accept" ? "accept_proposal" : "confirm";
          } else {
            const m = /^(?:(0|[1-9][0-9]?)(?: ([0-9a-f-]{36}))?)?$/u.exec(tail);
            if (!m) return { status: "rejected" };
            page = Number(m[1] ?? 0);
            token = m[2];
            action =
              command === "card_proposal" ? "proposal_preview" : "preview";
          }
          const r = await deps.repository.richAction({
            ...event,
            expectedRevision: revision,
            action,
            ...(value === undefined ? {} : { value }),
            ...(page === undefined ? {} : { page }),
            ...(token === undefined ? {} : { token }),
          });
          return (
            safetyReply(r) ??
            (r.replay
              ? { status: "duplicate" }
              : reply(r.pageText ?? "Сохранено."))
          );
        }
        const answerPage = /^\/card_answers(?: (0|[1-9][0-9]?))?$/u.exec(text);
        if (answerPage && deps.repository.readOwnAnswers) {
          const answers = await deps.repository.readOwnAnswers(s);
          const lines = Object.entries(answers.fields).filter(([key]) =>
            key.startsWith("entry:"),
          );
          const pages = Math.max(1, Math.ceil(lines.length / 8));
          const page = Math.min(Number(answerPage[1] ?? 0), pages - 1);
          return reply(
            `Ревизия ${answers.revision}. Страница ${page + 1}/${pages}. Исправление: /card_correct ${answers.revision} ID новый текст. Предложение из файла: /card_document ${answers.revision} discard — удалить; /card_document ${answers.revision} replace новый текст — заменить (от 50 символов).\n${lines
              .slice(page * 8, page * 8 + 8)
              .map(([key, value]) => `${key.slice(6)}: ${value.slice(0, 80)}`)
              .join(
                "\n",
              )}\n${page + 1 < pages ? `/card_answers ${page + 1} — следующие ответы` : ""}`,
          );
        }
        const documentChange = documentCommand.exec(text);
        if (documentChange && deps.repository.changeDocumentProposal) {
          if (
            (documentChange[2] === "discard" &&
              documentChange[3] !== undefined) ||
            (documentChange[2] === "replace" && !documentChange[3])
          )
            return { status: "rejected" };
          const result = await deps.repository.changeDocumentProposal({
            ...event,
            expectedRevision: Number(documentChange[1]),
            replacement:
              documentChange[2] === "discard" ? null : documentChange[3]!,
          });
          return (
            safetyReply(result) ??
            (result.replay
              ? { status: "duplicate" }
              : reply(
                  `Предложение из файла ${documentChange[2] === "discard" ? "удалено" : "заменено"}. Исходные файлы и история сохранены. Ревизия ${result.revision}.`,
                ))
          );
        }
        const correction = correctCommand.exec(text);
        if (correction && deps.repository.correctEntry) {
          const result = await deps.repository.correctEntry({
            ...event,
            expectedRevision: Number(correction[1]),
            entryId: correction[2]!,
            text: correction[3]!,
          });
          return (
            safetyReply(result) ??
            (result.replay
              ? { status: "duplicate" }
              : reply(
                  `Ответ исправлен. История сохранена. Ревизия ${result.revision}.`,
                ))
          );
        }
        if (text === "/card")
          return reply(
            `Карточка: ${{ collecting: "заполняется", manager_review: "на проверке у менеджера", changes_requested: "нужны уточнения", approved: "утверждена" }[current.status]}; ревизия ${current.revision}; записей ${current.entryCount}. Материалы: ${current.materialStatus}. Мой актуальный тариф: /my_tariff. ${current.status === "changes_requested" && current.returnReason ? "Причина возврата: " + current.returnReason + ". Продолжить: /card_mode. " : ""}${current.materialStatus === "waiting_content" ? "AWAITING_MATERIALS. Ваши материалы для рассылки будут доступны в ближайшее время" : ""}`.trim(),
          );
        const submit = submitCommand.exec(text);
        if (submit) {
          const result = await deps.repository.submitDraft({
            ...event,
            expectedRevision: Number(submit[1]),
          });
          const blocked = safetyReply(result);
          if (blocked) return blocked;
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
        if (current.activeResident && current.status === "approved")
          return { status: "unhandled" };
        if (!["collecting", "changes_requested"].includes(current.status))
          return reply(
            `Карточка: ${{ collecting: "заполняется", manager_review: "на проверке у менеджера", changes_requested: "нужны уточнения", approved: "утверждена" }[current.status]}; ревизия ${current.revision}. Изменения доступны после возврата менеджером.`,
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
        const blocked = safetyReply(result);
        if (blocked) return blocked;
        if (result.replay) return { status: "duplicate" };
        if (content.kind === "photo" && deps.repository.ingestRichPhoto) {
          if (content.size === undefined)
            return reply(
              "Фото сохранено как исходный ответ. Размер не подтверждён; пришлите оригинал фото ещё раз.",
            );
          const media = await deps.repository.ingestRichPhoto({
            ...event,
            expectedRevision: result.revision,
            reference: content.reference,
            size: content.size,
            mimeType:
              content.mimeType === "image/png" ? "image/png" : "image/jpeg",
          });
          return reply(
            media.state === "legacy"
              ? "Фото сохранено как исходный ответ к карточке. Для нового формата заполнения: /card_mode."
              : media.state === "verified"
                ? `Фото сохранено в закрытом хранилище: ${media.id}. Оно не опубликовано. Откройте /card для актуальной ревизии.`
                : "Исходное фото сохранено. Закрытое хранилище пока недоступно; фото ещё не принято в карточку.",
          );
        }
        if (content.kind === "document") {
          let proposal: { source: "pdf" | "docx"; content: string } | null =
            null;
          if (deps.documentImport) {
            const signal = input.signal
              ? AbortSignal.any([input.signal, AbortSignal.timeout(10000)])
              : AbortSignal.timeout(10000);
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              const work = (async () => {
                const document = await deps.documentImport!.read({
                  ...s,
                  reference: content.reference,
                  ...(content.size === undefined ? {} : { size: content.size }),
                  ...(content.mimeType === undefined
                    ? {}
                    : { mimeType: content.mimeType }),
                  signal,
                });
                if (
                  !document ||
                  !(document.bytes instanceof Uint8Array) ||
                  document.bytes.byteLength > 5 * 1024 * 1024 ||
                  !["pdf", "docx"].includes(document.type) ||
                  signal.aborted
                )
                  return null;
                return deps.documentImport!.parser.parse({
                  ...document,
                  signal,
                });
              })();
              proposal = await Promise.race([
                work,
                new Promise<null>((resolve) => {
                  timer = setTimeout(() => resolve(null), 10000);
                }),
              ]);
            } catch {
              proposal = null;
            } finally {
              if (timer) clearTimeout(timer);
            }
          }
          const saved = await deps.repository.completeDocumentImport?.({
            ...event,
            expectedRevision: result.revision,
            proposal,
          });
          if (saved === false)
            return reply(
              "Исходный файл сохранён. Карточка уже изменилась; продолжайте текущее интервью.",
            );
          return reply(
            proposal && saved === true
              ? `Файл сохранён. Извлечённые поля — предложение. Полный просмотр и подтверждение: /card_proposal ${result.revision}`
              : "Не удалось прочитать файл автоматически. Давайте пройдемся по вопросам вручную.",
          );
        }
        return reply(
          `Ответ сохранён. Ревизия ${result.revision}. Извлечённые предложения: /card_proposal ${result.revision}. Пошагово: /card_mode; ответ: /card_answer ваш ответ. Шаблон: /card_checklist.`,
        );
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("card_fields:"))
          return reply("Заполните поля: " + error.message.slice(12));
        if (
          error instanceof Error &&
          error.message === "card_preview_incomplete"
        )
          return reply(
            "Сначала откройте все страницы текущей версии через /card_preview РЕВИЗИЯ и подтвердите её.",
          );
        if (input.callbackData !== undefined || text === "/tags") {
          let authorized = false;
          const code =
            error && typeof error === "object" && "code" in error
              ? error.code
              : null;
          if (
            input.callbackData !== undefined &&
            ![
              "card_idempotency_conflict",
              "card_forbidden",
              "card_invalid_event",
            ].includes(String(code))
          )
            try {
              await deps.repository.getDraftTags?.(s, 0);
              authorized = !!deps.repository.getDraftTags;
            } catch {
              /* A foreign owner never acquires callback acknowledgement authority. */
            }
          return {
            status: "handled",
            text: "Не удалось изменить теги. Проверьте лимит 20 и откройте /tags заново.",
            ...(authorized ? { tagCallbackAuthorized: true as const } : {}),
          };
        }
        return { status: "unavailable" };
      }
    },
  };
}
export type ExpertCardService = ReturnType<typeof createExpertCardService>;
