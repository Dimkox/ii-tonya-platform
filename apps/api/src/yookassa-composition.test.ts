import { describe, expect, it, vi } from "vitest";
import { buildTestApp } from "./app.js";
import type { YooKassaWebhookDependencies } from "./routes/yookassa-webhook.js";

const capability = (): YooKassaWebhookDependencies => ({
  effectivePeerAddress: () => "185.71.76.4",
  inbox: {
    claim: vi.fn(async () => ({
      kind: "claimed" as const,
      claimId: "claim-1",
    })),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  },
  verify: vi.fn(async () => ({ verified: true }) as never),
  deliver: vi.fn(async () => undefined),
  resolveSucceeded: vi.fn(async () => undefined),
});

const enabledFeatures = {
  expertReferral: false,
  expertResidencyBilling: false,
  yookassa: true,
};

describe("YooKassa API composition", () => {
  it("keeps the webhook absent by default", async () => {
    const app = await buildTestApp();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/webhooks/yookassa",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("fails closed when configuration and capability do not match", async () => {
    await expect(buildTestApp({ features: enabledFeatures })).rejects.toThrow(
      "YooKassa runtime capability is required",
    );
    await expect(
      buildTestApp({ yookassaWebhook: capability() }),
    ).rejects.toThrow("YooKassa runtime capability is required");
  });

  it("registers the webhook only for exact enabled composition", async () => {
    const app = await buildTestApp({
      features: enabledFeatures,
      yookassaWebhook: capability(),
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/webhooks/yookassa",
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});
