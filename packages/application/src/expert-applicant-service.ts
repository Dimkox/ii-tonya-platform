import type { ResidentDocument } from "@ii-tonya/domain";
import type { ResidentFormInput } from "./resident-verification-service.js";
import {
  renderPersonalOffer,
  type PersonalOfferView,
} from "./expert-personal-offer-service.js";
import {
  matchExpertPromoFaq,
  type ExpertPromoFaqEntry,
} from "./expert-promo-faq.js";
import { createHash } from "node:crypto";
import {
  renderWaitlistInvite,
  waitlistDisplayRefCode,
  waitlistV4Text,
  type WaitlistV4Config,
  type WaitlistInviteVariant,
} from "./waitlist-funnel-v4.js";

export type ExpertApplicantScope = {
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
};
type Command = ExpertApplicantScope & {
  requestKey: string;
  requestDigest: string;
};
export interface ExpertApplicantRepository {
  isActiveResident?(scope: ExpertApplicantScope): Promise<boolean>;
  optOutReferral?(scope: ExpertApplicantScope): Promise<boolean>;
  saveFunnelProfile?(
    scope: ExpertApplicantScope,
    profile: { firstName?: string; gender?: "female" | "male" },
  ): Promise<boolean>;
  recordManagerQuestion?(
    scope: ExpertApplicantScope,
    question: string,
  ): Promise<boolean>;
  isVerificationPending?(scope: ExpertApplicantScope): Promise<boolean>;
  saveProfile?(
    input: Command & {
      cityCode: string;
      millionCity: boolean;
      serviceFormat: "online_only" | "offline" | "hybrid";
      ticketMinor: string;
      participantKind: "expert" | "space";
    },
  ): Promise<{ revision: number; replay: boolean }>;
  beginEnrollment(input: Command & { refCode?: string }): Promise<
    | { kind: "ready" | "waiting_content" | "consent_pending" }
    | {
        kind: "consent_required";
        token: string;
        policyVersion: string;
        document: {
          id: string;
          documentKey: string;
          version: number;
          textSha256: string;
          title: string;
          body: string;
        };
      }
  >;
  completeEnrollment(
    input: Command & { token: string; decision: "granted" | "denied" },
  ): Promise<{ kind: "granted" | "denied"; replay: boolean }>;
  resolve(scope: ExpertApplicantScope): Promise<{ userId: string } | null>;
  register(input: Command & { refCode?: string }): Promise<{
    userId: string;
    refCode: string;
    referralCount: number;
    bonusPoints: 0 | 100;
    bonusStatus: "none" | "frozen" | "superseded";
    guideStatus:
      "none" | "waiting_content" | "pending" | "delivered" | "cancelled";
    replay: boolean;
  }>;
  listTariffs(input: Command): Promise<{
    tariffs: { id: string; displayName: string }[];
    replay: boolean;
  }>;
  createQuote(
    input: Command & { tariffVersionId: string; termMonths: 1 | 3 },
  ): Promise<{
    id: string;
    priceMinor: string;
    termMonths: 1 | 3;
    expiresAt: string;
    replay?: boolean;
  }>;
  createApplication(input: Command & { quoteId: string }): Promise<{
    applicationId: string;
    userId: string;
    quoteId: string;
    status: "pending";
    replay: boolean;
  }>;
}
export type ExpertApplicantReply =
  | {
      status: "handled";
      text: string;
      replyMarkup?:
        | {
            inline_keyboard: {
              text: string;
              callback_data?: string;
              url?: string;
              copy_text?: { text: string };
            }[][];
          }
        | { remove_keyboard: true };
    }
  | {
      status:
        "disabled" | "unavailable" | "rejected" | "unhandled" | "duplicate";
      text?: never;
    };
