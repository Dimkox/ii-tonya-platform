export class VkCommunityContractError extends Error {
  readonly code = "VK_COMMUNITY_CONTRACT_INVALID" as const;
  constructor() {
    super("vk_community_contract_invalid");
    this.name = "VkCommunityContractError";
  }
}
export interface VkCommunityTextRequestInput {
  readonly accessToken: string;
  readonly peerId: string;
  readonly randomId: string;
  readonly text: string;
}
export interface VkCommunityTextRequest {
  readonly url: "https://api.vk.com/method/messages.send";
  readonly method: "POST";
  readonly redirect: "error";
  readonly headers: Readonly<{
    "content-type": "application/x-www-form-urlencoded";
  }>;
  readonly body: string;
}
const invalid = (): never => {
  throw new VkCommunityContractError();
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
  if (typeof value !== "string" || !/^(?:0|-?[1-9][0-9]{0,18})$/u.test(value))
    return invalid();
  const n = BigInt(value);
  if (n < -9223372036854775808n || n > 9223372036854775807n) return invalid();
  return value;
}
/** Pure request data only. It contains a caller-owned token and must not be logged
 * or persisted. No sender, credentials resolver or activation path is supplied. */
export function buildVkCommunityTextRequest(
  input: VkCommunityTextRequestInput,
): VkCommunityTextRequest {
  try {
    const row = record(input);
    if (
      !row ||
      Object.keys(row).sort().join("|") !==
        "accessToken|peerId|randomId|text" ||
      typeof row.accessToken !== "string" ||
      !/^[\x21-\x7e]{1,4096}$/u.test(row.accessToken) ||
      typeof row.text !== "string" ||
      !row.text.trim() ||
      row.text.length > 9000 ||
      !row.text.isWellFormed() ||
      row.text.includes("\0")
    )
      return invalid();
    const peerId = decimal(row.peerId),
      randomId = decimal(row.randomId);
    return Object.freeze({
      url: "https://api.vk.com/method/messages.send",
      method: "POST",
      redirect: "error",
      headers: Object.freeze({
        "content-type": "application/x-www-form-urlencoded",
      }),
      body: new URLSearchParams({
        access_token: row.accessToken,
        v: "5.199",
        peer_id: peerId,
        random_id: randomId,
        message: row.text,
      }).toString(),
    });
  } catch {
    return invalid();
  }
}
export type VkCommunityTextResponse =
  | { readonly kind: "untrusted_ack"; readonly messageId: string }
  | { readonly kind: "provider_error" }
  | { readonly kind: "unsupported_response" };
/** Parses an already decoded, bounded response object. This is not a delivery
 * receipt or identity proof. Only the documented single integer variant is used. */
export function parseVkCommunityTextResponse(
  value: unknown,
): VkCommunityTextResponse {
  try {
    const row = record(value);
    if (!row) return { kind: "unsupported_response" };
    if (Object.keys(row).length === 1 && record(row.error))
      return { kind: "provider_error" };
    if (
      Object.keys(row).length !== 1 ||
      typeof row.response !== "number" ||
      !Number.isSafeInteger(row.response) ||
      row.response < 0
    )
      return { kind: "unsupported_response" };
    return { kind: "untrusted_ack", messageId: String(row.response) };
  } catch {
    return { kind: "unsupported_response" };
  }
}
