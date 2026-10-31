import { describe, expect, it } from "vitest";
import type { loadEnv } from "@ii-tonya/config";
import { validateYooKassaWorkerConfig } from "./yookassa-composition.js";
import { selectExpertResidencyProviderReader } from "./main.js";

type Config = ReturnType<typeof loadEnv>;
const config = (value: unknown) => value as Config;

describe("worker YooKassa mode", () => {
  it("accepts the explicitly configured gateway without direct credentials", () => {
    const gatewayConfig = config({
      features: { yookassa: true },
      integrations: { payments: true },
      yookassaGateway: {
        mode: "live",
        workerConfigFile: "/secure/worker.json",
      },
    });
    expect(() => validateYooKassaWorkerConfig(gatewayConfig)).not.toThrow();
    expect(() =>
      selectExpertResidencyProviderReader(gatewayConfig),
    ).not.toThrow();
  });
  it("rejects mixed modes and a missing worker descriptor", () => {
    for (const value of [
      { yookassaGateway: { mode: "live" } },
      {
        yookassaGateway: {
          mode: "live",
          workerConfigFile: "/secure/worker.json",
        },
        yookassa: {
          mode: "live",
          secretReference: "env://YOOKASSA_SECRET_KEY",
        },
      },
    ])
      expect(() =>
        validateYooKassaWorkerConfig(
          config({
            features: { yookassa: true },
            integrations: { payments: true },
            ...value,
          }),
        ),
      ).toThrow("yookassa_worker_configuration_invalid");
  });
});
