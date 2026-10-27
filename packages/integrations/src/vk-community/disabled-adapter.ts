import type {
  VkCommunityPort,
  VkCommunitySendCommand,
  VkCommunityWebhookCommand,
} from "./port.js";
export class VkCommunityDisabledError extends Error {
  readonly code = "VK_COMMUNITY_DISABLED" as const;
  constructor() {
    super("vk_community_disabled");
    this.name = "VkCommunityDisabledError";
  }
}
export class DisabledVkCommunityAdapter implements VkCommunityPort {
  constructor(enabled: boolean = false) {
    if (enabled !== false) throw new VkCommunityDisabledError();
    Object.freeze(this);
  }
  async sendMessage(command: VkCommunitySendCommand): Promise<never> {
    void command;
    throw new VkCommunityDisabledError();
  }
  async acceptWebhook(command: VkCommunityWebhookCommand): Promise<never> {
    void command;
    throw new VkCommunityDisabledError();
  }
}
