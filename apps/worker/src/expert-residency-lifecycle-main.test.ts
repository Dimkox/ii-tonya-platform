import { expect, it, vi } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
import { createProductionWorkerRuntimeFactory } from "./main.js";

it("actual startup rejects incomplete notice capability before opening a database or calling Telegram", async () => {
  const fetcher = vi.fn();
  const factory = createProductionWorkerRuntimeFactory({
    expertResidencyNoticeFetch: fetcher,
  });
  await expect(
    factory.create({
      features: { expertResidencyNoticeDelivery: true },
      databaseUrl: "invalid-must-never-open",
    } as unknown as RuntimeConfig),
  ).rejects.toThrow("expert_residency_lifecycle_configuration_required");
  expect(fetcher).not.toHaveBeenCalled();
});
