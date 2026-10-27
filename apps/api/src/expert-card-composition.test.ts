import { expect, it } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
import {
  assertExpertCardCapability,
  createExpertCardComposition,
} from "./expert-card-composition.js";
const settings = {
  materialDeliveryEnabled: false,
  mainCheckoutEnabled: false,
  workBotId: "11",
  workBotKey: "work",
  workBotUsername: "synthetic_work_bot",
  webhookSecret: "synthetic_work_secret_123456789012",
  messagingConsentPolicyVersion: "policy-v1",
  paymentMode: "test" as const,
};
const config = {
  features: { expertCard: true },
  expertCard: settings,
} as RuntimeConfig;
it("does not construct storage when card capability is disabled", () => {
  expect(
    createExpertCardComposition(
      undefined as never,
      { features: {} } as RuntimeConfig,
    ),
  ).toBeUndefined();
});
it("fails enabled incomplete configuration before touching DB", () => {
  expect(() =>
    createExpertCardComposition(
      undefined as never,
      { features: { expertCard: true } } as RuntimeConfig,
    ),
  ).toThrow("expert_card_configuration_required");
});
it("requires all injected card interfaces for enabled normal app", () => {
  expect(() => assertExpertCardCapability(config, undefined)).toThrow(
    "expert_card_capability_required",
  );
});
it("normal composition exposes actual work/handoff/staff services", () => {
  const cap = createExpertCardComposition(undefined as never, config);
  expect(() => assertExpertCardCapability(config, cap)).not.toThrow();
  expect(typeof cap?.service.handleWork).toBe("function");
  expect(typeof cap?.service.handlePromoHandoff).toBe("function");
  expect(typeof cap?.admin.review).toBe("function");
});
it.each([
  "workBotId",
  "workBotKey",
  "workBotUsername",
  "webhookSecret",
  "paymentMode",
] as const)(
  "binds injected %s to the trusted receiving configuration",
  (key) => {
    const cap = createExpertCardComposition(undefined as never, config)!;
    expect(() =>
      assertExpertCardCapability(config, {
        ...cap,
        [key]: "different",
      } as never),
    ).toThrow("expert_card_capability_required");
  },
);

it("R5 normal composition acknowledges only the configured work bot through the trusted ACK boundary", async () => {
  const token = `12345:${"synthetic_fixture_".repeat(2)}`;
  const configured = {
    ...config,
    features: { expertCard: true, expertDraftTags: true },
    expertCard: {
      ...settings,
      workBotId: "12345",
      draftTagsEnabled: true,
      workBotToken: token,
    },
  } as RuntimeConfig;
  const calls: { url: string; body: string }[] = [];
  const cap = createExpertCardComposition(undefined as never, configured, {
    tagCallbackFetch: async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response("true");
    },
  })!;
  expect(() => assertExpertCardCapability(configured, cap)).not.toThrow();
  await cap.answerTagCallback!({
    botId: "12345",
    callbackQueryId: "original-callback-id",
    signal: new AbortController().signal,
  });
  expect(calls).toEqual([
    {
      url: `https://api.telegram.org/bot${token}/answerCallbackQuery`,
      body: JSON.stringify({ callback_query_id: "original-callback-id" }),
    },
  ]);
  await expect(
    cap.answerTagCallback!({
      botId: "99999",
      callbackQueryId: "forged",
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("card_callback_scope_invalid");
  expect(calls).toHaveLength(1);
  expect(() =>
    assertExpertCardCapability(configured, {
      ...cap,
      answerTagCallback: undefined,
    } as never),
  ).toThrow("expert_card_capability_required");
  expect(() =>
    createExpertCardComposition(
      undefined as never,
      {
        ...configured,
        expertCard: { ...configured.expertCard!, workBotToken: undefined },
      } as never,
    ),
  ).toThrow("expert_card_configuration_required");
});