const pendingVerification = (): ExpertApplicantReply => ({
  status: "handled",
  text: "Ваша анкета ожидает проверки. Тарифы пока недоступны; сохранённые ответы остаются на месте.",
  replyMarkup: { remove_keyboard: true },
});
const activeResidentText = (url: string | undefined) =>
  url && /^https:\/\/t\.me\/[A-Za-z0-9_]{5,64}$/u.test(url)
    ? `Вы уже активный резидент ии-Тони. Работайте в боте эксперта: ${url}`
    : "Вы уже активный резидент ии-Тони. Работайте в боте эксперта.";
const uuid =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const tariff = new RegExp(`^/tariff (${uuid}) (1|3)$`, "u");
const apply = new RegExp(`^/apply (${uuid})$`, "u");

export function createExpertApplicantService(deps: {
  enabled: boolean;
  separatedSales?: {
    handle(input: ResidentFormInput): Promise<ExpertApplicantReply | null>;
  };
  verificationForm?: {
    handle(input: ResidentFormInput): Promise<ExpertApplicantReply | null>;
  };
  repository: ExpertApplicantRepository;
  /** BOT-02.2 redirect target for an active resident; https URL of the expert bot. */
  activeResidentBotUrl?: string;
  /** WAIT-T05: free text → FAQ answer, else manager handoff. */
  faq?: readonly ExpertPromoFaqEntry[] | true;
  waitlistV4?: WaitlistV4Config;
  personalOffers?: {
    readPromoIdentity(
      scope: ExpertApplicantScope,
    ): Promise<PersonalOfferView | null>;
  };
}) {
  return {
    async handle(
      input: ExpertApplicantScope & {
        updateId: number;
        text: string;
        callbackData?: string;
        firstName?: string;
        media?: ResidentDocument;
      },
    ): Promise<ExpertApplicantReply> {
      if (!deps.enabled) return { status: "disabled" };
      if (
        !/^[1-9]\d{0,15}$/u.test(input.botId) ||
        !Number.isSafeInteger(Number(input.botId)) ||
        !Number.isSafeInteger(input.updateId) ||
        input.updateId < 0 ||
        !/^[1-9]\d{0,19}$/u.test(input.telegramUserId) ||
        input.chatId !== input.telegramUserId ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.botKey) ||
        typeof input.text !== "string" ||
        input.text.length > (deps.verificationForm ? 3000 : 256) ||
        (input.firstName !== undefined &&
          (typeof input.firstName !== "string" ||
            input.firstName.length < 1 ||
            input.firstName.length > 64 ||
            /[\p{Cc}\p{Cf}]/u.test(input.firstName)))
      )
        return { status: "rejected" };
      const { botId, botKey, telegramUserId, chatId, updateId } = input;
      const scope = { botId, botKey, telegramUserId, chatId };
      const digest = createHash("sha256").update(input.text).digest("hex");
      const command = () => ({
        ...scope,
        requestKey: `${botId}:${updateId}`,
        requestDigest: digest,
      });
      try {
        // Pre-launch v4 is an explicit configuration: legacy sales composition is
        // unchanged until the release owner switches this funnel on.
        if (deps.waitlistV4) {
          const channelUrl = deps.waitlistV4.channelUrl;
          const consentCallback = /^wl:consent:([A-Za-z0-9_-]{16,128})$/u.exec(
            input.text,
          );
          if (consentCallback)
            input = {
              ...input,
              text: `/consent ${consentCallback[1]} granted`,
            };
          else if (input.text === "wl:first")
            input = { ...input, text: "/start" };
          else if (input.text === "wl:code")
            return {
              status: "handled",
              text: "Отправьте промокод коллеги одним сообщением.",
            };
          else if (input.text === "wl:wait" || input.text === "wl:optout")
            return {
              status: "handled",
              text:
                input.text === "wl:optout" && deps.repository.optOutReferral
                  ? (await deps.repository.optOutReferral(scope))
                    ? "Принято. Тогда просто ждите нашего общего анонса о старте демо-доступа. Хорошего дня! ☕️"
                    : waitlistV4Text.wait
                  : waitlistV4Text.wait,
            };
          const choice = /^wl:template:(1|2)$/u.exec(input.text);
          const wantsMaterials =
            Boolean(choice) ||
            input.text === "wl:materials" ||
            input.text.trim().toLocaleUpperCase("ru-RU") === "ПРОМОКОД";
          if (wantsMaterials) {
            const registration = await deps.repository.register(command());
            if (!choice) {
              return {
                status: "handled",
                text: waitlistV4Text.templateChoice,
                replyMarkup: {
                  inline_keyboard: [
                    [
                      {
                        text: "Вариант 1 — Информативный",
                        callback_data: "wl:template:1",
                      },
                    ],
                    [
                      {
                        text: "Вариант 2 — Личный/Теплый",
                        callback_data: "wl:template:2",
                      },
                    ],
                  ],
                },
              };
            }
            const displayCode = waitlistDisplayRefCode(
              registration.userId,
              registration.refCode,
            );
            return {
              status: "handled",
              text: `Вот ваш персональный промокод: ${displayCode}\n\n${renderWaitlistInvite(Number(choice[1]) as WaitlistInviteVariant, displayCode, channelUrl)}\n\n${waitlistV4Text.materialsFooter}`,
            };
          }
        }
        if (
          deps.separatedSales &&
          !/^(?:\/(?:start|consent)(?: |$)|\/optout_ref$|\/gender (?:female|male)$|promo_[0-9a-f]{32}$)/u.test(
            input.text.trim(),
          )
        ) {
          const sales = await deps.separatedSales.handle(input);
          if (sales) return sales;
        }
        if (
          deps.verificationForm &&
          !(deps.separatedSales && input.text.startsWith("/profile")) &&
          !/^(?:\/(?:start|consent)(?: |$)|\/optout_ref$|\/gender (?:female|male)$|promo_[0-9a-f]{32}$)/u.test(
            input.text.trim(),
          )
        ) {
          const form = await deps.verificationForm.handle(input);
          if (form) return form;
        }
        if (
          input.text === "Мой актуальный тариф" ||
          input.text === "/my_tariff"
        ) {
          const offer = await deps.personalOffers?.readPromoIdentity(scope);
          if (!offer && (await deps.repository.isVerificationPending?.(scope)))
            return pendingVerification();
          return offer
            ? { status: "handled", text: renderPersonalOffer(offer) }
            : { status: "unavailable" };
        }
        const profile =
          /^\/profile ([a-zA-Z0-9_-]{1,100}) (0|1) (online_only|offline|hybrid) ([0-9]{1,18}) (expert|space)$/u.exec(
            input.text,
          );
        if (profile) {
          if (!deps.repository.saveProfile) return { status: "unavailable" };
          const result = await deps.repository.saveProfile({
            ...command(),
            cityCode: profile[1]!,
            millionCity: profile[2] === "1",
            serviceFormat: profile[3] as "online_only" | "offline" | "hybrid",
            ticketMinor: profile[4]!,
            participantKind: profile[5] as "expert" | "space",
          });
          return result.replay
            ? { status: "duplicate" }
            : {
                status: "handled",
                text: `Квалификация ревизии ${result.revision} сохранена для проверки менеджером.`,
              };
        }
        if (input.text.startsWith("/profile")) return { status: "rejected" };
        const gender = /^\/gender (female|male)$/u.exec(input.text.trim());
        if (gender && deps.repository.saveFunnelProfile)
          return {
            status: "handled",
            text: (await deps.repository.saveFunnelProfile(scope, {
              gender: gender[1] as "female" | "male",
            }))
              ? "Спасибо, данные профиля сохранены."
              : "Сначала зарегистрируйтесь: отправьте /start.",
          };
        if (
          input.text.trim() === "/optout_ref" &&
          deps.repository.optOutReferral
        )
          return {
            status: "handled",
            text: (await deps.repository.optOutReferral(scope))
              ? "Готово: напоминания о реферальной программе отключены."
              : "Сначала зарегистрируйтесь: отправьте /start.",
          };
        // WAIT-002: after consent a typed inviter code converges with /start promo_….
        const typedCode =
          /^(promo_[0-9a-f]{32}|REF_[A-Za-z0-9_-]{4,48})$/u.exec(
            input.text.trim(),
          );
        const start =
          /^\/start(?: ((?:promo|REF)_[A-Za-z0-9_-]{8,48}))?$/u.exec(
            input.text,
          ) ?? (typedCode ? [input.text, typedCode[1]] : null);
        if (start) {
          if (await deps.repository.isActiveResident?.(scope))
            return {
              status: "handled",
              text: activeResidentText(deps.activeResidentBotUrl),
            };
          const enrollment = await deps.repository.beginEnrollment({
            ...command(),
            ...(start[1] ? { refCode: start[1] } : {}),
          });
          if (input.firstName)
            await deps.repository.saveFunnelProfile?.(scope, {
              firstName: input.firstName,
            });
          if (enrollment.kind === "waiting_content")
            return {
              status: "handled",
              text: deps.waitlistV4
                ? waitlistV4Text.referralOffer
                : "Текст согласия ещё не опубликован. Регистрация не начата; менеджер уже может подготовить документ.",
            };
          if (enrollment.kind === "consent_pending")
            return { status: "duplicate" };
          if (enrollment.kind === "consent_required") {
            const text = `${enrollment.document.title}\n${enrollment.document.body}\nСогласиться: /consent ${enrollment.token} granted\nОтказаться: /consent ${enrollment.token} denied`;
            if (deps.waitlistV4)
              return {
                status: "handled",
                text: `${waitlistV4Text.welcome(deps.waitlistV4.channelUrl, deps.waitlistV4.privacyUrl)}\n\n${enrollment.document.title}\n${enrollment.document.body}`,
                replyMarkup: {
                  inline_keyboard: [
                    [
                      {
                        text: "Согласен(на), поехали",
                        callback_data: `wl:consent:${enrollment.token}`,
                      },
                    ],
                    [
                      {
                        text: "📢 Читать новости проекта",
                        url: deps.waitlistV4.channelUrl,
                      },
                    ],
                  ],
                },
              };
            // Preserve the complete approved notice. Never truncate legal text.
            if (text.length > 4096)
              return {
                status: "handled",
                text: "Текст согласия не помещается в одно сообщение Telegram. Регистрация не начата; отправьте /start после публикации сокращённой версии документа.",
              };
            return { status: "handled", text };
          }
          const result = await deps.repository.register({
            ...command(),
            ...(start[1] ? { refCode: start[1] } : {}),
          });
          const guide =
            result.guideStatus === "waiting_content"
              ? "TODO: Wait for PDF"
              : result.guideStatus === "delivered"
                ? "Доставка гайда подтверждена."
                : "";
          const bonus =
            result.bonusStatus === "frozen"
              ? "Предварительные 100 бонусов заморожены и входят в квалифицированное вознаграждение; доступного баланса пока нет."
              : "";
          const registrationText =
            `Ваш промокод: ${result.refCode}. Уникальных регистраций: ${result.referralCount}. ${guide} ${bonus}`.trim();
          if (deps.waitlistV4)
            return {
              status: "handled",
              text: `${start[1] ? waitlistV4Text.accepted : waitlistV4Text.pioneer}\n\n${waitlistV4Text.referralOffer}`,
              replyMarkup: {
                inline_keyboard: [
                  [
                    {
                      text: "Да, дай мне промокод и текст",
                      callback_data: "wl:materials",
                    },
                  ],
                  [
                    {
                      text: "Пока нет, хочу подождать старта",
                      callback_data: "wl:wait",
                    },
                  ],
                ],
              },
            };
          if (deps.separatedSales) {
            const sales = await deps.separatedSales.handle(input);
            if (sales) return sales;
          }
          if (deps.verificationForm) {
            const form = await deps.verificationForm.handle(input);
            if (form)
              return form.status === "handled"
                ? { ...form, text: `${registrationText}\n\n${form.text}` }
                : form;
          }
          if (await deps.repository.isVerificationPending?.(scope)) {
            const pending = pendingVerification();
            return pending.status === "handled"
              ? { ...pending, text: `${registrationText}\n\n${pending.text}` }
              : pending;
          }
          if (result.replay) return { status: "duplicate" };
          return {
            status: "handled",
            text: `Ваш промокод: ${result.refCode}. Уникальных регистраций: ${result.referralCount}. Тарифы: /tariffs. ${guide} ${bonus}`.trim(),
          };
        }
        const consent =
          /^\/consent ([A-Za-z0-9_-]{16,128}) (granted|denied)$/u.exec(
            input.text,
          );
        if (consent) {
          const result = await deps.repository.completeEnrollment({
            ...command(),
            token: consent[1]!,
            decision: consent[2] as "granted" | "denied",
          });
          if (result.replay) return { status: "duplicate" };
          return {
            status: "handled",
            text: deps.waitlistV4
              ? result.kind === "granted"
                ? waitlistV4Text.askPromo
                : waitlistV4Text.declined
              : result.kind === "granted"
                ? "Согласие сохранено. Есть реферальный код коллеги? Отправьте его сообщением (promo_…). Нет кода — отправьте /start, и вы станете первопроходцем."
                : "Отказ сохранён. Регистрация и начисления не выполнены.",
            ...(deps.waitlistV4 && result.kind === "granted"
              ? {
                  replyMarkup: {
                    inline_keyboard: [
                      [{ text: "Да, есть промокод", callback_data: "wl:code" }],
                      [
                        {
                          text: "Нет, я первый/первая",
                          callback_data: "wl:first",
                        },
                      ],
                    ],
                  },
                }
              : {}),
          };
        }
        if (input.text === "/tariffs") {
          const result = await deps.repository.listTariffs(command());
          if (result.replay) return { status: "duplicate" };
          return {
            status: "handled",
            text: result.tariffs.length
              ? result.tariffs
                  .slice(0, 10)
                  .map(
                    (t) =>
                      `${t.displayName.slice(0, 100)}\n1 мес.: /tariff ${t.id} 1\n3 мес.: /tariff ${t.id} 3`,
                  )
                  .join("\n\n")
              : "Доступных предложений пока нет.",
          };
        }
        const selection = tariff.exec(input.text);
        if (selection) {
          const quote = await deps.repository.createQuote({
            ...command(),
            tariffVersionId: selection[1]!,
            termMonths: Number(selection[2]) as 1 | 3,
          });
          if (quote.replay) return { status: "duplicate" };
          return {
            status: "handled",
            text: `Предложение ${quote.id}: ${quote.priceMinor} коп., срок ${quote.termMonths} мес. Действует до ${quote.expiresAt}. Для заявки: /apply ${quote.id}`,
          };
        }
        const application = apply.exec(input.text);
        if (application) {
          const result = await deps.repository.createApplication({
            ...command(),
            quoteId: application[1]!,
          });
          if (result.replay) return { status: "duplicate" };
          return {
            status: "handled",
            text: `Заявка ${result.applicationId} ожидает проверки менеджером. Мы сообщим решение в этот чат; следующие шаги будут доступны после подтверждения.`,
          };
        }
        if (deps.faq && !input.text.startsWith("/") && input.text.trim()) {
          const answer = matchExpertPromoFaq(
            input.text,
            deps.faq === true ? undefined : deps.faq,
          );
          if (answer) return { status: "handled", text: answer };
          if (
            await deps.repository.recordManagerQuestion?.(
              scope,
              input.text.trim().slice(0, 3000),
            )
          )
            return {
              status: "handled",
              text: "Спасибо за вопрос! Передал его менеджеру, ответ придёт в этот чат.",
            };
        }
        return {
          status: /^\/(?:start|tariff|tariffs|apply|consent)(?: |$)/u.test(
            input.text,
          )
            ? "rejected"
            : "unhandled",
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "resident_verification_required"
        )
          return pendingVerification();
        return { status: "unavailable" };
      }
    },
  };
}
export type ExpertApplicantService = ReturnType<
  typeof createExpertApplicantService
>;
