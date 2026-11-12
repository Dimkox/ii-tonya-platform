import { describe, expect, it, vi } from "vitest";
import { PostgresExpertResidencyProviderReader } from "./expert-residency-db-reader.js";
import {
  disabledExpertResidencyProviderReader,
  selectExpertResidencyProviderReader,
} from "./main.js";

const now = new Date("2026-11-04T12:00:00Z");
const fakeDb = (rows: unknown[]) => {
  const execute = vi.fn(async () => ({ rows }));
  return { db: { execute } as never, execute };
};
const query = [{ provider: "yookassa", paymentId: "p1" }];

describe("PostgresExpertResidencyProviderReader", () => {
  it("skips the DB for an empty batch", async () => {
    const { db, execute } = fakeDb([]);
    await expect(
      new PostgresExpertResidencyProviderReader(db).readPayments({
        now,
        payments: [],
      }),
    ).resolves.toEqual({ kind: "available", payments: [] });
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps authenticated events with reversal precedence", async () => {
    const { db } = fakeDb([
      {
        provider: "yookassa",
        paymentId: "p1",
        settledAmounts: ["1000"],
        currencies: ["RUB"],
        kinds: ["settled"],
      },
      {
        provider: "yookassa",
        paymentId: "p2",
        settledAmounts: ["500"],
        currencies: ["RUB"],
        kinds: ["settled", "refunded"],
      },
      {
        provider: "yookassa",
        paymentId: "p3",
        settledAmounts: ["700"],
        currencies: ["RUB"],
        kinds: ["refunded", "charged_back", "settled"],
      },
      {
        provider: "yookassa",
        paymentId: "p4",
        settledAmounts: null,
        currencies: null,
        kinds: ["refunded"],
      },
    ]);
    const out = await new PostgresExpertResidencyProviderReader(
      db,
    ).readPayments({ now, payments: query });
    expect(
      out.payments.map((p) => [p.paymentId, p.status, p.amountMinor]),
    ).toEqual([
      ["p1", "settled", "1000"],
      ["p2", "refunded", "500"],
      ["p3", "charged_back", "700"],
    ]);
  });

  it("fails closed on ambiguous amounts or non-RUB currency", async () => {
    await expect(
      new PostgresExpertResidencyProviderReader(
        fakeDb([
          {
            provider: "yookassa",
            paymentId: "p1",
            settledAmounts: ["1", "2"],
            currencies: ["RUB"],
            kinds: ["settled"],
          },
        ]).db,
      ).readPayments({ now, payments: query }),
    ).rejects.toThrow("ambiguous_expert_residency_provider_amount");
    await expect(
      new PostgresExpertResidencyProviderReader(
        fakeDb([
          {
            provider: "yookassa",
            paymentId: "p1",
            settledAmounts: ["1"],
            currencies: ["USD"],
            kinds: ["settled"],
          },
        ]).db,
      ).readPayments({ now, payments: query }),
    ).rejects.toThrow("invalid_expert_residency_provider_currency");
  });

  it("rejects invalid input and propagates DB errors", async () => {
    const reader = new PostgresExpertResidencyProviderReader(fakeDb([]).db);
    await expect(
      reader.readPayments({ now: new Date(NaN), payments: query }),
    ).rejects.toThrow("invalid_expert_residency_provider_read");
    const failing = {
      execute: vi.fn(async () => {
        throw new Error("db_down");
      }),
    } as never;
    await expect(
      new PostgresExpertResidencyProviderReader(failing).readPayments({
        now,
        payments: query,
      }),
    ).rejects.toThrow("db_down");
  });
});

describe("selectExpertResidencyProviderReader with a DB reader", () => {
  const enabled = {
    features: { yookassa: true },
    yookassaGateway: { mode: "live", workerConfigFile: "/secure/worker.json" },
  } as never;
  it("uses the DB reader only behind the yookassa flag", () => {
    const reader = { readPayments: vi.fn() } as never;
    const factory = vi.fn(() => reader);
    expect(
      selectExpertResidencyProviderReader(enabled, undefined, factory),
    ).toBe(reader);
    expect(
      selectExpertResidencyProviderReader(
        { features: { yookassa: false } } as never,
        undefined,
        factory,
      ),
    ).toBe(disabledExpertResidencyProviderReader);
    expect(factory).toHaveBeenCalledOnce();
  });
});
