import {
  assertExpertResidencyLifecycleConfig,
  type RuntimeConfig,
} from "@ii-tonya/config";
import {
  createExpertMaterialTransport,
  type ExpertMaterialTransport,
} from "@ii-tonya/integrations";
import {
  createExpertResidencyLifecycleRunner,
  type ExpertResidencyLifecycleWorkerRepository,
} from "@ii-tonya/worker";

/** Dedicated default-off ceilings are validated before the worker opens a DB. */
export function assertExpertResidencyLifecycleWorkerConfig(
  config: RuntimeConfig,
): void {
  assertExpertResidencyLifecycleConfig(config);
  if (
    (config.features.expertResidencyLifecycle === true) !==
      (config.expertResidencyLifecycle?.enabled === true) ||
    (config.features.expertResidencyNoticeDelivery === true) !==
      (config.expertResidencyLifecycle?.noticeDeliveryEnabled === true)
  )
    throw new Error("expert_residency_lifecycle_worker_configuration_invalid");
}
export function createExpertResidencyLifecycleWorker(
  config: RuntimeConfig,
  options: {
    createRepository?: (
      noticeTransport?: ExpertMaterialTransport,
    ) => ExpertResidencyLifecycleWorkerRepository;
    fetch?: typeof globalThis.fetch;
    batchSize?: number;
  } = {},
) {
  assertExpertResidencyLifecycleWorkerConfig(config);
  const enabled = config.features.expertResidencyLifecycle === true;
  const deliveryEnabled =
    config.features.expertResidencyNoticeDelivery === true;
  if (!enabled && !deliveryEnabled) return undefined;
  if (typeof options.createRepository !== "function")
    throw new Error("expert_residency_lifecycle_capability_required");
  const transport = deliveryEnabled
    ? createExpertMaterialTransport({
        token: config.expertCard!.workBotToken!,
        botId: config.expertCard!.workBotId,
        botKey: config.expertCard!.workBotKey,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      })
    : undefined;
  const repository = options.createRepository(transport);
  return createExpertResidencyLifecycleRunner({
    enabled,
    deliveryEnabled,
    repository,
    ...(options.batchSize === undefined
      ? {}
      : { batchSize: options.batchSize }),
  });
}
