import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "@ii-tonya/db";
import {
  createExpertTelegramFetchTransport,
  createExpertTelegramRuntimeComposition,
} from "./expert-telegram-runtime-composition.js";

const BOT_TOKEN = `123456:${"A".repeat(35)}`;
const SECRET = Buffer.alloc(32, 7).toString("base64url");
const db = {
  execute: vi.fn(async () => ({ rows: [] })),
} as unknown as DrizzleDb;

const config = (features: Record<string, boolean>, session = true) =>
  ({
    displayTimezone: "Europe/Moscow",
    features: { expertSession: session, ...features },
    ...(session
      ? {
          expertSession: {
            botToken: BOT_TOKEN,
            botKey: "expert_bot",
            origin: "https://expert.example",
            botUsername: "tonya_expert_bot",
            widgetEnabled: false,
          },
        }
      : {}),
  }) as never;

describe("expert Telegram runtime composition (SCRUM-513)", () => {
  it("is absent while EXPERT_TELEGRAM_QUERIES_ENABLED is off", () => {
    expect(
      createExpertTelegramRuntimeComposition({
        config: config({ expertTelegramQueries: false }),
        db,
        env: {},
      }),
    ).toBeUndefined();
  });

  it("fails closed without the client-view secret or expert session", () => {
    expect(() =>
      createExpertTelegramRuntimeComposition({
        config: config({ expertTelegramQueries: true }),
        db,
        env: {},
      }),
    ).toThrow("expert_telegram_client_view_secret_required");
    expect(() =>
      createExpertTelegramRuntimeComposition({
        config: config({ expertTelegramQueries: true }),
        db,
        env: { EXPERT_TELEGRAM_CLIENT_VIEW_SECRET: "short" },
      }),
    ).toThrow("expert_telegram_client_view_secret_required");
    expect(() =>
      createExpertTelegramRuntimeComposition({
        config: config({ expertTelegramQueries: true }, false),
        db,
        env: { EXPERT_TELEGRAM_CLIENT_VIEW_SECRET: SECRET },
      }),
    ).toThrow("expert_telegram_runtime_session_required");
  });

  it.each([
    "expertTelegramFinancialViews",
    "expertTelegramReferral",
    "expertTelegramCheckout",
  ])("keeps %s unsupported (fail closed)", (flag) => {
    expect(() =>
      createExpertTelegramRuntimeComposition({
        config: config({ expertTelegramQueries: true, [flag]: true }),
        db,
        env: { EXPERT_TELEGRAM_CLIENT_VIEW_SECRET: SECRET },
      }),
    ).toThrow("expert_telegram_runtime_financial_unsupported");
  });

  it("builds the composition; reschedule is off by default", () => {
    const env = { EXPERT_TELEGRAM_CLIENT_VIEW_SECRET: SECRET };
    const composition = createExpertTelegramRuntimeComposition({
      config: config({ expertTelegramQueries: true }),
      db,
      env,
    });
    expect(composition).toBeDefined();
    expect(composition?.reschedule).toBeUndefined();
    expect(typeof composition?.queries.schedule).toBe("function");
    expect(
      createExpertTelegramRuntimeComposition({
        config: config({ expertTelegramQueries: true }),
        db,
        env: { ...env, EXPERT_TELEGRAM_RESCHEDULE_ENABLED: "true" },
      })?.reschedule,
    ).toBeDefined();
    expect(() =>
      createExpertTelegramRuntimeComposition({
        config: config({ expertTelegramQueries: true }),
        db,
        env: { ...env, EXPERT_TELEGRAM_RESCHEDULE_ENABLED: "yes" },
      }),
    ).toThrow("expert_telegram_reschedule_flag_invalid");
  });

  it("returns null for an unknown Telegram principal", async () => {
    const composition = createExpertTelegramRuntimeComposition({
      config: config({ expertTelegramQueries: true }),
      db,
      env: { EXPERT_TELEGRAM_CLIENT_VIEW_SECRET: SECRET },
    })!;
    await expect(composition.resolvePrincipal("12345")).resolves.toBeNull();
    await expect(
      composition.authenticateClientView({
        data: "cv1.x",
        telegramUserId: "12345",
        correlationId: "c",
      }),
    ).resolves.toBeNull();
  });

  it("fetch transport posts JSON only to api.telegram.org", async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"ok":true,"result":{"message_id":5}}'),
    );
    const transport = createExpertTelegramFetchTransport(
      fetchImpl as unknown as typeof fetch,
    );
    const request = {
      method: "POST" as const,
      headers: {},
      body: { chat_id: "1", text: "hi" },
      context: { idempotencyKey: "k", disableRequestLogging: true as const },
    };
    await expect(
      transport.request({
        ...request,
        url: new URL("https://api.telegram.org/botX/sendMessage"),
      }),
    ).resolves.toEqual({
      status: 200,
      body: { ok: true, result: { message_id: 5 } },
    });
    await expect(
      transport.request({ ...request, url: new URL("https://evil.example/") }),
    ).rejects.toThrow("expert_telegram_request_invalid");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
