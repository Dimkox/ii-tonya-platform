import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../../apps/api/src/app.js";

describe("hardened API boundary", () => {
  it("exposes only approved public ingress and health routes", async () => {
    const app = await buildTestApp();
    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(200);
    for (const url of ["/v1/webhooks/make", "/v1/webhooks/sheets", "/v1/payments/webhook"]) {
      expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(404);
    }
    await app.close();
  });

  it("keeps every live integration flag literal false", () => {
    const source = readFileSync("packages/config/src/env.ts", "utf8");
    for (const flag of ["SELARTI_ENABLED", "PLANERKA_ENABLED", "TELEGRAM_ENABLED", "MAKE_PROJECTION_ENABLED", "INTENT_MODEL_ENABLED", "PAYMENTS_ENABLED"]) {
      expect(source).toContain(`${flag}: z.literal("false")`);
    }
  });
});
