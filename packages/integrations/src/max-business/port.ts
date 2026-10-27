/** Documentation snapshot only. Authorization is a header; the token is never a
 * query parameter. Pure helpers provide no live transport or inbound identity verification. */
export const MAX_BUSINESS_CONTRACT = Object.freeze({
  checkedAt: "2026-10-23",
  activation: "unsupported",
  apiOrigin: "https://platform-api2.max.ru",
  outgoing: Object.freeze({
    method: "POST",
    path: "/messages",
    contentType: "application/json",
    tokenPlacement: "header.Authorization",
    targetParameters: Object.freeze(["user_id", "chat_id"] as const),
    targetCardinality: "exactly_one",
    targetFormat: "int64",
    textProperty: "text",
    textLimit: 4000,
    responseEnvelope: "message",
  }),
  incomingAuthentication: "not_implemented",
  sources: Object.freeze([
    "https://dev.max.ru/docs-api/methods/POST/messages",
  ] as const),
} as const);
/** Signed int64 identifiers remain decimal strings; never round through Number
 * or assert that a provider target owns an internal account. */
export type MaxBusinessTarget =
  | { readonly userId: string; readonly chatId?: never }
  | { readonly chatId: string; readonly userId?: never };
export interface MaxBusinessSendCommand {
  readonly target: MaxBusinessTarget;
  readonly text: string;
}
export interface MaxBusinessWebhookCommand {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
}
export interface MaxBusinessPort {
  sendMessage(command: MaxBusinessSendCommand): Promise<never>;
  acceptWebhook(command: MaxBusinessWebhookCommand): Promise<never>;
}
