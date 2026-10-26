import { it, expect } from "vitest";
import {
  readExpertCardConfig,
  assertExpertCardConfig,
} from "./expert-card-config.js";
it("keeps new tag and notification capabilities default-off and rejects partial flags", () => {
  expect(readExpertCardConfig({})).toBeUndefined();
  for (const flag of [
    "EXPERT_DRAFT_TAGS_ENABLED",
    "RESIDENT_WORKSPACE_NOTIFICATIONS_ENABLED",
  ]) {
    expect(() => readExpertCardConfig({ [flag]: "true" })).toThrow(
      "expert_card_configuration_required",
    );
    expect(() => readExpertCardConfig({ [flag]: "yes" })).toThrow(
      "expert_card_configuration_invalid",
    );
  }
});
it("requires both reviewed UI ceiling and card setting", () => {
  const expertCard = {
    paymentMode: "test" as const,
    materialDeliveryEnabled: false,
    mainCheckoutEnabled: false,
    draftTagsEnabled: true,
    workBotId: "12345",
    workBotKey: "work-fixture",
    workBotUsername: "fixture_work_bot",
    messagingConsentPolicyVersion: "client-messaging-v1",
    webhookSecret: "s".repeat(32),
  };
  expect(() =>
    assertExpertCardConfig({ features: { expertCard: true }, expertCard }),
  ).toThrow("expert_card_configuration_required");
  expect(() =>
    assertExpertCardConfig({
      features: { expertCard: true, expertDraftTags: true },
      expertCard,
    }),
  ).not.toThrow();
});
