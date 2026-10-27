import { expect, it, vi } from "vitest";
import {
  DisabledVkCommunityAdapter,
  VkCommunityDisabledError,
} from "./disabled-adapter.js";
import {
  VK_COMMUNITY_CONTRACT,
  type VkCommunitySendCommand,
  type VkCommunityWebhookCommand,
} from "./port.js";
function unreadable<T extends object>(onRead: () => void): T {
  return new Proxy({} as T, {
    get() {
      onRead();
      throw new Error("synthetic_private_command");
    },
    ownKeys() {
      onRead();
      throw new Error("synthetic_private_command");
    },
  });
}
it("rejects sends and webhooks before any input inspection or network call", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("unexpected_network"));
  let reads = 0;
  const logs = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
  ];
  try {
    const adapter = new DisabledVkCommunityAdapter();
    for (const operation of [
      () =>
        adapter.sendMessage(unreadable<VkCommunitySendCommand>(() => reads++)),
      () =>
        adapter.acceptWebhook(
          unreadable<VkCommunityWebhookCommand>(() => reads++),
        ),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(
        VkCommunityDisabledError,
      );
      await expect(operation()).rejects.toMatchObject({
        code: "VK_COMMUNITY_DISABLED",
        message: "vk_community_disabled",
      });
    }
    expect(reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
    for (const log of logs) log.mockRestore();
  }
});
it("rejects explicit activation without reading arbitrary activation objects", () => {
  let reads = 0;
  for (const value of [true, "true", unreadable<object>(() => reads++)])
    expect(() => new DisabledVkCommunityAdapter(value as boolean)).toThrow(
      VkCommunityDisabledError,
    );
  expect(reads).toBe(0);
});
it("keeps official protocol metadata immutable without exposing credentials or identity authority", () => {
  expect(VK_COMMUNITY_CONTRACT).toMatchObject({
    checkedAt: "2026-10-23",
    activation: "unsupported",
    methodBaseUrl: "https://api.vk.com/method",
    apiVersion: "5.199",
    incomingAuthentication: "not_implemented",
    outgoing: {
      method: "POST",
      apiMethod: "messages.send",
      contentType: "application/x-www-form-urlencoded",
      tokenKind: "community",
      tokenPlacement: "body.access_token",
      versionPlacement: "body.v",
      targetParameter: "peer_id",
      randomIdParameter: "random_id",
      textLimit: 9000,
    },
  });
  expect(Object.isFrozen(VK_COMMUNITY_CONTRACT)).toBe(true);
  expect(Object.isFrozen(VK_COMMUNITY_CONTRACT.outgoing)).toBe(true);
  expect(
    Object.isFrozen(VK_COMMUNITY_CONTRACT.outgoing.responseEnvelopes),
  ).toBe(true);
  expect(Object.isFrozen(VK_COMMUNITY_CONTRACT.sources)).toBe(true);
  expect(
    VK_COMMUNITY_CONTRACT.sources.every((url) =>
      url.startsWith("https://raw.githubusercontent.com/VKCOM/"),
    ),
  ).toBe(true);
});
it("never grants a successful send or verified identity for realistic synthetic inputs", async () => {
  const adapter = new DisabledVkCommunityAdapter(false);
  await expect(
    adapter.sendMessage({
      peerId: "2000000001",
      randomId: "12345",
      text: "synthetic message",
    }),
  ).rejects.toThrow("vk_community_disabled");
  await expect(
    adapter.acceptWebhook({
      rawBody: new TextEncoder().encode(
        '{"type":"message_new","object":{"message":{"from_id":123}}}',
      ),
      headers: { "x-synthetic-secret": "synthetic-only" },
    }),
  ).rejects.toThrow("vk_community_disabled");
});
