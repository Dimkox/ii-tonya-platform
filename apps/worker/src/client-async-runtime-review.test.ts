import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const fixture = vi.hoisted(() => ({
  execute: undefined as
    undefined | ((query: unknown) => Promise<{ rows: unknown[] }>),
  events: [] as string[],
  otherBotState: "processing",
  unscopedRecoveries: 0,
}));
vi.mock("@ii-tonya/db", async (original) => {
  const actual = await original<typeof import("@ii-tonya/db")>();
  const executor = { execute: (query: unknown) => fixture.execute!(query) };
  return {
    ...actual,
    createDb: () => ({
      ...executor,
      transaction: async (fn: (tx: typeof executor) => Promise<unknown>) =>
        fn(executor),
      $client: {
        end: async () => {
          fixture.events.push("close");
        },
      },
    }),
    PostgresWorkerJobsRepository: class {
      async processDueBatch() {
        fixture.events.push("safety");
        return {};
      }
      async expireDueBatch() {
        fixture.events.push("reservation-expiry");
        return {};
      }
      async materializeOperatorCasesBatch() {
        fixture.events.push("local-materialization");
        return {};
      }
    },
    PostgresExpertReferralWorkerRepository: class {
      async expireDueBatch() {
        fixture.events.push("residency-expiry");
        return { examined: 0, changed: 0, failed: 0 };
      }
      async replayDueBatch() {
        fixture.events.push("reward-replay");
        return { examined: 0, granted: 0, cancelled: 0 };
      }
      async listReconciliationBatch() {
        fixture.events.push("residency-reconciliation");
        return [];
      }
    },
    PostgresExpertTelegramResidencyCallbackRepository: class {
      async clearExpiredCheckoutUrls() {
        fixture.events.push("checkout-cleanup");
        return 0;
      }
    },
  };
});
import { createProductionWorkerRuntimeFactory } from "./main.js";

beforeEach(() => {
  fixture.events = [];
  fixture.otherBotState = "processing";
  fixture.unscopedRecoveries = 0;
  const dialect = new PgDialect();
  fixture.execute = async (query) => {
    const compiled = dialect.sqlToQuery(
      query as Parameters<typeof dialect.sqlToQuery>[0],
    );
    const text = compiled.sql.replace(/\s+/gu, " ");
    // Model only the DB boundary's recovery effect. No PostgreSQL, races or provider calls.
    if (
      text.includes("dispatch_lease_expired_unknown_outcome") ||
      text.includes("reconciliation_lease_expired")
    ) {
      const scoped =
        /\band topic (?:=|in\b)/u.test(text) ||
        text.includes("scoped_dialogue.bot_key");
      if (!scoped) {
        fixture.otherBotState = "unknown_outcome";
        fixture.unscopedRecoveries++;
      }
      fixture.events.push(scoped ? "filtered-recovery" : "unscoped-recovery");
    }
    return { rows: [] };
  };
});

describe("production factory recovery ownership (non-PG)", () => {
  for (const workerEnabled of [false, true]) {
    it(`keeps another bot untouched with client runner and worker registry=${workerEnabled}`, async () => {
      const factory = createProductionWorkerRuntimeFactory({
        clientAsyncCapabilities: {
          telegram: {
            sendMessageUrl: new URL("https://invalid.test"),
            transport: {
              request: async () => {
                throw new Error("no provider calls");
              },
            },
          },
        },
        ...(workerEnabled
          ? {
              workerOutboxRegistryFactory: () => ({
                topics: [
                  "safety.operator_escalation",
                  "admin.negative_feedback",
                ] as const,
                dispatch: async () => ({ kind: "applied" as const }),
                reconcile: async () => ({ kind: "still_unknown" as const }),
              }),
            }
          : {}),
      });
      const runtime = await factory.create({
        databaseUrl: "unused-boundary",
        clientTelegramBotKey: "synthetic-bot",
        integrations: { payments: false },
        features: {
          b2TelegramDispatch: true,
          telegramEgressConsentGate: true,
          workerOutboxDelivery: workerEnabled,
        },
      } as never);
      const report = await runtime.runOnce();
      await runtime.close();
      expect(fixture.otherBotState).toBe("processing");
      expect(fixture.unscopedRecoveries).toBe(0);
      expect(report.expiredLeaseRecovery).toEqual({
        dispatch: 0,
        reconciliation: 0,
        reason: "owned_by_filtered_runner",
      });
      expect(fixture.events).toEqual(
        expect.arrayContaining([
          "safety",
          "reservation-expiry",
          "residency-expiry",
          "checkout-cleanup",
          "reward-replay",
          "residency-reconciliation",
          "filtered-recovery",
          "close",
        ]),
      );
      expect(fixture.events.includes("local-materialization")).toBe(
        !workerEnabled,
      );
    });
  }
  it("preserves fallback recovery when no filtered runner owns the work", async () => {
    const runtime = await createProductionWorkerRuntimeFactory().create({
      databaseUrl: "unused-boundary",
      integrations: { payments: false },
      features: {},
    } as never);
    await runtime.runOnce();
    await runtime.close();
    expect(fixture.unscopedRecoveries).toBeGreaterThan(0);
    expect(fixture.events).toContain("local-materialization");
  });
});
