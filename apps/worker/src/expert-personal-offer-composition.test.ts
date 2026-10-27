import { expect, it, vi } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
const sent = vi.hoisted(() => [] as string[]);
vi.mock("@ii-tonya/integrations", () => ({
  createExpertMaterialTransport: (scope: {
    botId: string;
    botKey: string;
  }) => ({
    send: async () => {
      sent.push(scope.botKey);
      return { botId: scope.botId };
    },
  }),
}));
import {
  createPersonalOfferNoticeTransport,
  assertPersonalOfferNoticeConfig,
} from "./expert-personal-offer-composition.js";
it("actual notice transport routes only exact configured promo and work bot scopes", async () => {
  const config = {
    features: { expertResidencyNoticeDelivery: true, expertApplicant: true },
    expertCard: {
      workBotId: "10001",
      workBotKey: "work",
      workBotToken: "10001:" + "w".repeat(35),
    },
    expertApplicant: {
      botId: "20002",
      botKey: "promo",
      botToken: "20002:" + "p".repeat(35),
    },
  } as RuntimeConfig;
  const transport = createPersonalOfferNoticeTransport(config);
  await transport.send({ botId: "20002", botKey: "promo" } as never);
  await transport.send({ botId: "10001", botKey: "work" } as never);
  expect(sent).toEqual(["promo", "work"]);
  await expect(
    transport.send({ botId: "10001", botKey: "promo" } as never),
  ).rejects.toThrow("personal_offer_notice_scope_unavailable");
  expect(sent).toHaveLength(2);
});

it("requires a dedicated exact promo token only with both applicant and notice delivery enabled", () => {
  expect(() =>
    assertPersonalOfferNoticeConfig({ features: {} } as RuntimeConfig),
  ).not.toThrow();
  const config = {
    features: { expertApplicant: true, expertResidencyNoticeDelivery: true },
    expertApplicant: { botId: "20002" },
  } as RuntimeConfig;
  expect(() => assertPersonalOfferNoticeConfig(config)).toThrow(
    "personal_offer_promo_notice_configuration_required",
  );
  config.expertApplicant!.botToken = "10001:" + "p".repeat(35);
  expect(() => assertPersonalOfferNoticeConfig(config)).toThrow(
    "personal_offer_promo_notice_configuration_required",
  );
  config.expertApplicant!.botToken = "20002:" + "p".repeat(35);
  expect(() => assertPersonalOfferNoticeConfig(config)).not.toThrow();
  config.expertApplicant!.botToken += "\n";
  expect(() => assertPersonalOfferNoticeConfig(config)).toThrow(
    "personal_offer_promo_notice_configuration_required",
  );
});
