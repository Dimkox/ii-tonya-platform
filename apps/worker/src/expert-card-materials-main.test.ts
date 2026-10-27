import { expect, it, vi } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
import { createProductionWorkerRuntimeFactory } from "./main.js";

it("rejects incomplete enabled materials in the actual startup factory before opening a database", async () => {
  const fetcher = vi.fn();
  const factory = createProductionWorkerRuntimeFactory({
    expertCardMaterialFetch: fetcher,
  });
  await expect(
    factory.create({
      features: { expertCardMaterialDelivery: true },
      databaseUrl: "invalid-must-never-open",
    } as unknown as RuntimeConfig),
  ).rejects.toThrow("expert_card_configuration_required");
  expect(fetcher).not.toHaveBeenCalled();
});
