import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
import type { ExpertMaterialTransport } from "@ii-tonya/integrations";
import {
  createExpertResidencyLifecycleWorker,
  assertExpertResidencyLifecycleWorkerConfig,
} from "./expert-residency-lifecycle-composition.js";
const token = `12345:${"synthetic_fixture_".repeat(2)}`;
function config(enabled = false, delivery = false): RuntimeConfig {
  return {
    features: {
      expertCard: false,
      expertCardMaterialDelivery: false,
      expertResidencyLifecycle: enabled,
      expertResidencyNoticeDelivery: delivery,
      expertResidencyLifecycleCommands: false,
    },
    expertResidencyLifecycle: {
      enabled,
      noticeDeliveryEnabled: delivery,
      commandsEnabled: false,
      renewalCheckoutEnabled: false,
    },
    ...(enabled || delivery
      ? {
          expertCard: {
            paymentMode: "test",
            materialDeliveryEnabled: false,
            mainCheckoutEnabled: false,
            ...(delivery ? { workBotToken: token } : {}),
            workBotId: "12345",
            workBotKey: "work-fixture",
            workBotUsername: "fixture_work_bot",
            messagingConsentPolicyVersion: "client-messaging-v1",
            webhookSecret: "s".repeat(32),
          },
        }
      : {}),
  } as unknown as RuntimeConfig;
}
function repository() {
  return {
    processLifecycleBatch: vi.fn(async () => ({
      examined: 1,
      billsCreated: 1,
      noticesCreated: 1,
      suspended: 0,
      resumed: 0,
    })),
    listDueNotices: vi.fn(async () => []),
    deliverNotice: vi.fn(async () => ({ kind: "unavailable" as const })),
  };
}
it("default-off constructs neither repository nor transport", () => {
  const createRepository = vi.fn(),
    fetcher = vi.fn();
  expect(
    createExpertResidencyLifecycleWorker(config(), {
      createRepository,
      fetch: fetcher,
    }),
  ).toBeUndefined();
  expect(createRepository).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects incomplete notice delivery before constructing any dependency", () => {
  expect(() =>
    assertExpertResidencyLifecycleWorkerConfig({
      features: { expertResidencyNoticeDelivery: true },
    } as unknown as RuntimeConfig),
  ).toThrow();
});
it("requires repository capability when calendar or notice work is enabled", () => {
  expect(() => createExpertResidencyLifecycleWorker(config(true))).toThrow(
    "expert_residency_lifecycle_capability_required",
  );
  expect(() =>
    createExpertResidencyLifecycleWorker(config(false, true)),
  ).toThrow("expert_residency_lifecycle_capability_required");
});
it("does not construct a Telegram transport for DB-only calendar reconciliation", async () => {
  const repo = repository(),
    fetcher = vi.fn();
  const createRepository = vi.fn((transport?: ExpertMaterialTransport) => {
    expect(transport).toBeUndefined();
    return repo;
  });
  const worker = createExpertResidencyLifecycleWorker(config(true), {
    createRepository,
    fetch: fetcher,
  });
  expect(await worker!.runOnce()).toMatchObject({
    lifecycle: { billsCreated: 1 },
    notices: { reason: "disabled" },
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(repo.listDueNotices).not.toHaveBeenCalled();
  worker!.stopAccepting();
});
it("delivery-only worker composes real bounded Telegram transport without new admissions or DB calendar creation", async () => {
  const payload = { text: "Synthetic approved lifecycle notice", assets: [] };
  const payloadDigest = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 23,
            from: { id: 12345, is_bot: true },
            chat: { id: 67890, type: "private" },
          },
        }),
        { status: 200 },
      );
    },
  );
  const repo = {
    ...repository(),
    listDueNotices: async () => [
      { noticeId: "00000000-0000-4000-8000-000000000001" },
    ],
  };
  const createRepository = vi.fn((transport?: ExpertMaterialTransport) => ({
    ...repo,
    deliverNotice: async (
      _id: string,
      { signal }: { signal?: AbortSignal } = {},
    ) => {
      expect(signal).toBeDefined();
      const receipt = await transport!.send({
        botId: "12345",
        botKey: "work-fixture",
        userId: "00000000-0000-4000-8000-000000000002",
        chatId: "67890",
        reviewId: "00000000-0000-4000-8000-000000000003",
        revision: 1,
        contentVersion: "lifecycle.seven_day.v1",
        payloadDigest,
        payload,
        signal: signal!,
      });
      expect(receipt.messageIds).toEqual(["23"]);
      return { kind: "delivered" as const };
    },
  }));
  const worker = createExpertResidencyLifecycleWorker(config(false, true), {
    createRepository,
    fetch: fetcher,
  });
  expect(await worker!.runOnce()).toMatchObject({
    lifecycle: { reason: "disabled" },
    notices: { delivered: 1 },
  });
  expect(repo.processLifecycleBatch).not.toHaveBeenCalled();
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `https://api.telegram.org/bot${token}/sendMessage`,
  );
  worker!.stopAccepting();
});
it("fails closed when dedicated feature and manual settings disagree", () => {
  const c = config(true);
  c.features.expertResidencyLifecycle = false;
  expect(() => assertExpertResidencyLifecycleWorkerConfig(c)).toThrow();
});
