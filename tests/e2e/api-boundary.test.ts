import { describe, expect, it } from "vitest";
import { buildTestApp } from "../../apps/api/src/app.js";
import { loadEnv } from "../../packages/config/src/env.js";

describe("hardened API boundary", () => {
  it("exposes only approved public ingress and health routes", async () => {
    const app = await buildTestApp();
    expect(
      (await app.inject({ method: "GET", url: "/health/live" })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/health/ready" })).statusCode,
    ).toBe(200);
    for (const url of [
      "/v1/webhooks/make",
      "/v1/webhooks/sheets",
      "/v1/payments/webhook",
    ]) {
      expect(
        (await app.inject({ method: "POST", url, payload: {} })).statusCode,
      ).toBe(404);
    }
    await app.close();
  });

  it("keeps every live integration disabled by default and rejects incomplete activation", () => {
    const localEnv = {
      DATABASE_URL: "postgres://ii_tonya:placeholder@localhost:5432/ii_tonya",
      ALLOW_INSECURE_LOCAL_DATABASE: "true",
    };
    expect(loadEnv(localEnv).integrations).toEqual({
      selarti: false,
      planerka: false,
      telegram: false,
      makeProjection: false,
      intentModel: false,
      payments: false,
    });
    for (const flag of [
      "SELARTI_ENABLED",
      "PLANERKA_ENABLED",
      "TELEGRAM_ENABLED",
      "MAKE_PROJECTION_ENABLED",
      "INTENT_MODEL_ENABLED",
      "PAYMENTS_ENABLED",
    ]) {
      expect(() => loadEnv({ ...localEnv, [flag]: "true" }), flag).toThrow();
    }
  });
});
