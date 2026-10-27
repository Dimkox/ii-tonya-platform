import type { ResidentDocument } from "@ii-tonya/domain";
import type { ResidentFormInput } from "./resident-verification-service.js";
import {
  renderPersonalOffer,
  type PersonalOfferView,
} from "./expert-personal-offer-service.js";
import { createHash } from "node:crypto";

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
        | { inline_keyboard: { text: string; callback_data: string }[][] }
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
        input.text.length > (deps.verificationForm ? 3000 : 256)
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
        if (
          deps.separatedSales &&
          !/^\/(?:start|consent)(?: |$)/u.test(input.text)
        ) {
          const sales = await deps.separatedSales.handle(input);
          if (sales) return sales;
        }
        if (
          deps.verificationForm &&
          !(deps.separatedSales && input.text.startsWith("/profile")) &&
          !/^\/(?:start|consent)(?: |$)/u.test(input.text)
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
        const start = /^\/start(?: (promo_[A-Za-z0-9_-]{8,48}))?$/u.exec(
          input.text,
        );
        if (start) {
          const enrollment = await deps.repository.beginEnrollment({
            ...command(),
            ...(start[1] ? { refCode: start[1] } : {}),
          });
          if (enrollment.kind === "waiting_content")
            return { status: "handled", text: "TODO: Wait for Prompt Spec" };
          if (enrollment.kind === "consent_pending")
            return { status: "duplicate" };
          if (enrollment.kind === "consent_required") {
            const text = `${enrollment.document.title}\n${enrollment.document.body}\nСогласиться: /consent ${enrollment.token} granted\nОтказаться: /consent ${enrollment.token} denied`;
            // Preserve the complete approved notice. Never truncate legal text.
            if (text.length > 4096)
              return { status: "handled", text: "TODO: Wait for Prompt Spec" };
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
            text:
              result.kind === "granted"
                ? "Выбор сохранён. Для регистрации отправьте /start."
                : "Отказ сохранён. Регистрация и начисления не выполнены.",
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
            text: `Заявка ${result.applicationId} ожидает проверки менеджером. TODO: Wait for Prompt Spec`,
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
