import type { MaxBusinessTarget } from "./port.js";
export class MaxBusinessContractError extends Error {
  readonly code = "MAX_BUSINESS_CONTRACT_INVALID" as const;
  constructor() {
    super("max_business_contract_invalid");
    this.name = "MaxBusinessContractError";
  }
}
export interface MaxBusinessTextRequestInput {
  readonly accessToken: string;
  readonly target: MaxBusinessTarget;
  readonly text: string;
}
export interface MaxBusinessTextRequest {
  readonly url: string;
  readonly method: "POST";
  readonly redirect: "error";
  readonly headers: Readonly<{
    "content-type": "application/json";
    Authorization: string;
  }>;
  readonly body: string;
}
export type MaxBusinessTextResponse =
  | {
      readonly kind: "untrusted_ack";
      readonly messageId: string;
      readonly sequence: string;
      readonly timestamp: string;
      readonly recipient: Readonly<{
        chatType: string;
        userId?: string;
        chatId?: string;
      }>;
    }
  | { readonly kind: "unsupported_response" };
const invalid = (): never => {
  throw new MaxBusinessContractError();
};
function record(value: unknown): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.keys(descriptors).length > 32 ||
    Object.values(descriptors).some((d) => !("value" in d))
  )
    return null;
  return value as Record<string, unknown>;
}
function decimal(value: unknown): string {
  if (
    typeof value !== "string" ||
    /^(?:0|-?[1-9][0-9]{0,18})$/u.exec(value)?.[0] !== value
  )
    return invalid();
  const n = BigInt(value);
  if (n < -9223372036854775808n || n > 9223372036854775807n) return invalid();
  return value;
}
/** Pure data, never a sender. The descriptor contains the supplied header token;
 * callers must not log or persist it. TLS remains the future transport's duty. */
export function buildMaxBusinessTextRequest(
  input: MaxBusinessTextRequestInput,
): MaxBusinessTextRequest {
  try {
    const row = record(input),
      target = row && record(row.target);
    if (
      !row ||
      !target ||
      Object.keys(row).sort().join("|") !== "accessToken|target|text" ||
      typeof row.accessToken !== "string" ||
      /^[\x21-\x7e]{1,4096}$/u.exec(row.accessToken)?.[0] !== row.accessToken ||
      typeof row.text !== "string" ||
      !row.text.trim() ||
      row.text.length > 4000 ||
      !row.text.isWellFormed() ||
      row.text.includes("\0")
    )
      return invalid();
    const keys = Object.keys(target);
    if (keys.length !== 1 || (keys[0] !== "userId" && keys[0] !== "chatId"))
      return invalid();
    const value = decimal(target[keys[0]]),
      parameter = keys[0] === "userId" ? "user_id" : "chat_id";
    return Object.freeze({
      url:
        "https://platform-api2.max.ru/messages?" +
        new URLSearchParams({ [parameter]: value }).toString(),
      method: "POST",
      redirect: "error",
      headers: Object.freeze({
        "content-type": "application/json",
        Authorization: row.accessToken,
      }),
      body: JSON.stringify({ text: row.text }),
    });
  } catch {
    return invalid();
  }
}
const integer = (value: unknown): string | null =>
  typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : null;
const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= max &&
  value.isWellFormed() &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
/** Minimal documented Message acknowledgement, always UNTRUSTED. Missing recipient
 * IDs stay absent; no ownership or durable delivery is inferred. Already-decoded
 * unsafe int64 numbers fail closed rather than being rounded or coerced. */
export function parseMaxBusinessTextResponse(
  value: unknown,
): MaxBusinessTextResponse {
  try {
    const root = record(value),
      message = root && record(root.message);
    if (!root || Object.keys(root).length !== 1 || !message)
      return { kind: "unsupported_response" };
    const body = record(message.body),
      recipient = record(message.recipient);
    const sequence = body && integer(body.seq),
      timestamp = integer(message.timestamp);
    if (
      !body ||
      !recipient ||
      !bounded(body.mid, 256) ||
      sequence === null ||
      sequence === undefined ||
      timestamp === null ||
      !bounded(recipient.chat_type, 64)
    )
      return { kind: "unsupported_response" };
    const ids: { userId?: string; chatId?: string } = {};
    for (const [field, target] of [
      ["user_id", "userId"],
      ["chat_id", "chatId"],
    ] as const) {
      if (recipient[field] !== undefined && recipient[field] !== null) {
        const id = integer(recipient[field]);
        if (id === null) return { kind: "unsupported_response" };
        ids[target] = id;
      }
    }
    return Object.freeze({
      kind: "untrusted_ack",
      messageId: body.mid,
      sequence,
      timestamp,
      recipient: Object.freeze({ chatType: recipient.chat_type, ...ids }),
    });
  } catch {
    return { kind: "unsupported_response" };
  }
}
