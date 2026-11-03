import { loadEnv } from "@ii-tonya/config";
import {
  DisabledSelartiAdapter,
  type SelartiPort,
} from "@ii-tonya/integrations";
import { describe, expect, it } from "vitest";
import {
  assertIntegrationBoundaries,
  disabledTelegramCallbacks,
  resolveIntegrationBoundaries,
} from "./integration-boundaries.js";
import type { TelegramCallbackService } from "./routes/telegram-webhook.js";

const localEnv = {
  DATABASE_URL: "postgres://ii_tonya:placeholder@localhost:5432/ii_tonya",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const off = { integrations: { selarti: false, telegram: false } } as never;
const on = { integrations: { selarti: true, telegram: true } } as never;
const liveSelarti = {
  decodeVerifiedWebhook: async () => ({}),
  send: async () => ({}),
} as unknown as SelartiPort;
const liveCallbacks: TelegramCallbackService = {
  isAuthorizedIdentity: async () => true,
  verifyCallback: async () => true,
  process: async () => undefined,
};

describe("Selarti / Telegram ingress env activation", () => {
  it("defaults both flags off", () => {
    expect(loadEnv(localEnv).integrations).toMatchObject({
      selarti: false,
      telegram: false,
    });
  });

  it("rejects activation without project-owned credentials", () => {
    expect(() => loadEnv({ ...localEnv, SELARTI_ENABLED: "true" })).toThrow(
      /selarti_activation/,
    );
    expect(() =>
      loadEnv({
        ...localEnv,
        SELARTI_ENABLED: "true",
        SELARTI_API_KEY: "__PLACEHOLDER_SELARTI_API_KEY__",
        SELARTI_WEBHOOK_SECRET: "__PLACEHOLDER_SELARTI_WEBHOOK_SECRET__",
      }),
    ).toThrow(/selarti_activation/);
    expect(() => loadEnv({ ...localEnv, TELEGRAM_ENABLED: "true" })).toThrow(
      /telegram_activation/,
    );
  });

  it("accepts activation with well-formed credentials", () => {
    const config = loadEnv({
      ...localEnv,
      SELARTI_ENABLED: "true",
      SELARTI_API_KEY: "k".repeat(32),
      SELARTI_WEBHOOK_SECRET: "s".repeat(32),
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: `123456789:${"A".repeat(35)}`,
      TELEGRAM_WEBHOOK_SECRET: "w".repeat(32),
    });
    expect(config.integrations).toMatchObject({
      selarti: true,
      telegram: true,
    });
  });
});

describe("integration boundary composition", () => {
  it("flag off: disabled boundaries, even when live capabilities are supplied", () => {
    const b = resolveIntegrationBoundaries(off, {
      selarti: liveSelarti,
      telegramCallbacks: liveCallbacks,
    });
    expect(b.selarti).toBeInstanceOf(DisabledSelartiAdapter);
    expect(b.telegramCallbacks).toBe(disabledTelegramCallbacks);
  });

  it("flag on without capability: startup fails", () => {
    expect(() =>
      resolveIntegrationBoundaries(on, { telegramCallbacks: liveCallbacks }),
    ).toThrow("selarti_capability_required");
    expect(() =>
      resolveIntegrationBoundaries(on, { selarti: liveSelarti }),
    ).toThrow("telegram_callback_capability_required");
    expect(() =>
      assertIntegrationBoundaries(on, {
        selarti: new DisabledSelartiAdapter(),
        telegramCallbacks: liveCallbacks,
      }),
    ).toThrow("selarti_capability_required");
    expect(() =>
      assertIntegrationBoundaries(on, {
        selarti: liveSelarti,
        telegramCallbacks: disabledTelegramCallbacks,
      }),
    ).toThrow("telegram_callback_capability_required");
  });

  it("flag on with capability: live boundaries are used", () => {
    const b = resolveIntegrationBoundaries(on, {
      selarti: liveSelarti,
      telegramCallbacks: liveCallbacks,
    });
    expect(b.selarti).toBe(liveSelarti);
    expect(b.telegramCallbacks).toBe(liveCallbacks);
    expect(() => assertIntegrationBoundaries(on, b)).not.toThrow();
  });

  it("disabled Telegram boundary rejects every callback", async () => {
    await expect(
      disabledTelegramCallbacks.verifyCallback({}, "c"),
    ).resolves.toBe(false);
    await expect(disabledTelegramCallbacks.process({}, "c")).rejects.toThrow(
      /disabled/,
    );
  });
});
