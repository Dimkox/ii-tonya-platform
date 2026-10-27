import { expect, it, vi } from "vitest";
import {
  DisabledMaxBusinessAdapter,
  MaxBusinessDisabledError,
} from "./disabled-adapter.js";
import {
  MAX_BUSINESS_CONTRACT,
  type MaxBusinessSendCommand,
  type MaxBusinessTarget,
  type MaxBusinessWebhookCommand,
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
    const adapter = new DisabledMaxBusinessAdapter();
    for (const operation of [
      () =>
        adapter.sendMessage(unreadable<MaxBusinessSendCommand>(() => reads++)),
      () =>
        adapter.acceptWebhook(
          unreadable<MaxBusinessWebhookCommand>(() => reads++),
        ),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(
        MaxBusinessDisabledError,
      );
      await expect(operation()).rejects.toMatchObject({
        code: "MAX_BUSINESS_DISABLED",
        message: "max_business_disabled",
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
    expect(() => new DisabledMaxBusinessAdapter(value as boolean)).toThrow(
      MaxBusinessDisabledError,
    );
  expect(reads).toBe(0);
});
it("pins current official host and header authorization, not the old host or query token", () => {
  expect(MAX_BUSINESS_CONTRACT).toMatchObject({
    checkedAt: "2026-10-23",
    activation: "unsupported",
    apiOrigin: "https://platform-api2.max.ru",
    incomingAuthentication: "not_implemented",
    outgoing: {
      method: "POST",
      path: "/messages",
      contentType: "application/json",
      tokenPlacement: "header.Authorization",
      targetCardinality: "exactly_one",
      targetFormat: "int64",
      textProperty: "text",
      textLimit: 4000,
      responseEnvelope: "message",
    },
  });
  expect(MAX_BUSINESS_CONTRACT.outgoing.targetParameters).toEqual([
    "user_id",
    "chat_id",
  ]);
  expect(Object.isFrozen(MAX_BUSINESS_CONTRACT)).toBe(true);
  expect(Object.isFrozen(MAX_BUSINESS_CONTRACT.outgoing)).toBe(true);
  expect(Object.isFrozen(MAX_BUSINESS_CONTRACT.outgoing.targetParameters)).toBe(
    true,
  );
  expect(Object.isFrozen(MAX_BUSINESS_CONTRACT.sources)).toBe(true);
  expect(MAX_BUSINESS_CONTRACT.sources).toEqual([
    "https://dev.max.ru/docs-api/methods/POST/messages",
  ]);
});
it("does not round int64 targets or create a provider-verified identity", async () => {
  const adapter = new DisabledMaxBusinessAdapter(false);
  const targets: readonly MaxBusinessTarget[] = [
    { userId: "9223372036854775807" },
    { chatId: "-9223372036854775808" },
  ];
  for (const target of targets)
    await expect(
      adapter.sendMessage({ target, text: "synthetic message" }),
    ).rejects.toThrow("max_business_disabled");
  await expect(
    adapter.acceptWebhook({
      rawBody: new TextEncoder().encode(
        '{"update_type":"message_created","message":{"sender":{"user_id":123}}}',
      ),
      headers: { authorization: "synthetic-only" },
    }),
  ).rejects.toThrow("max_business_disabled");
});
