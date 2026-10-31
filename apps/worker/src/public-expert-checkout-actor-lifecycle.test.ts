import { expect, it } from "vitest";
import { composePublicExpertWorkerRuntime } from "./main.js";
it("slow sales and renewal checkout actors cannot block privacy, refunds or each other and drain before DB close", async () => {
  const calls: string[] = [];
  let normal = 0,
    recovery = 0,
    sales = 0,
    renewal = 0,
    finishSales!: () => void,
    finishRenewal!: () => void;
  const jobs = [
    {
      runOnce: async () => {
        sales++;
        await new Promise<void>((resolve) => {
          finishSales = resolve;
        });
        calls.push("sales-drained");
      },
      stopAccepting: () => {
        calls.push("sales-stop");
        finishSales();
      },
    },
    {
      runOnce: async () => {
        renewal++;
        await new Promise<void>((resolve) => {
          finishRenewal = resolve;
        });
        calls.push("renewal-drained");
      },
      stopAccepting: () => {
        calls.push("renewal-stop");
        finishRenewal();
      },
    },
  ];
  const runtime = composePublicExpertWorkerRuntime(
    {
      runOnce: async () => {
        normal++;
        calls.push("safety+privacy");
        return {} as never;
      },
      close: async () => {
        calls.push("database-close");
      },
    },
    {
      runOnce: async () => {
        recovery++;
        calls.push("refund-opportunity");
      },
      stop: async () => {
        calls.push("provider-abort");
      },
    },
    jobs,
  );
  for (let cycle = 0; cycle < 6; cycle++) await runtime.runOnce();
  expect(normal).toBe(6);
  expect(recovery).toBe(6);
  expect(sales).toBe(1);
  expect(renewal).toBe(1);
  await runtime.close();
  await runtime.close();
  expect(calls.filter((call) => call === "sales-stop")).toHaveLength(1);
  expect(calls.filter((call) => call === "renewal-stop")).toHaveLength(1);
  expect(calls.indexOf("sales-drained")).toBeLessThan(
    calls.indexOf("database-close"),
  );
  expect(calls.indexOf("renewal-drained")).toBeLessThan(
    calls.indexOf("database-close"),
  );
});
it("checkout actor failure leaves recovery and ordinary work alive and consumes no orphan rejection", async () => {
  let normal = 0,
    recovery = 0,
    stopped = 0;
  const runtime = composePublicExpertWorkerRuntime(
    {
      runOnce: async () => {
        normal++;
        return {} as never;
      },
      close: async () => {},
    },
    {
      runOnce: async () => {
        recovery++;
      },
      stop: async () => {},
    },
    [
      {
        runOnce: async () => {
          throw Error("checkout-unavailable");
        },
        stopAccepting: () => {
          stopped++;
        },
      },
    ],
  );
  await runtime.runOnce();
  await runtime.runOnce();
  await runtime.close();
  expect(normal).toBe(2);
  expect(recovery).toBe(2);
  expect(stopped).toBe(1);
});
