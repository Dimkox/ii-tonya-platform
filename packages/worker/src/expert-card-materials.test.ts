import { expect, it, vi } from "vitest";
import { createExpertCardMaterialsRunner } from "./expert-card-materials.js";
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
function fixture() {
  const listDueMaterialJobs = vi.fn(async (limit: number) => {
    void limit;
    return [{ jobId: first }, { jobId: second }];
  });
  const deliverMaterials = vi.fn(
    async (jobId: string, options: { signal: AbortSignal }) => {
      void jobId;
      void options;
      return { kind: "delivered" as const };
    },
  );
  return { listDueMaterialJobs, deliverMaterials };
}
it("runs only a bounded due batch through actual repository delivery", async () => {
  const r = fixture();
  const runner = createExpertCardMaterialsRunner({
    enabled: true,
    repository: r,
    batchSize: 2,
  });
  expect(await runner.runOnce()).toMatchObject({
    examined: 2,
    delivered: 2,
    unknown: 0,
    failed: 0,
  });
  expect(r.listDueMaterialJobs).toHaveBeenCalledWith(2);
  expect(r.deliverMaterials).toHaveBeenNthCalledWith(1, first, {
    signal: expect.any(AbortSignal),
  });
  expect(r.deliverMaterials).toHaveBeenNthCalledWith(2, second, {
    signal: expect.any(AbortSignal),
  });
});
it("never manufactures delivery for unknown, missing content, or cancelled outcomes", async () => {
  const r = fixture();
  r.listDueMaterialJobs.mockResolvedValueOnce([
    { jobId: first },
    { jobId: second },
  ]);
  r.deliverMaterials
    .mockResolvedValueOnce({ kind: "unknown_outcome" } as never)
    .mockResolvedValueOnce({ kind: "waiting_content" } as never);
  expect(
    await createExpertCardMaterialsRunner({
      enabled: true,
      repository: r,
    }).runOnce(),
  ).toMatchObject({ examined: 2, delivered: 0, unknown: 1, waitingContent: 1 });
});
it.each([0, 51, 1.5])(
  "rejects invalid batch %s before repository access",
  (batchSize) => {
    const r = fixture();
    expect(() =>
      createExpertCardMaterialsRunner({
        enabled: true,
        repository: r,
        batchSize,
      }),
    ).toThrow("expert_card_material_batch_invalid");
    expect(r.listDueMaterialJobs).not.toHaveBeenCalled();
  },
);
it("stays disabled without a repository", async () => {
  expect(
    await createExpertCardMaterialsRunner({ enabled: false }).runOnce(),
  ).toMatchObject({ examined: 0, delivered: 0, reason: "disabled" });
});
it("fails enabled creation without complete dependencies", () => {
  expect(() => createExpertCardMaterialsRunner({ enabled: true })).toThrow(
    "expert_card_material_capability_required",
  );
});
it("stops after current delivery and forwards abort during shutdown", async () => {
  const r = fixture();
  let release: (value: { kind: "delivered" }) => void = () => {};
  r.deliverMaterials.mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const runner = createExpertCardMaterialsRunner({
    enabled: true,
    repository: r,
  });
  const running = runner.runOnce();
  await vi.waitFor(() => expect(r.deliverMaterials).toHaveBeenCalledTimes(1));
  const signal = r.deliverMaterials.mock.calls[0]?.[1]?.signal;
  runner.stopAccepting();
  expect(signal?.aborted).toBe(true);
  release({ kind: "delivered" });
  expect(await running).toMatchObject({ examined: 1, delivered: 1 });
  expect(r.deliverMaterials).toHaveBeenCalledTimes(1);
  expect(await runner.runOnce()).toMatchObject({
    reason: "closing",
    examined: 0,
  });
});
it("does not overlap runner cycles", async () => {
  const r = fixture();
  let release: (value: { jobId: string }[]) => void = () => {};
  r.listDueMaterialJobs.mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const runner = createExpertCardMaterialsRunner({
    enabled: true,
    repository: r,
  });
  const pending = runner.runOnce();
  await expect(runner.runOnce()).rejects.toThrow(
    "expert_card_material_cycle_busy",
  );
  release([]);
  await pending;
});
it("reports sanitized failures without retrying a failed send", async () => {
  const r = fixture();
  r.listDueMaterialJobs.mockResolvedValueOnce([{ jobId: first }]);
  r.deliverMaterials.mockRejectedValueOnce(
    new Error("synthetic-private-token-media"),
  );
  const result = await createExpertCardMaterialsRunner({
    enabled: true,
    repository: r,
  }).runOnce();
  expect(result).toMatchObject({ examined: 1, failed: 1, delivered: 0 });
  expect(JSON.stringify(result)).not.toContain("synthetic-private");
  expect(r.deliverMaterials).toHaveBeenCalledTimes(1);
});
