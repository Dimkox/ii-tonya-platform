import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { ExpertMaterialTransport } from "@ii-tonya/integrations";
import type { RuntimeConfig } from "@ii-tonya/config";
import {
  createExpertCardMaterialsLifecycle,
  assertExpertCardMaterialsWorkerConfig,
} from "./expert-card-materials-composition.js";
const token = `12345:${"synthetic_fixture_".repeat(2)}`;
const config = (enabled = true) =>
  ({
    features: { expertCard: false, expertCardMaterialDelivery: enabled },
    ...(enabled
      ? {
          expertCard: {
            paymentMode: "test",
            materialDeliveryEnabled: true,
            workBotToken: token,
            workBotId: "12345",
            workBotKey: "work-fixture",
            workBotUsername: "fixture_work_bot",
            messagingConsentPolicyVersion: "client-messaging-v1",
            webhookSecret: "s".repeat(32),
          },
        }
      : {}),
  }) as unknown as RuntimeConfig;
it("leaves provider and repository unconstructed while default disabled", () => {
  const createRepository = vi.fn();
  const fetcher = vi.fn();
  expect(
    createExpertCardMaterialsLifecycle(config(false), {
      createRepository,
      fetch: fetcher,
    }),
  ).toBeUndefined();
  expect(createRepository).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects enabled incomplete configuration before constructing runtime dependencies", () => {
  expect(() =>
    assertExpertCardMaterialsWorkerConfig({
      features: { expertCardMaterialDelivery: true },
    } as unknown as RuntimeConfig),
  ).toThrow("expert_card_configuration_required");
});
it("requires the dedicated delivery flag rather than a loose settings boolean", () => {
  const c = config();
  c.features.expertCardMaterialDelivery = false;
  expect(() => assertExpertCardMaterialsWorkerConfig(c)).toThrow(
    "expert_card_material_worker_configuration_invalid",
  );
});
it("fails closed if no repository composition is supplied", () => {
  expect(() => createExpertCardMaterialsLifecycle(config())).toThrow(
    "expert_card_material_capability_required",
  );
});
it("worker-only mode composes actual transport and sends only through repository-owned due work", async () => {
  const payload = { text: "Synthetic approved material", assets: [] };
  const payloadDigest = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 17,
            from: { id: 12345, is_bot: true },
            chat: { id: 67890, type: "private" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  const createRepository = vi.fn((transport: ExpertMaterialTransport) => ({
    listDueMaterialJobs: async () => [
      { jobId: "00000000-0000-4000-8000-000000000001" },
    ],
    deliverMaterials: async (
      _jobId: string,
      { signal }: { signal: AbortSignal },
    ) => {
      const receipt = await transport.send({
        botId: "12345",
        botKey: "work-fixture",
        userId: "00000000-0000-4000-8000-000000000002",
        chatId: "67890",
        reviewId: "00000000-0000-4000-8000-000000000003",
        revision: 1,
        contentVersion: "synthetic-v1",
        payloadDigest,
        payload,
        signal,
      });
      expect(receipt.messageIds).toEqual(["17"]);
      return { kind: "delivered" as const };
    },
  }));
  const lifecycle = createExpertCardMaterialsLifecycle(config(), {
    createRepository,
    fetch: fetcher,
  });
  expect(lifecycle).toBeDefined();
  expect(await lifecycle!.runOnce()).toMatchObject({
    examined: 1,
    delivered: 1,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `https://api.telegram.org/bot${token}/sendMessage`,
  );
  lifecycle!.stopAccepting();
});
