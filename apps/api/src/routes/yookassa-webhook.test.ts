import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { yookassaWebhookRoutes } from "./yookassa-webhook.js";

const notification = {
  type: "notification",
  event: "payment.succeeded",
  object: { id: "2f4b6d0d-000f-5000-9000-000000000601", ignored: true },
};

const build = async (peer = "185.71.76.4") => {
  const dependencies = {
    effectivePeerAddress: vi.fn(() => peer),
    claim: vi.fn(async () => "claimed" as const),
    verify: vi.fn(async () => ({ verified: true }) as never),
    deliver: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await app.register(yookassaWebhookRoutes, dependencies);
  return { app, dependencies };
};

describe("YooKassa webhook boundary", () => {
  it("accepts an allowlisted signal only after verified durable delivery", async () => {
    const { app, dependencies } = await build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/yookassa",
      payload: notification,
    });
    expect(response.statusCode).toBe(200);
    expect(dependencies.verify).toHaveBeenCalledOnce();
    expect(dependencies.deliver).toHaveBeenCalledOnce();
    expect(dependencies.complete).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects spoofed forwarding from a non-provider effective peer", async () => {
    const { app, dependencies } = await build("203.0.113.10");
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/yookassa",
      headers: { "x-forwarded-for": "185.71.76.4" },
      payload: notification,
    });
    expect(response.statusCode).toBe(403);
    expect(dependencies.verify).not.toHaveBeenCalled();
    await app.close();
  });

  it("releases a claim and returns a sanitized retryable failure", async () => {
    const { app, dependencies } = await build();
    dependencies.deliver.mockRejectedValueOnce(new Error("sensitive"));
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/yookassa",
      payload: notification,
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("sensitive");
    expect(dependencies.release).toHaveBeenCalledOnce();
    await app.close();
  });
});
