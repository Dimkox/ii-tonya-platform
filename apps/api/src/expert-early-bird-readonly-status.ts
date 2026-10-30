import type {
  ResidentFormInput,
  ExpertApplicantReply,
} from "@ii-tonya/application";
import type { PostgresEarlyBirdPaidStatus } from "@ii-tonya/db";
const start = Date.parse("2027-01-11T00:00:00+03:00");
const minor = /^[1-9][0-9]{0,11}$/u;
/** A read-only display: no gateway, invoice, payment mutation, or readiness claim. */
export function createEarlyBirdReadOnlyStatus(
  reader: Pick<PostgresEarlyBirdPaidStatus, "find">,
): { handle(input: ResidentFormInput): Promise<ExpertApplicantReply | null> } {
  return {
    async handle(input) {
      if (
        input.text !== "/my_tariff" &&
        input.text !== "Мой актуальный тариф" &&
        input.callbackData !== "st:current"
      )
        return null;
      const row = await reader.find({
        botId: input.botId,
        botKey: input.botKey,
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
      });
      if (!row) return null;
      const effective = Date.parse(row.effectiveStart);
      if (
        !minor.test(row.lockedMonthlyMinor) ||
        Date.parse(row.clientStart) !== start ||
        !Number.isFinite(effective) ||
        effective < start ||
        !["ACTIVE_PAID_WAITING_START", "ACTIVE"].includes(row.residentStatus) ||
        !["FULLY_PREPAID_WITH_DISCOUNT", "FULLY_PREPAID_NO_DISCOUNT"].includes(
          row.status,
        )
      )
        return { status: "unavailable" };
      const amount = BigInt(row.lockedMonthlyMinor),
        cents = amount % 100n;
      const price = `${amount / 100n}${cents ? `,${cents.toString().padStart(2, "0")}` : ""} ₽`;
      const date = new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Moscow",
      })
        .format(new Date(effective))
        .replace(/\s*г\.$/u, " года");
      const text =
        row.residentStatus === "ACTIVE"
          ? `Тариф оплачен: ${price} в месяц. Вы — активный резидент. Оплаченный период начался ${date}.`
          : `Тариф оплачен: ${price} в месяц. Вы — активный резидент в ожидании старта. Оплаченный период начинается ${date}.`;
      return {
        status: "handled",
        text,
        replyMarkup: { remove_keyboard: true },
      };
    },
  };
}
