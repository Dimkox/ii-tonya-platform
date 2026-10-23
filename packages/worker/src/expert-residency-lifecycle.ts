import type { ResidencyLifecycleRepository } from "@ii-tonya/contracts";
import { createExpertCardMaterialsRunner } from "./expert-card-materials.js";

export type ExpertResidencyLifecycleWorkerRepository = Pick<
  ResidencyLifecycleRepository,
  "processLifecycleBatch" | "listDueNotices"
> & {
  deliverNotice(
    noticeId: string,
    options: { signal: AbortSignal },
  ): ReturnType<ResidencyLifecycleRepository["deliverNotice"]>;
};
const emptyLifecycle = () => ({
  examined: 0,
  billsCreated: 0,
  noticesCreated: 0,
  suspended: 0,
  resumed: 0,
});
/** PostgreSQL owns calendar time, coverage, quote intents, consent and durable
 * notice uncertainty. This adapter never computes entitlement or sends a bill as
 * an accepted price or automatic payment. */
export function createExpertResidencyLifecycleRunner(deps: {
  enabled: boolean;
  deliveryEnabled: boolean;
  repository?: ExpertResidencyLifecycleWorkerRepository;
  batchSize?: number;
}) {
  const batchSize = deps.batchSize ?? 10;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 50)
    throw new Error("expert_residency_lifecycle_batch_invalid");
  const repository = deps.repository;
  if (
    (deps.enabled && typeof repository?.processLifecycleBatch !== "function") ||
    (deps.deliveryEnabled &&
      (typeof repository?.listDueNotices !== "function" ||
        typeof repository?.deliverNotice !== "function"))
  )
    throw new Error("expert_residency_lifecycle_capability_required");
  const notices = createExpertCardMaterialsRunner({
    enabled: deps.deliveryEnabled,
    batchSize,
    ...(repository === undefined
      ? {}
      : {
          repository: {
            listDueMaterialJobs: async (limit: number) => {
              const rows = await repository.listDueNotices(limit);
              if (!Array.isArray(rows) || rows.length > limit)
                throw new Error("expert_residency_lifecycle_batch_invalid");
              return rows.map((row) => ({ jobId: row?.noticeId }));
            },
            deliverMaterials: (
              noticeId: string,
              options: { signal: AbortSignal },
            ) => repository.deliverNotice(noticeId, options),
          },
        }),
  });
  const controller = new AbortController();
  let accepting = true;
  let active: Promise<unknown> | undefined;
  return {
    runOnce() {
      if (!accepting)
        return notices.runOnce().then((deliveries) => ({
          lifecycle: { ...emptyLifecycle(), reason: "closing" },
          notices: deliveries,
          reason: "closing",
        }));
      if (active)
        return Promise.reject(
          new Error("expert_residency_lifecycle_cycle_busy"),
        );
      const cycle = (async () => {
        const lifecycle = deps.enabled
          ? await repository!.processLifecycleBatch(batchSize, {
              signal: controller.signal,
            })
          : { ...emptyLifecycle(), reason: "disabled" };
        const deliveries = await notices.runOnce();
        return {
          lifecycle,
          notices: deliveries,
          ...(!deps.enabled && !deps.deliveryEnabled
            ? { reason: "disabled" }
            : {}),
        };
      })();
      active = cycle;
      void cycle
        .finally(() => {
          if (active === cycle) active = undefined;
        })
        .catch(() => undefined);
      return cycle;
    },
    stopAccepting() {
      accepting = false;
      controller.abort();
      notices.stopAccepting();
    },
  };
}
export type ExpertResidencyLifecycleRunner = ReturnType<
  typeof createExpertResidencyLifecycleRunner
>;
