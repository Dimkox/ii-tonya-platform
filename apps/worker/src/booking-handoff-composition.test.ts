import { afterEach, expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import {
  PostgresBookingHandoffRevocationRepository,
  PostgresWorkerJobsRepository,
  PostgresExpertReferralWorkerRepository,
  PostgresExpertTelegramResidencyCallbackRepository,
  PostgresOutboxRepository,
} from "@ii-tonya/db";

const injected = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@ii-tonya/db", async (original) => {
  const actual = await original<typeof import("@ii-tonya/db")>();
  return {
    ...actual,
    createDb: (...args: Parameters<typeof actual.createDb>) =>
      injected.db ?? actual.createDb(...args),
  };
});
import { createProductionWorkerRuntimeFactory } from "./main.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  injected.db = undefined;
});

it("runs the actual local revocation repository from main with all sending flags off", async () => {
  const execute = vi.fn(async () => ({ rows: [] }));
  const end = vi.fn(async () => {});
  injected.db = { execute, $client: { end } };
  // Unrelated cycle jobs are outside this test. The local withdrawal repository
  // remains real and executes its candidate query against the database boundary.
  vi.spyOn(
    PostgresWorkerJobsRepository.prototype,
    "processDueBatch",
  ).mockResolvedValue({} as never);
  vi.spyOn(
    PostgresWorkerJobsRepository.prototype,
    "expireDueBatch",
  ).mockResolvedValue({} as never);
  vi.spyOn(
    PostgresWorkerJobsRepository.prototype,
    "materializeOperatorCasesBatch",
  ).mockResolvedValue({} as never);
  vi.spyOn(
    PostgresExpertReferralWorkerRepository.prototype,
    "expireDueBatch",
  ).mockResolvedValue({ examined: 0, changed: 0, failed: 0 });
  vi.spyOn(
    PostgresExpertReferralWorkerRepository.prototype,
    "listReconciliationBatch",
  ).mockResolvedValue([]);
  vi.spyOn(
    PostgresExpertReferralWorkerRepository.prototype,
    "replayDueBatch",
  ).mockResolvedValue({ examined: 0, granted: 0, cancelled: 0 });
  vi.spyOn(
    PostgresExpertTelegramResidencyCallbackRepository.prototype,
    "clearExpiredCheckoutUrls",
  ).mockResolvedValue(0);
  vi.spyOn(
    PostgresOutboxRepository.prototype,
    "recoverExpiredDispatchLeases",
  ).mockResolvedValue(0);
  vi.spyOn(
    PostgresOutboxRepository.prototype,
    "recoverExpiredReconciliationLeases",
  ).mockResolvedValue(0);
  const consume = vi.spyOn(
    PostgresBookingHandoffRevocationRepository.prototype,
    "consumePending",
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
  const runtime = await createProductionWorkerRuntimeFactory().create(config);
  const report = await runtime.runOnce();
  await runtime.close();
  expect(report).toHaveProperty("bookingHandoffRevocations", {
    examined: 0,
    processed: 0,
    quarantined: 0,
    operatorRequired: 0,
  });
  expect(consume).toHaveBeenCalledExactlyOnceWith(20);
  expect(consume).toHaveResolvedWith({
    examined: 0,
    processed: 0,
    quarantined: 0,
    operatorRequired: 0,
  });
  expect(execute).toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(end).toHaveBeenCalledOnce();
});
