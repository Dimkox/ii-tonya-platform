import { expect, it, vi } from "vitest";
import { createExpertResidencyLifecycleRunner } from "./expert-residency-lifecycle.js";
const counts = {
  examined: 2,
  billsCreated: 1,
  noticesCreated: 2,
  suspended: 1,
  resumed: 0,
};
function repository() {
  return {
    processLifecycleBatch: vi.fn(
      async (limit: number, options?: { signal?: AbortSignal }) => {
        void options;
        void limit;
        return counts;
      },
    ),
    listDueNotices: vi.fn(async (limit: number) => {
      void limit;
      return [{ noticeId: "notice-one" }];
    }),
    deliverNotice: vi.fn(
      async (noticeId: string, options: { signal: AbortSignal }) => {
        void noticeId;
        void options;
        return { kind: "delivered" as const };
      },
    ),
  };
}
it("runs bounded DB calendar evaluation before real notice delivery without a host clock", async () => {
  const repo = repository();
  const runner = createExpertResidencyLifecycleRunner({
    enabled: true,
    deliveryEnabled: true,
    repository: repo,
    batchSize: 3,
  });
  expect(await runner.runOnce()).toMatchObject({
    lifecycle: counts,
    notices: { examined: 1, delivered: 1 },
  });
  expect(repo.processLifecycleBatch).toHaveBeenCalledWith(3, {
    signal: expect.any(AbortSignal),
  });
  expect(repo.listDueNotices).toHaveBeenCalledWith(3);
  expect(repo.processLifecycleBatch.mock.invocationCallOrder[0]).toBeLessThan(
    repo.listDueNotices.mock.invocationCallOrder[0]!,
  );
  expect(repo.deliverNotice.mock.calls[0]?.[1].signal.aborted).toBe(false);
});
it("keeps DB coverage and due bill work running with external delivery off", async () => {
  const repo = repository();
  const runner = createExpertResidencyLifecycleRunner({
    enabled: true,
    deliveryEnabled: false,
    repository: repo,
  });
  expect(await runner.runOnce()).toMatchObject({
    lifecycle: counts,
    notices: { reason: "disabled", examined: 0 },
  });
  expect(repo.listDueNotices).not.toHaveBeenCalled();
  expect(repo.deliverNotice).not.toHaveBeenCalled();
});
it("can drain previously approved notices with new lifecycle creation off", async () => {
  const repo = repository();
  const runner = createExpertResidencyLifecycleRunner({
    enabled: false,
    deliveryEnabled: true,
    repository: repo,
  });
  expect(await runner.runOnce()).toMatchObject({
    lifecycle: { reason: "disabled", examined: 0 },
    notices: { delivered: 1 },
  });
  expect(repo.processLifecycleBatch).not.toHaveBeenCalled();
});
it("default-off creates no repository work", async () => {
  expect(
    await createExpertResidencyLifecycleRunner({
      enabled: false,
      deliveryEnabled: false,
    }).runOnce(),
  ).toMatchObject({ reason: "disabled" });
});
it.each([0, 51, 1.5])(
  "rejects invalid bound %s before repository work",
  (batchSize) => {
    expect(() =>
      createExpertResidencyLifecycleRunner({
        enabled: true,
        deliveryEnabled: false,
        repository: repository(),
        batchSize,
      }),
    ).toThrow("expert_residency_lifecycle_batch_invalid");
  },
);
it("fails enabled startup closed without complete capabilities", () => {
  expect(() =>
    createExpertResidencyLifecycleRunner({
      enabled: true,
      deliveryEnabled: false,
    }),
  ).toThrow("expert_residency_lifecycle_capability_required");
  expect(() =>
    createExpertResidencyLifecycleRunner({
      enabled: false,
      deliveryEnabled: true,
    }),
  ).toThrow("expert_residency_lifecycle_capability_required");
});
it("never counts uncertain outcomes as confirmed or retries them in one cycle", async () => {
  const repo = {
    ...repository(),
    listDueNotices: async () => [
      { noticeId: "unknown" },
      { noticeId: "missing" },
    ],
    deliverNotice: vi.fn(async (id: string) => ({
      kind:
        id === "unknown"
          ? ("unknown_outcome" as const)
          : ("waiting_content" as const),
    })),
  };
  const result = await createExpertResidencyLifecycleRunner({
    enabled: true,
    deliveryEnabled: true,
    repository: repo,
  }).runOnce();
  expect(result.notices).toMatchObject({
    examined: 2,
    unknown: 1,
    waitingContent: 1,
    delivered: 0,
  });
  expect(repo.deliverNotice).toHaveBeenCalledTimes(2);
});
it("aborts a current send and prevents later claims on shutdown", async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const repo = {
    ...repository(),
    listDueNotices: async () => [{ noticeId: "one" }, { noticeId: "two" }],
    deliverNotice: vi.fn(
      async (_id: string, { signal }: { signal: AbortSignal }) => {
        entered();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return { kind: "unknown_outcome" as const };
      },
    ),
  };
  const runner = createExpertResidencyLifecycleRunner({
    enabled: true,
    deliveryEnabled: true,
    repository: repo,
  });
  const active = runner.runOnce();
  await started;
  runner.stopAccepting();
  expect((await active).notices.unknown).toBe(1);
  expect(repo.deliverNotice).toHaveBeenCalledTimes(1);
  expect(await runner.runOnce()).toMatchObject({ reason: "closing" });
});
it("rejects overlapping cycles and skips sends if shutdown occurs during DB evaluation", async () => {
  let release!: (value: typeof counts) => void;
  const repo = {
    ...repository(),
    processLifecycleBatch: () =>
      new Promise<typeof counts>((resolve) => {
        release = resolve;
      }),
  };
  const runner = createExpertResidencyLifecycleRunner({
    enabled: true,
    deliveryEnabled: true,
    repository: repo,
  });
  const cycle = runner.runOnce();
  await expect(runner.runOnce()).rejects.toThrow(
    "expert_residency_lifecycle_cycle_busy",
  );
  runner.stopAccepting();
  release(counts);
  await cycle;
  expect(repo.listDueNotices).not.toHaveBeenCalled();
});
it("rejects an oversized repository batch without any external send", async () => {
  const repo = {
    ...repository(),
    listDueNotices: async () => [{ noticeId: "one" }, { noticeId: "two" }],
  };
  await expect(
    createExpertResidencyLifecycleRunner({
      enabled: false,
      deliveryEnabled: true,
      repository: repo,
      batchSize: 1,
    }).runOnce(),
  ).rejects.toThrow("expert_residency_lifecycle_batch_invalid");
  expect(repo.deliverNotice).not.toHaveBeenCalled();
});
it("sanitizes per-notice failure and never retries it within the cycle", async () => {
  const repo = {
    ...repository(),
    deliverNotice: vi.fn(async () => {
      throw new Error("private provider detail");
    }),
  };
  const result = await createExpertResidencyLifecycleRunner({
    enabled: false,
    deliveryEnabled: true,
    repository: repo,
  }).runOnce();
  expect(result.notices.failed).toBe(1);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(repo.deliverNotice).toHaveBeenCalledTimes(1);
});

it("passes shutdown cancellation to DB calendar processing before new owner claims", async () => {
  const repo = repository();
  const runner = createExpertResidencyLifecycleRunner({
    enabled: true,
    deliveryEnabled: false,
    repository: repo,
  });
  await runner.runOnce();
  const signal = repo.processLifecycleBatch.mock.calls[0]?.[1]?.signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal?.aborted).toBe(false);
  runner.stopAccepting();
  expect(signal?.aborted).toBe(true);
});
