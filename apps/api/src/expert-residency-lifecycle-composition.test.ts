import { expect, it, vi } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
import {
  assertExpertResidencyLifecycleCapability,
  assertExpertResidencyLifecycleCheckout,
  createExpertResidencyLifecycleComposition,
} from "./expert-residency-lifecycle-composition.js";
const card = {
  workBotId: "11",
  workBotKey: "work",
  workBotUsername: "synthetic_work_bot",
  webhookSecret: "synthetic_work_secret_123456789012",
  messagingConsentPolicyVersion: "policy-v1",
  paymentMode: "test" as const,
  materialDeliveryEnabled: false,
  mainCheckoutEnabled: false,
};
const settings = {
  enabled: false,
  commandsEnabled: true,
  noticeDeliveryEnabled: false,
  renewalCheckoutEnabled: false,
};
const config = {
  features: { expertResidencyLifecycleCommands: true },
  expertResidencyLifecycle: settings,
  expertCard: card,
} as RuntimeConfig;
it("constructs no D API storage when all commands are off", () => {
  expect(
    createExpertResidencyLifecycleComposition(
      undefined as never,
      { features: {} } as RuntimeConfig,
    ),
  ).toBeUndefined();
});
it("does not enable owner admission just because scheduled work is enabled", () => {
  expect(
    createExpertResidencyLifecycleComposition(undefined as never, {
      ...config,
      features: {
        ...config.features,
        expertResidencyLifecycleCommands: false,
        expertResidencyLifecycle: true,
      },
      expertResidencyLifecycle: {
        ...settings,
        enabled: true,
        commandsEnabled: false,
      },
    }),
  ).toBeUndefined();
});
it("requires complete config before touching DB", () => {
  expect(() =>
    createExpertResidencyLifecycleComposition(
      undefined as never,
      { features: { expertResidencyLifecycleCommands: true } } as RuntimeConfig,
    ),
  ).toThrow("expert_residency_lifecycle_configuration_required");
});
it("composes standalone D commands while C is off", () => {
  const cap = createExpertResidencyLifecycleComposition(
    undefined as never,
    config,
  );
  expect(typeof cap?.service.handleWork).toBe("function");
  expect(() =>
    assertExpertResidencyLifecycleCapability(config, cap),
  ).not.toThrow();
});
it("fails enabled D without injected capability", () => {
  expect(() =>
    assertExpertResidencyLifecycleCapability(config, undefined),
  ).toThrow("expert_residency_lifecycle_capability_required");
});
it.each(["workBotId", "workBotKey", "webhookSecret", "paymentMode"] as const)(
  "binds D receiving %s to explicit trusted config",
  (key) => {
    const cap = createExpertResidencyLifecycleComposition(
      undefined as never,
      config,
    )!;
    expect(() =>
      assertExpertResidencyLifecycleCapability(config, {
        ...cap,
        [key]: "different",
      } as never),
    ).toThrow("expert_residency_lifecycle_capability_required");
  },
);
it("requires strict reviewed checkout when renewal checkout is selected", () => {
  expect(() =>
    assertExpertResidencyLifecycleCheckout(
      {
        ...config,
        expertResidencyLifecycle: { ...settings, renewalCheckoutEnabled: true },
      },
      {},
    ),
  ).toThrow("expert_residency_lifecycle_checkout_capability_required");
});
it("injected checkout cannot activate it above its flag ceiling", () => {
  const createOrRecover = vi.fn(async () => ({ kind: "pending" as const }));
  const cap = createExpertResidencyLifecycleComposition(
    undefined as never,
    config,
    { mainCheckout: { strictFirstSendCancellation: true, createOrRecover } },
  );
  expect(cap?.mainCheckout).toBeUndefined();
  expect(createOrRecover).not.toHaveBeenCalled();
});
