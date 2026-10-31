import { expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import type { DrizzleDb } from "@ii-tonya/db";
import { createDefaultLifecycle } from "./server.js";
const config = () =>
  loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
const webhook = () =>
  ({
    effectivePeerAddress: () => "185.71.76.1",
    inbox: { claim: vi.fn(), complete: vi.fn(), fail: vi.fn() },
    verify: vi.fn(),
    deliver: vi.fn(),
    resolveSucceeded: vi.fn(),
  }) as never;
it("keeps existing resolver by default and explicitly injects early bird routing only when supplied", async () => {
  const execute = vi
      .fn()
      .mockResolvedValue({ rows: [{ purpose: "MAIN_SUBSCRIPTION" }] }),
    db = { execute } as unknown as DrizzleDb;
  const base = await createDefaultLifecycle({
    yookassaWebhook: webhook(),
  }).dependencies(config(), db);
  expect(
    await base.yookassaWebhook!.resolvePurpose!("p1", "payment.succeeded"),
  ).toBe("MAIN_SUBSCRIPTION");
  expect(execute).toHaveBeenCalledOnce();
  const resolvePurpose = vi.fn().mockResolvedValue("COMBINED_EARLY_BIRD"),
    handle = vi.fn();
  const injected = await createDefaultLifecycle({
    yookassaWebhook: webhook(),
    earlyBirdWebhookRouting: { resolvePurpose, composite: { handle } },
  }).dependencies(config(), db);
  expect(
    await injected.yookassaWebhook!.resolvePurpose!("p1", "payment.succeeded"),
  ).toBe("COMBINED_EARLY_BIRD");
  expect(injected.yookassaWebhook!.composite?.handle).toBe(handle);
});
it("rejects early bird routing when the YooKassa webhook is absent", async () => {
  const lifecycle = createDefaultLifecycle({
    earlyBirdWebhookRouting: {
      resolvePurpose: vi.fn(),
      composite: { handle: vi.fn() },
    },
  });
  expect(() => lifecycle.preflight(config())).toThrow(
    "early_bird_webhook_requires_yookassa",
  );
  await expect(
    lifecycle.dependencies(config(), {} as DrizzleDb),
  ).rejects.toThrow("early_bird_webhook_requires_yookassa");
});
