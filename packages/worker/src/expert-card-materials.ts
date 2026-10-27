export type ExpertCardMaterialOutcome =
  | "delivered"
  | "already_delivered"
  | "waiting_content"
  | "unknown_outcome"
  | "cancelled"
  | "unavailable";
export interface ExpertCardMaterialsRepository {
  listDueMaterialJobs(limit: number): Promise<readonly { jobId: string }[]>;
  deliverMaterials(
    jobId: string,
    options: { signal: AbortSignal },
  ): Promise<{ kind: ExpertCardMaterialOutcome }>;
}
export interface ExpertCardMaterialsReport {
  examined: number;
  delivered: number;
  alreadyDelivered: number;
  waitingContent: number;
  unknown: number;
  cancelled: number;
  unavailable: number;
  failed: number;
  reason?: "disabled" | "closing";
}
const empty = (): ExpertCardMaterialsReport => ({
  examined: 0,
  delivered: 0,
  alreadyDelivered: 0,
  waitingContent: 0,
  unknown: 0,
  cancelled: 0,
  unavailable: 0,
  failed: 0,
});
/** Repository owns durable claims, current consent/revision, real provider receipt
 * and uncertainty quarantine. The worker never manufactures or retries a receipt. */
export function createExpertCardMaterialsRunner(deps: {
  enabled: boolean;
  repository?: ExpertCardMaterialsRepository;
  batchSize?: number;
}) {
  const batchSize = deps.batchSize ?? 10;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 50)
    throw new Error("expert_card_material_batch_invalid");
  if (
    deps.enabled &&
    (!deps.repository ||
      typeof deps.repository.listDueMaterialJobs !== "function" ||
      typeof deps.repository.deliverMaterials !== "function")
  )
    throw new Error("expert_card_material_capability_required");
  const repository = deps.repository;
  const controller = new AbortController();
  let accepting = true;
  let active: Promise<ExpertCardMaterialsReport> | undefined;
  return {
    runOnce(): Promise<ExpertCardMaterialsReport> {
      if (!deps.enabled)
        return Promise.resolve({ ...empty(), reason: "disabled" });
      if (!accepting) return Promise.resolve({ ...empty(), reason: "closing" });
      if (active)
        return Promise.reject(new Error("expert_card_material_cycle_busy"));
      const cycle = (async () => {
        const result = empty();
        const jobs = await repository!.listDueMaterialJobs(batchSize);
        if (!Array.isArray(jobs) || jobs.length > batchSize)
          throw new Error("expert_card_material_batch_invalid");
        for (const job of jobs) {
          if (!accepting || controller.signal.aborted) break;
          if (
            !job ||
            typeof job.jobId !== "string" ||
            job.jobId.length < 1 ||
            job.jobId.length > 128
          ) {
            result.failed++;
            continue;
          }
          result.examined++;
          try {
            const outcome = await repository!.deliverMaterials(job.jobId, {
              signal: controller.signal,
            });
            switch (outcome.kind) {
              case "delivered":
                result.delivered++;
                break;
              case "already_delivered":
                result.alreadyDelivered++;
                break;
              case "waiting_content":
                result.waitingContent++;
                break;
              case "unknown_outcome":
                result.unknown++;
                break;
              case "cancelled":
                result.cancelled++;
                break;
              case "unavailable":
                result.unavailable++;
                break;
              default:
                result.failed++;
            }
          } catch {
            result.failed++;
          }
        }
        return result;
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
    },
  };
}
export type ExpertCardMaterialsRunner = ReturnType<
  typeof createExpertCardMaterialsRunner
>;
