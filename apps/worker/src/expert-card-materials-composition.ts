import { assertExpertCardConfig, type RuntimeConfig } from "@ii-tonya/config";
import {
  createExpertMaterialTransport,
  type ExpertMaterialTransport,
} from "@ii-tonya/integrations";
import {
  createExpertCardMaterialsRunner,
  type ExpertCardMaterialsRepository,
} from "@ii-tonya/worker";

/** Run before opening a database connection. A supplied settings boolean never
 * overrides the independently default-off provider delivery ceiling. */
export function assertExpertCardMaterialsWorkerConfig(
  config: RuntimeConfig,
): void {
  assertExpertCardConfig(config);
  const enabled = config.features.expertCardMaterialDelivery === true;
  if (enabled !== (config.expertCard?.materialDeliveryEnabled === true))
    throw new Error("expert_card_material_worker_configuration_invalid");
  if (enabled && !config.expertCard?.workBotToken)
    throw new Error("expert_card_configuration_required");
}
export function createExpertCardMaterialsLifecycle(
  config: RuntimeConfig,
  options: {
    createRepository?: (
      transport: ExpertMaterialTransport,
    ) => ExpertCardMaterialsRepository;
    fetch?: typeof globalThis.fetch;
    batchSize?: number;
  } = {},
) {
  assertExpertCardMaterialsWorkerConfig(config);
  if (config.features.expertCardMaterialDelivery !== true) return undefined;
  if (typeof options.createRepository !== "function")
    throw new Error("expert_card_material_capability_required");
  const settings = config.expertCard!;
  const workTransport = createExpertMaterialTransport({
    token: settings.workBotToken!,
    botId: settings.workBotId,
    botKey: settings.workBotKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const promo = config.expertApplicant;
  const promoTransport = promo?.botToken
    ? createExpertMaterialTransport({
        token: promo.botToken,
        botId: promo.botId,
        botKey: promo.botKey,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
    : undefined;
  const transport: ExpertMaterialTransport = {
    send(request) {
      if (
        request.botId === settings.workBotId &&
        request.botKey === settings.workBotKey
      )
        return workTransport.send(request);
      if (
        promoTransport &&
        request.botId === promo!.botId &&
        request.botKey === promo!.botKey
      )
        return promoTransport.send(request);
      return Promise.reject(new Error("expert_material_bot_scope_unavailable"));
    },
  };
  const repository = options.createRepository(transport);
  return createExpertCardMaterialsRunner({
    enabled: true,
    repository,
    ...(options.batchSize === undefined
      ? {}
      : { batchSize: options.batchSize }),
  });
}
