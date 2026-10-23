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
