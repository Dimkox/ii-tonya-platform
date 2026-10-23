export interface MainCardScope {
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
  requestKey: string;
  requestDigest: string;
}
export type MainCardQuoteCommand = MainCardScope & {
  tariffVersionId: string;
  termMonths: 1 | 3;
  revision: number;
  renewalBillId?: string;
};
export type MainCardAcceptanceCommand = MainCardScope & {
  quoteId: string;
  revision: number;
  renewalBillId?: string;
};
export type MainCardCheckoutCommand = MainCardScope & {
  revision: number;
  renewalBillId?: string;
  renewalAcceptedQuoteId?: string;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class CardMainPaymentError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CardMainPaymentError";
  }
}
const fail = (code: string): never => {
  throw new CardMainPaymentError(code);
};
export function parseMainCardCommand(
  raw: unknown,
  operation: "quote",
): MainCardQuoteCommand;
export function parseMainCardCommand(
  raw: unknown,
  operation: "accept",
): MainCardAcceptanceCommand;
export function parseMainCardCommand(
  raw: unknown,
  operation: "checkout",
): MainCardCheckoutCommand;
export function parseMainCardCommand(
  raw: unknown,
  operation: "quote" | "accept" | "checkout",
): MainCardQuoteCommand | MainCardAcceptanceCommand | MainCardCheckoutCommand {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return fail("card_main_invalid_request");
  const r = raw as Record<string, unknown>;
  const specific =
    operation === "quote"
      ? ["tariffVersionId", "termMonths", "revision"]
      : operation === "accept"
        ? ["quoteId", "revision"]
        : ["revision"];
  const keys = [
    "botId",
    "botKey",
    "telegramUserId",
    "chatId",
    "requestKey",
    "requestDigest",
    ...specific,
    ...(operation === "checkout" && Object.hasOwn(r, "renewalAcceptedQuoteId")
      ? ["renewalAcceptedQuoteId"]
      : []),
    ...(Object.hasOwn(r, "renewalBillId") ? ["renewalBillId"] : []),
  ];
  if (
    Object.keys(r).length !== keys.length ||
    Object.keys(r).some((k) => !keys.includes(k)) ||
    typeof r.botId !== "string" ||
    !/^[1-9]\d{0,15}$/u.test(r.botId) ||
    !Number.isSafeInteger(Number(r.botId)) ||
    typeof r.botKey !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(r.botKey) ||
    typeof r.telegramUserId !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(r.telegramUserId) ||
    r.chatId !== r.telegramUserId ||
    typeof r.requestKey !== "string" ||
    !r.requestKey.startsWith(`${r.botId}:`) ||
    !/^\d{1,16}$/u.test(r.requestKey.slice(r.botId.length + 1)) ||
    !Number.isSafeInteger(Number(r.requestKey.slice(r.botId.length + 1))) ||
    typeof r.requestDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(r.requestDigest)
  )
    return fail("card_main_invalid_request");
  if (
    Object.hasOwn(r, "renewalBillId") &&
    (typeof r.renewalBillId !== "string" || !uuid.test(r.renewalBillId))
  )
    return fail("card_main_invalid_request");
  if (
    Object.hasOwn(r, "renewalAcceptedQuoteId") &&
    (operation !== "checkout" ||
      typeof r.renewalAcceptedQuoteId !== "string" ||
      !uuid.test(r.renewalAcceptedQuoteId) ||
      typeof r.renewalBillId !== "string")
  )
    return fail("card_main_invalid_request");
  if (
    operation === "quote" &&
    (typeof r.tariffVersionId !== "string" ||
      !uuid.test(r.tariffVersionId) ||
      (r.termMonths !== 1 && r.termMonths !== 3))
  )
    return fail("card_main_invalid_request");
  if (
    operation === "accept" &&
    (typeof r.quoteId !== "string" ||
      !uuid.test(r.quoteId) ||
      !Number.isSafeInteger(r.revision) ||
      Number(r.revision) < 1 ||
      Number(r.revision) > 1000000)
  )
    return fail("card_main_invalid_request");
  if (
    !Number.isSafeInteger(r.revision) ||
    Number(r.revision) < 1 ||
    Number(r.revision) > 1000000
  )
    return fail("card_main_invalid_request");
  // Snapshot every caller field before the first transaction or provider await.
  return { ...r } as unknown as
    MainCardQuoteCommand | MainCardAcceptanceCommand | MainCardCheckoutCommand;
}
