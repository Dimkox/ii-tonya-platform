import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import {
  minPaymentDeadline,
  normalizeDatabaseMoney,
  releaseAmountFromReservation,
  parseMoneySnapshot,
  validateTariffVersionCommand,
  PostgresExpertResidencyRepository,
} from "./expert-residency-repository.js";

describe("expert residency repository boundaries", () => {
  it("returns the database-ordered active tariff projection with a hard limit", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            version: 1,
            newCommandsEnabled: true,
            rewardGrantsEnabled: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ active: true, verified: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000102",
            displayName: "Two months",
            priceMinor: "300001",
            currency: "RUB",
            durationSeconds: 5_184_000,
          },
          {
            id: "00000000-0000-4000-8000-000000000103",
            displayName: "Three months",
            priceMinor: 400002n,
            currency: "RUB",
            durationSeconds: 7_776_000,
          },
        ],
      });
    const db = {
      transaction: async (work: (tx: { execute: typeof execute }) => unknown) =>
        work({ execute }),
    } as unknown as DrizzleDb;

    await expect(
      new PostgresExpertResidencyRepository(db).listActiveTariffs({
        expertId: "00000000-0000-4000-8000-000000000101",
        limit: 20,
      }),
    ).resolves.toEqual([
      {
        tariffVersionId: "00000000-0000-4000-8000-000000000102",
        displayName: "Two months",
        priceMinor: "300001",
        currency: "RUB",
        durationSeconds: 5_184_000,
      },
      {
        tariffVersionId: "00000000-0000-4000-8000-000000000103",
        displayName: "Three months",
        priceMinor: "400002",
        currency: "RUB",
        durationSeconds: 7_776_000,
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("serializes money and uses the earliest deadline", () => {
    expect(
      parseMoneySnapshot({
        priceMinor: 250001n,
        creditMinor: 125000n,
        cashMinor: 125001n,
      }),
    ).toEqual({
      priceMinor: "250001",
      creditMinor: "125000",
      cashMinor: "125001",
    });
    expect(
      minPaymentDeadline(
        new Date("2026-08-03T12:00:00Z"),
        new Date("2026-08-03T11:00:00Z"),
      ),
    ).toEqual(new Date("2026-08-03T11:00:00Z"));
  });

  it("normalizes raw PostgreSQL bigint strings before arithmetic", () => {
    expect(normalizeDatabaseMoney("250001", "tariff.priceMinor")).toBe(250001n);
    expect(releaseAmountFromReservation("-125000")).toBe(125000n);
  });

  it.each([
    { priceMinor: 0n },
    { priceMinor: -1n },
    { priceMinor: 1_000_000_000_000n },
    { priceMinor: Number.NaN as unknown as bigint },
    { priceMinor: 1.5 as unknown as bigint },
    { priceMinor: Number.MAX_SAFE_INTEGER as unknown as bigint },
    { durationSeconds: Number.NaN },
    { durationSeconds: 86400.5 },
    { durationSeconds: Number.MAX_SAFE_INTEGER + 1 },
    { tariffKey: "" },
    { tariffKey: "x".repeat(129) },
    { displayName: "   " },
    { displayName: "x".repeat(257) },
  ])("rejects unstable tariff input %#", (override) => {
    expect(() =>
      validateTariffVersionCommand({
        tariffKey: "base",
        displayName: "Base",
        priceMinor: 100000n,
        durationSeconds: 86400,
        activeFrom: new Date("2026-08-03T10:00:00Z"),
        activeTo: new Date("2026-08-04T10:00:00Z"),
        approvalId: "00000000-0000-4000-8000-000000000001",
        adminSessionIdHash: "session",
        ...override,
      }),
    ).toThrowError(/Invalid tariff version/);
  });
});
