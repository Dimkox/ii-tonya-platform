/** Documentation snapshot only. This is not a live HTTP client or verified
 * inbound identity mapping. Activation requires a separately reviewed design. */
export const VK_COMMUNITY_CONTRACT = Object.freeze({
  checkedAt: "2026-10-23",
  activation: "unsupported",
  methodBaseUrl: "https://api.vk.com/method",
  apiVersion: "5.199",
  outgoing: Object.freeze({
    method: "POST",
    apiMethod: "messages.send",
    contentType: "application/x-www-form-urlencoded",
    tokenKind: "community",
    tokenPlacement: "body.access_token",
    versionPlacement: "body.v",
    targetParameter: "peer_id",
    randomIdParameter: "random_id",
    messageParameter: "message",
    textLimit: 9000,
    responseEnvelopes: Object.freeze(["response", "error"] as const),
  }),
  incomingAuthentication: "not_implemented",
  sources: Object.freeze([
    "https://raw.githubusercontent.com/VKCOM/vk-php-sdk/master/src/VK/Client/VKApiClient.php",
    "https://raw.githubusercontent.com/VKCOM/vk-php-sdk/master/src/VK/Client/VKApiRequest.php",
    "https://raw.githubusercontent.com/VKCOM/vk-api-schema/master/messages/methods.json",
    "https://raw.githubusercontent.com/VKCOM/vk-api-schema/master/messages/responses.json",
  ] as const),
} as const);

export interface VkCommunitySendCommand {
  /** Opaque decimal provider identifier; never converts into a platform owner. */
  readonly peerId: string;
  readonly randomId: string;
  readonly text: string;
}
export interface VkCommunityWebhookCommand {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
}
/** The prepared port intentionally has no successful outcome or identity decoder. */
export interface VkCommunityPort {
  sendMessage(command: VkCommunitySendCommand): Promise<never>;
  acceptWebhook(command: VkCommunityWebhookCommand): Promise<never>;
}
