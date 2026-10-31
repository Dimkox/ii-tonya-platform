import { expect, it } from "vitest";
import * as main from "./main.js";
import { createWorkerRuntime } from "./runtime.js";
import { createSeparatedSalesRunner } from "./expert-separated-sales-composition.js";
function normal(calls: string[]) {
  const idle = async () => ({});
  return createWorkerRuntime({
    safetyHandoffs: async () => {
      calls.push("safety");
    },
    recoverExpiredLeases: idle,
    reconcileUnknownOutcomes: idle,
    reservationExpiry: idle,
    expertResidencyExpiry: idle,
    expertTelegramCheckoutCleanup: idle,
    expertResidencyReconciliation: idle,
    expertReferralHoldReplay: idle,
    deliverConfirmedOutbox: idle,
    processorPrivacy: async () => {
      calls.push("privacy");
    },
    providerReconciliation: idle,
    closeDatabase: async () => {
      calls.push("database-close");
    },
    closeTelemetry: async () => {},
  });
}
it("sustained public backlog cannot block safety or privacy and never overlaps a public pass", async () => {
  const compose = main.composePublicExpertWorkerRuntime;
  expect(compose).toBeTypeOf("function");
  if (!compose) return;
  const calls: string[] = [];
  let release!: () => void,
    started = 0,
    settled = false;
  const runtime = compose(normal(calls), {
    runOnce: async () => {
      started++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      settled = true;
    },
    stop: async () => {
      calls.push("abort-public");
      release();
    },
  });
  for (let cycle = 0; cycle < 8; cycle++) await runtime.runOnce();
  expect(calls.filter((call) => call === "safety")).toHaveLength(8);
  expect(calls.filter((call) => call === "privacy")).toHaveLength(8);
  expect(started).toBe(1);
  await runtime.close();
  expect(settled).toBe(true);
  expect(calls.indexOf("abort-public")).toBeLessThan(
    calls.indexOf("database-close"),
  );
});
it("failed public passes do not suppress ordinary privacy and shutdown drains both lifecycles", async () => {
  const compose = main.composePublicExpertWorkerRuntime;
  expect(compose).toBeTypeOf("function");
  if (!compose) return;
  const calls: string[] = [];
  const runtime = compose(normal(calls), {
    runOnce: async () => {
      throw Error("provider-unavailable");
    },
    stop: async () => {
      calls.push("public-stop");
    },
  });
  await runtime.runOnce();
  await runtime.runOnce();
  await runtime.close();
  expect(calls.filter((call) => call === "privacy")).toHaveLength(2);
  expect(calls).toContain("database-close");
});
it("failed stop still drains the active public pass before the database closes", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const runtime = main.composePublicExpertWorkerRuntime(normal(calls), {
    runOnce: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    stop: async () => {
      throw Error("stop-failed");
    },
  });
  await runtime.runOnce();
  const closed = runtime.close();
  const caught = closed.catch((error) => error);
  await Promise.resolve();
  expect(calls).not.toContain("database-close");
  release();
  expect(await caught).toMatchObject({ message: "stop-failed" });
  expect(calls).toContain("database-close");
});
it("ordinary sales delegates public held recovery to the background owner", async () => {
  let reconciled = 0;
  const held = {
    strictFirstSendCancellation: true as const,
    recoverCheckout: async () => ({ kind: "pending" as const }),
    reconcileKnown: async () => {
      reconciled++;
    },
  };
  const runner = createSeparatedSalesRunner(
    { execute: async () => ({ rows: [] }) } as never,
    {
      features: { expertSeparatedSales: true, expertHeldOnboarding: true },
      expertApplicant: { botId: "1", botKey: "test" },
    } as never,
    undefined,
    undefined,
    held,
    "runtime",
  )!;
  await runner.runOnce();
  expect(reconciled).toBe(0);
  runner.stopAccepting();
});
