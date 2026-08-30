import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { testExpertPromoRoutes } from "./test-expert-promo.js";

const deps = (overrides = {}) => ({
  enabled: true,
  deterministicEnabled: true,
  selartiEnabled: true,
  promptVersion: "v1",
  campaignAvailable: true,
  identity: vi.fn(async () => ({ userId: "user-1" })),
  trial: {
    handle: vi.fn(async () => ({
      kind: "provider",
      outcome: "applied",
      units: 2,
    })),
  },
  ...overrides,
});
describe("test expert promo route", () => {
  it("returns disabled before any identity/provider work", async () => {
    const app = Fastify();
    const d = deps({ enabled: false });
    await app.register(testExpertPromoRoutes, d);
    const r = await app.inject({
      method: "POST",
      url: "/v1/test-expert-promo/message",
      payload: {
        telegramUserId: "1",
        text: "x",
        requestKey: "request-1",
        requestDigest: "a".repeat(64),
      },
    });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ status: "disabled" });
    expect(d.identity).not.toHaveBeenCalled();
    await app.close();
  });
  it("validates identity and invokes exactly one injected trial handler", async () => {
    const app = Fastify();
    const d = deps();
    await app.register(testExpertPromoRoutes, d);
    const payload = {
      telegramUserId: "1",
      text: "x",
      requestKey: "request-1",
      requestDigest: "a".repeat(64),
    };
    await expect(
      app.inject({
        method: "POST",
        url: "/v1/test-expert-promo/message",
        payload,
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await app.inject({
      method: "POST",
      url: "/v1/test-expert-promo/message",
      payload,
    });
    expect(d.trial.handle).toHaveBeenCalledTimes(2);
    const unavailable = deps({ identity: vi.fn(async () => null) });
    const second = Fastify();
    await second.register(testExpertPromoRoutes, unavailable);
    const response = await second.inject({
      method: "POST",
      url: "/v1/test-expert-promo/message",
      payload,
    });
    expect(response.json()).toEqual({ status: "invalid_request" });
    await app.close();
    await second.close();
  });
});
